import { afterEach, describe, expect, it } from "bun:test"
import { Database } from "bun:sqlite"
import { mkdir, mkdtemp, rename, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { openIndex } from "../src/db"
import { serializeNote, type NoteFrontmatter } from "../src/frontmatter"
import { createIndexer } from "../src/indexer"
import { noteFileName } from "../src/vault"
import { fakeEmbedder } from "./lib/fake-model"

// 索引器（票据 22）：vault → 分块 → 嵌入 → notes/chunks/vec_chunks。
// 关键约束（票据 11 原型已定论）：索引以 note_id 对账，移动/改名后必须先删旧 chunks 再插新。
// 嵌入走端口注入的确定性替身；vec_chunks 需要 sqlite-vec，无扩展时整组跳过。

const vecExtension = process.env.SQLITE_VEC_PATH
const customSqlite = process.env.CUSTOM_SQLITE_PATH
const describeVec = vecExtension ? describe : describe.skip

const dirs: string[] = []
const opened: Database[] = []
afterEach(async () => {
  for (const db of opened) db.close()
  opened.length = 0
  await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })))
  dirs.length = 0
})

const noteId = "202609061032-abcd"
const frontmatter: NoteFrontmatter = {
  id: noteId,
  title: "Build Exobrain",
  type: "clip",
  source: "web",
  created: "2026-09-06T10:32:00.000Z",
  status: "inbox",
}
const relPath = `0-Inbox/${noteFileName(noteId, frontmatter.title)}`
const twoSections = "# 第一章\n第一节内容\n\n## 第二节\n第二节内容"
const threeSections = `${twoSections}\n\n## 第三节\n第三节内容`

async function setup() {
  const vaultDir = await mkdtemp(path.join(tmpdir(), "ybrain-vault-"))
  const dataDir = await mkdtemp(path.join(tmpdir(), "ybrain-index-"))
  dirs.push(vaultDir, dataDir)

  const db = openIndex({
    path: path.join(dataDir, "index.db"),
    vecExtension: vecExtension!,
    customSqlitePath: customSqlite,
  })
  opened.push(db)

  const embedder = fakeEmbedder()
  const indexer = createIndexer({ vaultDir, db, embedder })

  const write = async (target: string, body: string, meta: NoteFrontmatter = frontmatter) => {
    await mkdir(path.dirname(path.join(vaultDir, target)), { recursive: true })
    await writeFile(path.join(vaultDir, target), serializeNote(meta, body))
  }

  return { vaultDir, db, indexer, embedder, write }
}

const countRows = (db: Database, sql: string, param: string) =>
  (db.query(sql).get(param) as { n: number }).n

