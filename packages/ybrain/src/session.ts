import type { PluginInput } from "@opencode-ai/plugin"

// 进程内无头代理会话（票据 24）：调度器通过本机 HTTP API 编程式创建会话，
// 与本人在 Web 界面的对话隔离（代理身份由 agent 参数指定：ybrain-distiller / ybrain-reviewer）。
// 规范依据 .scratch/exobrain/prototypes/distill-workflow.md §1。

export type HeadlessClient = PluginInput["client"]

export type PromptOptions = {
  sessionID: string
  agent: string
  text: string
  timeoutMs?: number
}

// 生成式 SDK 默认不抛错，错误放在 error 字段；这里统一转成异常供调度器重试。
function requireOk<T>(result: { data?: T; error?: unknown }, what: string): T {
  if (result.error || result.data === undefined) {
    throw new Error(`${what}失败：${errorText(result.error)}`)
  }
  return result.data
}

function errorText(error: unknown): string {
  if (!error) return "未知错误"
  if (typeof error === "string") return error
  const detail = (error as { detail?: { message?: string } }).detail
  if (detail?.message) return detail.message
  if (error instanceof Error) return error.message
  return JSON.stringify(error)
}

export async function startSession(client: HeadlessClient, title: string): Promise<string> {
  const created = await client.session.create({ body: { title } })
  return requireOk(created, "创建会话").id
}

// 同步 prompt 接口在整个代理循环结束后才返回；signal 超时会中断底层 HTTP，
// 调用方还应再 abort 一次会话，让服务端的 provider 循环真正停下来。
export async function runPrompt(client: HeadlessClient, options: PromptOptions): Promise<void> {
  const signal = options.timeoutMs ? AbortSignal.timeout(options.timeoutMs) : undefined
  const result = await client.session.prompt({
    path: { id: options.sessionID },
    body: {
      agent: options.agent,
      parts: [{ type: "text", text: options.text }],
    },
    ...(signal ? { signal } : {}),
  })
  requireOk(result, "代理执行")
}

export async function abortSession(client: HeadlessClient, sessionID: string): Promise<void> {
  await client.session.abort({ path: { id: sessionID } }).catch(() => {})
}

export async function deleteSession(client: HeadlessClient, sessionID: string): Promise<void> {
  await client.session.delete({ path: { id: sessionID } }).catch(() => {})
}

// 起会话 → 跑一轮 → 出错就中断并把会话留给排障，返回 sessionID。
// 提炼与周复盘共用这段生命周期，只是后续对会话的处置不同（删除 / 保留读取）。
export async function runHeadlessSession(
  client: HeadlessClient,
  options: { title: string; agent: string; text: string; timeoutMs?: number },
): Promise<string> {
  const sessionID = await startSession(client, options.title)
  try {
    await runPrompt(client, {
      sessionID,
      agent: options.agent,
      text: options.text,
      timeoutMs: options.timeoutMs,
    })
  } catch (error) {
    await abortSession(client, sessionID)
    throw error
  }
  return sessionID
}

// 取会话最后一条助手消息的文本（周报复盘用）。
export async function lastAssistantText(client: HeadlessClient, sessionID: string): Promise<string> {
  const messages = requireOk(await client.session.messages({ path: { id: sessionID } }), "读取会话消息")
  const last = [...messages].reverse().find((message) => message.info.role === "assistant")
  if (!last) return ""
  return last.parts
    .flatMap((part) => (part.type === "text" ? [part.text] : []))
    .join("\n")
    .trim()
}
