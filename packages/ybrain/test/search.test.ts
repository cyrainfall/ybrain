import { afterEach, describe, expect, it } from "bun:test"
import { Database } from "bun:sqlite"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { openIndex } from "../src/db"
import { serializeNote, type NoteFrontmatter } from "../src/frontmatter"
import { createIndexer } from "../src/indexer"
import { createSearch } from "../src/search"
import { noteFileName } from "../src/vault"
import { fakeEmbedder, fakeReranker } from "./lib/fake-model"

// 检索（票据 22）：向量粗取 top8 → 重排精取 top k。
// 与 Python 原型 search_demo.py 的分工一致：粗取给召回，重排给排序与可靠性分。
// 外部模型用确定性替身，sqlite-vec 缺失时整组跳过。

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
const wyckoff: NoteFrontmatter = {
  id: "202609060915-bbbb",
  title: "威科夫笔记",
  type: "weread",
  source: "weread",
  created: "2026-09-06T09:15:00.000Z",
  status: "distilled",
}
const notes: Array<[NoteFrontmatter, string]> = [
  [brain, "外脑捕捉与检索：把看过的东西记住并能找回来。"],
  [wyckoff, "威科夫方法：spring 跌破支撑后的行为表现。"],
]

async function setup() {
  const vaultDir = await mkdtemp(path.join(tmpdir(), "ybrain-vault-"))
  const dataDir = await mkdtemp(path.join(tmpdir(), "ybrain-search-"))
  dirs.push(vaultDir, dataDir)

  const db = openIndex({
    path: path.join(dataDir, "index.db"),
    vecExtension: vecExtension!,
    customSqlitePath: customSqlite,
  })
  opened.push(db)

  for (const [frontmatter, body] of notes) {
    const relPath = `0-Inbox/${noteFileName(frontmatter.id, frontmatter.title)}`
    await mkdir(path.dirname(path.join(vaultDir, relPath)), { recursive: true })
    await writeFile(path.join(vaultDir, relPath), serializeNote(frontmatter, body))
  }

  const embedder = fakeEmbedder()
  await createIndexer({ vaultDir, db, embedder }).reindexAll()

  const search = createSearch({ db, embedder, reranker: fakeReranker() })
  return { search }
}

describeVec("检索", () => {
  it("ranks the relevant note first and reports both scores with note metadata", async () => {
    const { search } = await setup()

    const hits = await search.search("外脑检索")

    expect(hits[0]?.note_id).toBe(brain.id)
    expect(hits[0]?.title).toBe("外脑总览")
    expect(hits[0]?.path).toMatch(/^0-Inbox\//)
    expect(hits[0]?.url).toBe("https://example.com/brain")
    expect(hits[0]?.status).toBe("inbox")
    expect(hits[0]?.snippet).toContain("外脑捕捉与检索")
    expect(hits[0]?.rerank_score).toBe(1)
    expect(hits[0]?.vector_score).toBeGreaterThan(0)
    expect(hits[1]?.rerank_score).toBe(0)
  })

  it("returns nothing when the vault has not been indexed", async () => {
    const vaultDir = await mkdtemp(path.join(tmpdir(), "ybrain-vault-"))
    const dataDir = await mkdtemp(path.join(tmpdir(), "ybrain-search-"))
    dirs.push(vaultDir, dataDir)
    const db = openIndex({
      path: path.join(dataDir, "index.db"),
      vecExtension: vecExtension!,
      customSqlitePath: customSqlite,
    })
    opened.push(db)

    const search = createSearch({ db, embedder: fakeEmbedder(), reranker: fakeReranker() })
    expect(await search.search("随便问点什么")).toEqual([])
  })

  it("caps the number of results at k", async () => {
    const { search } = await setup()
    expect(await search.search("外脑检索", { k: 1 })).toHaveLength(1)
  })

  it("reports scores below the reliability threshold for unrelated questions", async () => {
    const { search } = await setup()

    const hits = await search.search("量子纠缠")

    expect(hits.length).toBeGreaterThan(0)
    for (const hit of hits) expect(hit.rerank_score).toBeLessThan(0.1)
  })
})
