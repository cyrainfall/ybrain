import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { openIndex } from "../src/db"
import { createIndexer } from "../src/indexer"
import { createSearch, type SearchHit } from "../src/search"
import { createEmbedder, createReranker } from "../src/siliconflow"

// 票据 22 验收脚本：对示例库做全量 reindex，再跑票据 11 的四个演示提问，
// 打印命中与分数，供与 Python 原型（search_demo.py）的结果比对。
// 需要真实密钥与向量扩展，不进 CI。用法：
//   bun run --env-file=deploy/.env script/acceptance.ts [vaultDir]
// 密钥只从环境读取，全程不打印。

const DEFAULT_VAULT = path.join(import.meta.dir, "../../../.scratch/exobrain/prototypes/vault")

// 票据 11 Answer 记录的 Python 原型结果（重排分为参考量级）：
//   1) 外脑记忆检索 → 精准命中，0.981   2) 归档可搜 → 部分命中，0.302
//   3) 威科夫 spring → 精准命中，0.896  4) 手机速记 → 库中无内容，全部 ≤0.09
const CHECKS: Array<{ query: string; verify: (hits: SearchHit[]) => string | undefined }> = [
  {
    query: "外脑怎么把看过的东西记住并且找回来？",
    verify: (hits) => {
      const top = hits[0]
      if (!top) return "没有任何命中"
      if (!/外脑|exobrain/i.test(`${top.title} ${top.snippet} ${top.path}`)) return `首位命中主题不符：${top.title}`
      return top.rerank_score < 0.5 ? `重排分偏低：${top.rerank_score}` : undefined
    },
  },
  {
    query: "归档之后的笔记还能被搜到吗？",
    verify: (hits) => {
      const top = hits[0]
      if (!top) return "没有任何命中"
      return top.rerank_score > 0.1 ? undefined : `重排分低于可靠性阈值：${top.rerank_score}`
    },
  },
  {
    query: "威科夫方法里 spring 跌破支撑意味着什么？",
    verify: (hits) => {
      const top = hits[0]
      if (!top) return "没有任何命中"
      if (!/威科夫|spring/i.test(`${top.title} ${top.snippet} ${top.path}`)) return `首位命中主题不符：${top.title}`
      return top.rerank_score < 0.5 ? `重排分偏低：${top.rerank_score}` : undefined
    },
  },
  {
    query: "我想在手机上快速记一个想法，有什么办法？",
    verify: (hits) =>
      hits.every((hit) => hit.rerank_score < 0.1)
        ? undefined
        : `应全部低于阈值（代理答「资料不足」），实际最高 ${hits[0]?.rerank_score}`,
  },
]

const apiKey = process.env.SILICONFLOW_API_KEY
if (!apiKey) {
  console.error("缺少环境变量 SILICONFLOW_API_KEY（可用 bun run --env-file=deploy/.env 从 .env 注入）")
  process.exit(1)
}
const vecExtension = process.env.SQLITE_VEC_PATH
if (!vecExtension) {
  console.error("缺少环境变量 SQLITE_VEC_PATH")
  process.exit(1)
}

const vaultDir = process.argv[2] ?? DEFAULT_VAULT
const dataDir = await mkdtemp(path.join(tmpdir(), "ybrain-acceptance-"))
const db = openIndex({
  path: path.join(dataDir, "index.db"),
  vecExtension,
  customSqlitePath: process.env.CUSTOM_SQLITE_PATH,
})
const embedder = createEmbedder({ apiKey })
const search = createSearch({ db, embedder, reranker: createReranker({ apiKey }) })

console.log(`vault：${vaultDir}\n`)
console.log(`索引：${JSON.stringify(await createIndexer({ vaultDir, db, embedder }).reindexAll())}\n`)

const failures: string[] = []
for (const check of CHECKS) {
  const hits = await search.search(check.query, { k: 3 })
  console.log("=".repeat(72))
  console.log(`提问：${check.query}`)
  for (const hit of hits) {
    const preview = hit.snippet.replace(/\s+/g, " ").slice(0, 80)
    console.log(`  · [${hit.status}] ${hit.title}  (${hit.path})`)
    console.log(`    粗取 ${hit.vector_score.toFixed(3)} / 重排 ${hit.rerank_score.toFixed(3)}`)
    console.log(`    “${preview}…”`)
  }
  const problem = check.verify(hits)
  if (problem) failures.push(`${check.query} → ${problem}`)
  console.log(problem ? `  判定：不通过（${problem}）\n` : "  判定：通过\n")
}

await rm(dataDir, { recursive: true, force: true })
db.close()

if (failures.length > 0) {
  console.error(`验收未通过（${failures.length} 项）：`)
  failures.forEach((failure) => console.error(`  - ${failure}`))
  process.exit(1)
}
console.log("验收通过：四个演示提问的命中与阈值判断均符合票据 11 原型结论。")
