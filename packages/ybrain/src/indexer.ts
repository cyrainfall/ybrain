import type { Database } from "bun:sqlite"
import { stat } from "node:fs/promises"
import path from "node:path"
import { indexableBody, splitChunks } from "./chunk"
import { parseNote, type NoteFrontmatter } from "./frontmatter"
import { EMBED_MODEL, type Embedder } from "./siliconflow"

// 索引器（票据 22）：vault → 分块 → 嵌入 → notes / chunks / vec_chunks。
// 笔记文件是真相源，本索引随时可由 reindexAll 重建。
// 对账口径（票据 11 原型定论）：以 note_id 为准，笔记移动/改名后先删旧 chunks 再插新。

export type IndexerDeps = {
  vaultDir: string
  db: Database
  embedder: Embedder
  embedModel?: string
}

type StoredNote = { id: string; path: string; hash: string }

export function createIndexer(deps: IndexerDeps) {
  const model = deps.embedModel ?? EMBED_MODEL

  // 返回笔记 id，供全量重建统计磁盘上真实存在的身份。
  async function reindexNote(relPath: string): Promise<string> {
    const absPath = path.join(deps.vaultDir, relPath)
    const text = await Bun.file(absPath).text()
    const { frontmatter, body } = parseNote(text)
    const noteId = noteIdOf(frontmatter, relPath)

    const chunks = splitChunks(indexableBody(body))
    // 网络调用不放进事务
    const vectors = chunks.length > 0 ? await deps.embedder.embed(chunks) : []
    const mtime = Math.floor((await stat(absPath)).mtimeMs)

    deps.db.transaction(() => {
      deps.db
        .prepare(
          `insert into notes (id, path, title, type, status, url, tags, hash, mtime)
           values (?, ?, ?, ?, ?, ?, ?, ?, ?)
           on conflict(id) do update set
             path = excluded.path, title = excluded.title, type = excluded.type,
             status = excluded.status, url = excluded.url, tags = excluded.tags,
             hash = excluded.hash, mtime = excluded.mtime`,
        )
        .run(
          noteId,
          relPath,
          frontmatter.title ?? "",
          frontmatter.type ?? "",
          frontmatter.status ?? "",
          frontmatter.url ?? null,
          JSON.stringify(frontmatter.tags ?? []),
          sha256(text),
          mtime,
        )

      deleteChunks(noteId)

      const insertChunk = deps.db.prepare(
        "insert into chunks (note_id, ordinal, text, embed_model, embedded_at) values (?, ?, ?, ?, ?)",
      )
      const insertVector = deps.db.prepare("insert into vec_chunks (rowid, embedding) values (?, ?)")
      const embeddedAt = new Date().toISOString()
      chunks.forEach((chunk, ordinal) => {
        const inserted = insertChunk.run(noteId, ordinal, chunk, model, embeddedAt)
        insertVector.run(Number(inserted.lastInsertRowid), Buffer.from(new Float32Array(vectors[ordinal]!).buffer))
      })
    })()

    return noteId
  }

  async function reindexAll(): Promise<{ indexed: number; skipped: number }> {
    // 排序让结果确定：同一 id 出现在多条路径（数据异常）时，谁是最终态不随文件系统顺序漂移。
    const paths = (await Array.fromAsync(new Bun.Glob("**/*.md").scan({ cwd: deps.vaultDir }))).sort()
    const stored = new Map(
      (deps.db.query("select id, path, hash from notes").all() as StoredNote[]).map((row) => [row.path, row]),
    )
    const files = await Promise.all(
      paths.map(async (relPath) => {
        const text = await Bun.file(path.join(deps.vaultDir, relPath)).text()
        return { relPath, hash: sha256(text), id: noteIdOf(parseNote(text).frontmatter, relPath) }
      }),
    )

    // 同一 id 只保留排序最后的一条，保证跨次重建稳定，不会在两条路径之间来回翻转
    const winner = new Map<string, string>()
    files.forEach((file) => winner.set(file.id, file.relPath))
    const kept = files.filter((file) => winner.get(file.id) === file.relPath)
    reportDuplicateIds(files, kept)

    // 未变的跳过；嵌入按顺序进行，避免并发打满外部 API 配额
    const changed = kept.filter((file) => stored.get(file.relPath)?.hash !== file.hash)
    for (const file of changed) await reindexNote(file.relPath)

    // 清理：索引里有、本次却未保留的 id（被删、改名、换 id 或同 id 落败）连同分块与向量一并移除
    const onDisk = new Set(kept.map((file) => file.id))
    ;(deps.db.query("select id from notes").all() as { id: string }[])
      .filter((row) => !onDisk.has(row.id))
      .forEach((row) => forgetNote(row.id))

    return { indexed: changed.length, skipped: kept.length - changed.length }
  }

  // 单个路径与索引对齐：文件在则重索引，文件没了就从索引移除（文件监听与手动同步共用）。
  async function syncNote(relPath: string): Promise<void> {
    if (await Bun.file(path.join(deps.vaultDir, relPath)).exists()) {
      await reindexNote(relPath)
      return
    }
    const known = deps.db.query("select id from notes where path = ?").get(relPath) as { id: string } | null
    if (known) forgetNote(known.id)
  }

  function forgetNote(noteId: string): void {
    deps.db.transaction(() => {
      deleteChunks(noteId)
      deps.db.prepare("delete from notes where id = ?").run(noteId)
    })()
  }

  // 先删向量再删分块，避免留下孤儿向量行。
  function deleteChunks(noteId: string): void {
    const ids = deps.db.query("select id from chunks where note_id = ?").all(noteId) as { id: number }[]
    const removeVector = deps.db.prepare("delete from vec_chunks where rowid = ?")
    ids.forEach((row) => removeVector.run(row.id))
    deps.db.prepare("delete from chunks where note_id = ?").run(noteId)
  }

  return { reindexNote, reindexAll, syncNote }
}

// 同一 id 对应多条路径是 vault 的数据异常（如收件箱态与提炼态并存）；取舍已由排序决定，这里只告警。
function reportDuplicateIds(files: Array<{ relPath: string; id: string }>, kept: Array<{ relPath: string }>): void {
  const keptPaths = new Set(kept.map((file) => file.relPath))
  files
    .filter((file) => !keptPaths.has(file.relPath))
    .forEach((file) => console.warn(`ybrain: 笔记 id ${file.id} 在多条路径出现，本次忽略：${file.relPath}`))
}

// 没有 frontmatter 的 Markdown（用户在 Obsidian 手写）以文件名兜底，避免整库重建被单个文件中断。
function noteIdOf(frontmatter: NoteFrontmatter, relPath: string): string {
  return frontmatter.id || path.basename(relPath, ".md")
}

function sha256(text: string): string {
  return new Bun.CryptoHasher("sha256").update(text).digest("hex")
}
