import type { Plugin } from "@opencode-ai/plugin"
import { serveCapture } from "./capture"

// 外脑骨架插件：票据 17 验证进程内加载与密钥读取（脱敏打印）。
// 票据 19 起在进程内启动捕获接口（8787，仅 Tailscale 网卡由部署侧 compose 绑定）。
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

  if (vaultDir && dataDir && Object.keys(validTokens).length > 0) {
    serveCapture({ vaultDir, dataDir, tokens: validTokens })
  }

  return {
    event: async () => {},
  }
}
