import type { Plugin } from "@opencode-ai/plugin"

// 外脑骨架插件：票据 17 只验证进程内加载与密钥读取（脱敏打印）。
// 捕获接口、知识工具、提炼队列在票据 19/22/23/24 中扩展。
export const server: Plugin = async () => {
  const configured = Boolean(process.env.DEEPSEEK_API_KEY && process.env.SILICONFLOW_API_KEY)
  console.log(`ybrain plugin loaded (configured=${configured})`)
  return {
    event: async () => {},
  }
}
