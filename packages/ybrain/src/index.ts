import type { Plugin } from "@opencode-ai/plugin"
import path from "node:path"
import { serveCapture } from "./capture"
import { openIndex } from "./db"
import { createIndexer } from "./indexer"
import { createEmbedder } from "./siliconflow"
import { watchVault } from "./watcher"

// 外脑插件入口：票据 17 骨架 + 票据 19 捕获接口 + 票据 22 数据层（索引、重建、变更监听）。
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

  const index = createIndex(vaultDir, dataDir)
  if (index && vaultDir) {
    // 启动自跑：hash 命中即跳过，未变的笔记不会重复嵌入
    index
      .reindexAll()
      .then((result) => console.log(`ybrain reindex: ${JSON.stringify(result)}`))
      .catch((error) => console.error(`ybrain reindex failed: ${error}`))
    watchVault({ vaultDir, onNoteChange: index.syncNote })
  }

  if (vaultDir && dataDir && Object.keys(validTokens).length > 0) {
    serveCapture({ vaultDir, dataDir, tokens: validTokens, onReindex: index?.reindexAll })
  }

  return {
    event: async () => {},
  }
}

// 向量扩展与模型密钥齐备时才启用索引能力；缺任一项则只保留捕获接口。
function createIndex(vaultDir: string | undefined, dataDir: string | undefined) {
  const vecExtension = process.env.SQLITE_VEC_PATH
  const apiKey = process.env.SILICONFLOW_API_KEY
  if (!vaultDir || !dataDir || !vecExtension || !apiKey) {
    console.warn(
      "ybrain index disabled (需要 YBRAIN_VAULT_DIR / YBRAIN_DATA_DIR / SQLITE_VEC_PATH / SILICONFLOW_API_KEY)",
    )
    return undefined
  }
  const db = openIndex({
    path: path.join(dataDir, "index.db"),
    vecExtension,
    customSqlitePath: process.env.CUSTOM_SQLITE_PATH,
  })
  return createIndexer({ vaultDir, db, embedder: createEmbedder({ apiKey }) })
}
