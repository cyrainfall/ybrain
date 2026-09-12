import { afterEach, describe, expect, it } from "bun:test"
import { Database } from "bun:sqlite"
import type { ToolContext, ToolResult } from "@opencode-ai/plugin"
import { mkdir, mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { openIndex } from "../src/db"
import { parseNote, serializeNote, type NoteFrontmatter } from "../src/frontmatter"
import { createIndexer } from "../src/indexer"
import { createSearch, type SearchHit } from "../src/search"
import { createTools } from "../src/tools"
import { noteFileName } from "../src/vault"
import { fakeEmbedder, fakeReranker } from "./lib/fake-model"

// 四个原生知识工具（票据 23）：契约见
// .scratch/exobrain/prototypes/rag-tools-and-prompt.md §1。

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

const brain: NoteFrontmatter = {
  id: "202609061032-aaaa",
  title: "外脑总览",
  type: "clip",
  source: "web",
  url: "https://example.com/brain",
  created: "2026-09-06T10:32:00.000Z",
  status: "inbox",
}
const brainBody = "外脑捕捉与检索：把看过的东西记住并能找回来。\n\n---\n\n## 原文\n原始剪藏正文。"
const archived: NoteFrontmatter = {
  id: "202501010900-cccc",
  title: "旧项目存档",
  type: "note",
  source: "manual",
  created: "2025-01-01T09:00:00.000Z",
  status: "archived",
}
const brainPath = `0-Inbox/${noteFileName(brain.id, brain.title)}`
const archivedPath = `4-Archive/${noteFileName(archived.id, archived.title)}`

async function setup({ seed = true }: { seed?: boolean } = {}) {
  const vaultDir = await mkdtemp(path.join(tmpdir(), "ybrain-vault-"))
  const dataDir = await mkdtemp(path.join(tmpdir(), "ybrain-tools-"))
  dirs.push(vaultDir, dataDir)

  const db = openIndex({
    path: path.join(dataDir, "index.db"),
    vecExtension: vecExtension!,
    customSqlitePath: customSqlite,
  })
  opened.push(db)

  if (seed) {
    for (const [relPath, frontmatter, body] of [
      [brainPath, brain, brainBody],
      [archivedPath, archived, "已经归档的旧项目笔记，讲的是咖啡冲煮水温。"],
    ] as Array<[string, NoteFrontmatter, string]>) {
      await mkdir(path.dirname(path.join(vaultDir, relPath)), { recursive: true })
      await Bun.write(path.join(vaultDir, relPath), serializeNote(frontmatter, body))
    }
  }

  const embedder = fakeEmbedder()
  const indexer = createIndexer({ vaultDir, db, embedder })
  await indexer.reindexAll()

  const search = createSearch({ db, embedder, reranker: fakeReranker() })
  const tools = createTools({
    vaultDir,
    db,
    search: (query, options) => search.search(query, options),
    reindexNote: (relPath) => indexer.reindexNote(relPath),
  })
  return { vaultDir, db, tools, indexer }
}

// ToolContext 只是框架传进来的上下文袋；这里给最小可用实现，工具本身不使用它。
function context(vaultDir: string): ToolContext {
  return {
    sessionID: "test-session",
    messageID: "test-message",
    agent: "ybrain",
    directory: vaultDir,
    worktree: vaultDir,
    abort: new AbortController().signal,
    metadata: () => {},
    ask: async () => {},
  }
}

// 工具可以返回纯文本或 { output } 两种形态；测试统一取文本。
const asText = (result: ToolResult) => (typeof result === "string" ? result : result.output)
const hitsOf = (result: ToolResult): SearchHit[] => JSON.parse(asText(result))

describeVec("search_knowledge", () => {
  it("returns ranked hits with the fields the contract requires", async () => {
    const { vaultDir, tools } = await setup()

    const hits = hitsOf(await tools.search_knowledge.execute({ query: "外脑检索" }, context(vaultDir)))

    expect(hits[0]?.note_id).toBe(brain.id)
    expect(hits[0]?.title).toBe("外脑总览")
    expect(hits[0]?.path).toBe(brainPath)
    expect(hits[0]?.url).toBe("https://example.com/brain")
    expect(hits[0]?.status).toBe("inbox")
    expect(hits[0]?.snippet).toContain("外脑")
    expect(hits[0]?.rerank_score).toBeGreaterThan(0)
  })

  it("says so when nothing in the knowledge base matches", async () => {
    const { vaultDir, tools } = await setup()
    const output = await tools.search_knowledge.execute({ query: "量子纠缠" }, context(vaultDir))
    // 检索仍有候选，但分数全部低于可靠性阈值；工具如实返回，由代理判断"资料不足"
    for (const hit of hitsOf(output)) expect(hit.rerank_score).toBeLessThan(0.1)
  })

  it("returns an empty array when the knowledge base has nothing to match", async () => {
    const { vaultDir, tools } = await setup({ seed: false })

    expect(hitsOf(await tools.search_knowledge.execute({ query: "任何问题" }, context(vaultDir)))).toEqual([])
  })

  it("excludes archived notes when include_archived is false", async () => {
    const { vaultDir, tools } = await setup()

    const included = hitsOf(await tools.search_knowledge.execute({ query: "咖啡冲煮水温" }, context(vaultDir)))
    expect(included[0]?.note_id).toBe(archived.id)

    const excluded = hitsOf(
      await tools.search_knowledge.execute(
        { query: "咖啡冲煮水温", include_archived: false },
        context(vaultDir),
      ),
    )
    expect(excluded.map((hit) => hit.note_id)).not.toContain(archived.id)
  })
})

describeVec("get_note", () => {
  it("reads a note by note_id", async () => {
    const { vaultDir, tools } = await setup()

    const note = JSON.parse(asText(await tools.get_note.execute({ note_id: brain.id }, context(vaultDir))))

    expect(note.frontmatter.id).toBe(brain.id)
    expect(note.body).toContain("## 原文")
  })

  it("reads a note by vault-relative path", async () => {
    const { vaultDir, tools } = await setup()

    const note = JSON.parse(asText(await tools.get_note.execute({ path: archivedPath }, context(vaultDir))))

    expect(note.frontmatter.title).toBe("旧项目存档")
  })

  it("explains what is missing when neither identifier resolves", async () => {
    const { vaultDir, tools } = await setup()

    expect(asText(await tools.get_note.execute({}, context(vaultDir)))).toContain("note_id")
    expect(asText(await tools.get_note.execute({ note_id: "does-not-exist" }, context(vaultDir)))).toContain(
      "does-not-exist",
    )
  })
})

describeVec("list_inbox", () => {
  it("lists only the notes still in the inbox", async () => {
    const { vaultDir, tools } = await setup()

    const inbox = JSON.parse(asText(await tools.list_inbox.execute({}, context(vaultDir))))

    expect(inbox).toHaveLength(1)
    expect(inbox[0].note_id).toBe(brain.id)
    expect(inbox[0].path).toBe(brainPath)
  })

  it("says the inbox is empty when there is nothing to distil", async () => {
    const { vaultDir, tools } = await setup({ seed: false })

    expect(asText(await tools.list_inbox.execute({}, context(vaultDir)))).toContain("空")
  })
})

describeVec("save_note", () => {
  it("creates a new inbox note and indexes it", async () => {
    const { vaultDir, tools } = await setup()

    const created = JSON.parse(
      asText(await tools.save_note.execute({ title: "新想法", body: "速记内容：记录一个想法。" }, context(vaultDir))),
    )

    expect(created.note_id).toMatch(/^\d{12}-[a-z0-9]{4}$/)
    expect(created.path).toBe(`0-Inbox/${noteFileName(created.note_id, "新想法")}`)
    const written = parseNote(await Bun.file(path.join(vaultDir, created.path)).text())
    expect(written.frontmatter.source).toBe("agent")
    expect(written.frontmatter.status).toBe("inbox")
  })

  it("creates a card note when the patch asks for one", async () => {
    const { vaultDir, tools } = await setup()

    const created = JSON.parse(
      asText(
        await tools.save_note.execute(
          {
            title: "支撑位卡片",
            body: "卡片要点：跌破支撑后先看量能。",
            frontmatter_patch: { type: "card", tags: ["威科夫"] },
          },
          context(vaultDir),
        ),
      ),
    )

    const written = parseNote(await Bun.file(path.join(vaultDir, created.path)).text())
    expect(written.frontmatter.type).toBe("card")
    expect(written.frontmatter.tags).toEqual(["威科夫"])
  })

  it("replaces the distilled part, keeps 原文 and moves the note into PARA", async () => {
    const { vaultDir, tools } = await setup()

    const saved = JSON.parse(
      asText(
        await tools.save_note.execute(
          {
            note_id: brain.id,
            para_folder: "3-Resources",
            frontmatter_patch: { summary: "一句话摘要", tags: ["外脑"], status: "distilled" },
            body: "提炼后的要点：外脑 = 扩展记忆 + 扩展智力。",
          },
          context(vaultDir),
        ),
      ),
    )

    expect(saved.path).toBe(`3-Resources/${path.basename(brainPath)}`)
    const written = parseNote(await Bun.file(path.join(vaultDir, saved.path)).text())
    expect(written.frontmatter.summary).toBe("一句话摘要")
    expect(written.frontmatter.tags).toEqual(["外脑"])
    expect(written.frontmatter.status).toBe("distilled")
    expect(written.body).toContain("提炼后的要点")
    expect(written.body).not.toContain("把看过的东西记住")
    expect(written.body).toContain("## 原文\n原始剪藏正文。")
    expect(await Bun.file(path.join(vaultDir, brainPath)).exists()).toBe(false)
  })
})
