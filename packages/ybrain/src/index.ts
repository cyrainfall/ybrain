import type { Plugin } from "@opencode-ai/plugin"
import path from "node:path"
import { serveCapture } from "./capture"
import { openIndex } from "./db"
import { createIndexer } from "./indexer"
import { createSearch } from "./search"
import { createEmbedder, createReranker } from "./siliconflow"
import { createTools } from "./tools"
import { watchVault } from "./watcher"

// 外脑插件入口：票据 17 骨架 + 票据 19 捕获接口 + 票据 22 数据层
// + 票据 23 四个原生知识工具（代理系统指令随镜像发在 /opt/ybrain/AGENTS.md）。
export const server: Plugin = async () => {
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

  const configured = Boolean(process.env.DEEPSEEK_API_KEY && process.env.SILICONFLOW_API_KEY)
  console.log(`ybrain plugin loaded (configured=${configured})`)

  const knowledge = createKnowledge(vaultDir, dataDir)
  if (knowledge && vaultDir) {
    // 启动自跑：hash 命中即跳过，未变的笔记不会重复嵌入
    knowledge
      .reindexAll()
      .then((result) => console.log(`ybrain reindex: ${JSON.stringify(result)}`))
      .catch((error) => console.error(`ybrain reindex failed: ${error}`))
    watchVault({ vaultDir, onNoteChange: knowledge.syncNote })
  }

  if (vaultDir && dataDir && Object.keys(validTokens).length > 0) {
    serveCapture({ vaultDir, dataDir, tokens: validTokens, onReindex: knowledge?.reindexAll })
  }

  return {
    event: async () => {},
    ...(knowledge ? { tool: knowledge.tools } : {}),
  }
}

// 向量扩展与模型密钥齐备时才启用索引、检索与知识工具；缺任一项则只保留捕获接口。
function createKnowledge(vaultDir: string | undefined, dataDir: string | undefined) {
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

  return {
    reindexAll: indexer.reindexAll,
    syncNote: indexer.syncNote,
    tools: createTools({ vaultDir, db, search: search.search, reindexNote: indexer.reindexNote }),
  }
}
