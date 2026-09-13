import type { Plugin, PluginInput } from "@opencode-ai/plugin"
import path from "node:path"
import { configureAgents, DEFAULT_MODEL, DISTILLER_AGENT, REVIEWER_AGENT } from "./agent"
import { serveCapture } from "./capture"
import { openIndex, openQueue } from "./db"
import { runDistillJob } from "./distiller"
import { createIndexer } from "./indexer"
import { enqueue } from "./queue"
import { startScheduler } from "./scheduler"
import { createSearch } from "./search"
import { createEmbedder, createReranker } from "./siliconflow"
import { createTools } from "./tools"
import { watchVault } from "./watcher"
import { startWeeklyReview } from "./weekly"

// 外脑插件入口：票据 17 骨架 + 票据 19 捕获接口 + 票据 22 数据层
// + 票据 23 四个原生知识工具 + 票据 24 提炼队列/distiller 会话/周复盘。
export const server: Plugin = async (input: PluginInput) => {
  const vaultDir = process.env.YBRAIN_VAULT_DIR
  const dataDir = process.env.YBRAIN_DATA_DIR
  const tokens = {
    web: process.env.CAPTURE_TOKEN_WEB,
    android: process.env.CAPTURE_TOKEN_ANDROID,
    weread: process.env.CAPTURE_TOKEN_WEREAD,
  }
  const validTokens = Object.fromEntries(
    Object.entries(tokens).filter((entry): entry is [string, string] => Boolean(entry[1])),
  )
  const model = process.env.YBRAIN_DISTILL_MODEL ?? DEFAULT_MODEL

  const configured = Boolean(process.env.DEEPSEEK_API_KEY && process.env.SILICONFLOW_API_KEY)
  console.log(`ybrain plugin loaded (configured=${configured})`)

  const knowledge = createKnowledge(vaultDir, dataDir, model)
  // 队列优先复用知识连接；索引能力缺扩展时退化为只开 jobs 表的普通连接（捕获不依赖向量扩展）。
  const queueDb = knowledge?.db ?? (vaultDir && dataDir ? openQueue(path.join(dataDir, "index.db")) : undefined)
  const disposers: Array<() => Promise<void> | void> = []

  if (knowledge && vaultDir) {
    // 启动自跑：hash 命中即跳过，未变的笔记不会重复嵌入
    knowledge
      .reindexAll()
      .then((result) => console.log(`ybrain reindex: ${JSON.stringify(result)}`))
      .catch((error) => console.error(`ybrain reindex failed: ${error}`))
    disposers.push(watchVault({ vaultDir, onNoteChange: knowledge.syncNote }))
  }

  if (vaultDir && queueDb && Object.keys(validTokens).length > 0) {
    const captureServer = serveCapture({
      vaultDir,
      tokens: validTokens,
      enqueue: (job) => {
        enqueue(queueDb, job)
      },
      onReindex: knowledge?.reindexAll,
    })
    disposers.push(() => captureServer.stop(true))
  }

  // 提炼调度与周复盘需要知识工具与聊天模型密钥齐备；否则只保留捕获/入队，恢复后补处理。
  if (knowledge && vaultDir && queueDb && process.env.DEEPSEEK_API_KEY) {
    const scheduler = startScheduler({
      db: queueDb,
      vaultDir,
      run: async (job) => {
        await runDistillJob({ client: input.client, db: queueDb, vaultDir, agent: DISTILLER_AGENT }, job)
      },
    })
    disposers.push(() => scheduler.stop())

    const weekly = startWeeklyReview({
      client: input.client,
      db: queueDb,
      vaultDir,
      reindexNote: knowledge.reindexNote,
      agent: REVIEWER_AGENT,
      hour: process.env.YBRAIN_WEEKLY_REVIEW_HOUR ? Number(process.env.YBRAIN_WEEKLY_REVIEW_HOUR) : undefined,
    })
    disposers.push(() => weekly.stop())
  }

  return {
    config: async (config) => configureAgents(config, model),
    dispose: async () => {
      for (const dispose of disposers.reverse()) await dispose()
      queueDb?.close()
    },
    ...(knowledge ? { tool: knowledge.tools } : {}),
  }
}

// 向量扩展与模型密钥齐备时才启用索引、检索与知识工具；缺任一项则只保留捕获接口。
function createKnowledge(vaultDir: string | undefined, dataDir: string | undefined, distillModel: string) {
  const vecExtension = process.env.SQLITE_VEC_PATH
  const apiKey = process.env.SILICONFLOW_API_KEY
  if (!vaultDir || !dataDir || !vecExtension || !apiKey) {
    console.warn(
      "ybrain knowledge disabled (需要 YBRAIN_VAULT_DIR / YBRAIN_DATA_DIR / SQLITE_VEC_PATH / SILICONFLOW_API_KEY)",
    )
    return undefined
  }

  const db = openIndex({
    path: path.join(dataDir, "index.db"),
    vecExtension,
    customSqlitePath: process.env.CUSTOM_SQLITE_PATH,
  })
  const embedder = createEmbedder({ apiKey })
  const indexer = createIndexer({ vaultDir, db, embedder })
  const search = createSearch({ db, embedder, reranker: createReranker({ apiKey }) })

  const tools = createTools({
    vaultDir,
    db,
    search: search.search,
    reindexNote: indexer.reindexNote,
    distillModel,
  })

  return {
    db,
    reindexAll: indexer.reindexAll,
    reindexNote: indexer.reindexNote,
    syncNote: indexer.syncNote,
    tools,
  }
}