describeVec("索引器", () => {
  it("writes the note row, its chunks and their vectors", async () => {
    const { db, indexer, write } = await setup()
    await write(relPath, twoSections)

    await indexer.reindexNote(relPath)

    const note = db.query("select * from notes where id = ?").get(noteId) as {
      path: string
      title: string
      status: string
      hash: string
    }
    expect(note.path).toBe(relPath)
    expect(note.title).toBe("Build Exobrain")
    expect(note.status).toBe("inbox")
    expect(note.hash.length).toBeGreaterThan(0)

    expect(countRows(db, "select count(*) as n from chunks where note_id = ?", noteId)).toBe(2)
    expect(db.query("select count(*) as n from vec_chunks").get()).toEqual({ n: 2 })
  })

  it("replaces chunks instead of duplicating when the note changes", async () => {
    const { db, indexer, write } = await setup()
    await write(relPath, twoSections)
    await indexer.reindexNote(relPath)

    await write(relPath, threeSections)
    await indexer.reindexNote(relPath)

    expect(countRows(db, "select count(*) as n from chunks where note_id = ?", noteId)).toBe(3)
    expect(db.query("select count(*) as n from vec_chunks").get()).toEqual({ n: 3 })
    const texts = (db.query("select text from chunks where note_id = ? order by ordinal").all(noteId) as {
      text: string
    }[]).map((row) => row.text)
    expect(texts).toContain("## 第三节\n第三节内容")
  })

  it("keeps one set of chunks when the note moves to another folder", async () => {
    const { vaultDir, db, indexer, write } = await setup()
    await write(relPath, twoSections)
    await indexer.reindexNote(relPath)

    const moved = `3-Resources/${path.basename(relPath)}`
    await mkdir(path.dirname(path.join(vaultDir, moved)), { recursive: true })
    await rename(path.join(vaultDir, relPath), path.join(vaultDir, moved))
    await indexer.reindexNote(moved)

    expect(countRows(db, "select count(*) as n from chunks where note_id = ?", noteId)).toBe(2)
    expect(db.query("select count(*) as n from vec_chunks").get()).toEqual({ n: 2 })
    expect((db.query("select path from notes where id = ?").get(noteId) as { path: string }).path).toBe(moved)
  })

  it("indexes every note but skips unchanged ones on a full reindex", async () => {
    const { indexer, embedder, write } = await setup()
    await write(relPath, twoSections)
    await write(`0-Inbox/${noteFileName("202609061033-ffff", "Another")}`, "# 甲\n内容甲", {
      ...frontmatter,
      id: "202609061033-ffff",
      title: "Another",
    })

    const first = await indexer.reindexAll()
    expect(first).toEqual({ indexed: 2, skipped: 0 })
    const callsAfterFirst = embedder.batches.length

    const second = await indexer.reindexAll()
    expect(second).toEqual({ indexed: 0, skipped: 2 })
    expect(embedder.batches.length).toBe(callsAfterFirst)
  })

  it("drops index rows for notes removed from disk", async () => {
    const { vaultDir, db, indexer, write } = await setup()
    await write(relPath, twoSections)
    await indexer.reindexAll()

    await rm(path.join(vaultDir, relPath))
    await indexer.reindexAll()

    expect(countRows(db, "select count(*) as n from chunks where note_id = ?", noteId)).toBe(0)
    expect(db.query("select count(*) as n from vec_chunks").get()).toEqual({ n: 0 })
    expect(db.query("select count(*) as n from notes").get()).toEqual({ n: 0 })
  })

  it("syncs one path: reindexes it when present, forgets it when gone", async () => {
    const { vaultDir, db, indexer, write } = await setup()
    await write(relPath, twoSections)

    await indexer.syncNote(relPath)
    expect(countRows(db, "select count(*) as n from chunks where note_id = ?", noteId)).toBe(2)

    await rm(path.join(vaultDir, relPath))
    await indexer.syncNote(relPath)

    expect(countRows(db, "select count(*) as n from chunks where note_id = ?", noteId)).toBe(0)
    expect(db.query("select count(*) as n from notes").get()).toEqual({ n: 0 })
  })

  it("keeps one stable set of chunks when two paths share a note id", async () => {
    const { db, indexer, write } = await setup()
    const duplicate = `3-Resources/${path.basename(relPath)}`
    await write(relPath, twoSections)
    await write(duplicate, "# 只有一节\n提炼后的内容")

    // 两条路径共用一个 id，只索引胜出的那条（排序靠后的 3-Resources）
    const first = await indexer.reindexAll()
    expect(first).toEqual({ indexed: 1, skipped: 0 })

    expect(db.query("select count(*) as n from notes").get()).toEqual({ n: 1 })
    expect((db.query("select path from notes where id = ?").get(noteId) as { path: string }).path).toBe(duplicate)
    expect(countRows(db, "select count(*) as n from chunks where note_id = ?", noteId)).toBe(1)
    expect(db.query("select count(*) as n from vec_chunks").get()).toEqual({ n: 1 })

    // 再次重建不会在两条路径之间翻转
    expect(await indexer.reindexAll()).toEqual({ indexed: 0, skipped: 1 })
    expect((db.query("select path from notes where id = ?").get(noteId) as { path: string }).path).toBe(duplicate)
  })
})
