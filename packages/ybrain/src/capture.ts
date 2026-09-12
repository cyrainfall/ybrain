import { appendFile, mkdir } from "node:fs/promises"
import path from "node:path"

// 捕获接口（票据 19）：Bun.serve 在 8787（仅 Tailscale 网卡由部署侧 compose 绑定）。
// POST /capture：Bearer 渠道令牌 → 写 0-Inbox Markdown → 入 jobs.jsonl → 返回 note_id/path。
// 详见 .scratch/exobrain/prototypes/capture-api.md 与 data-model.md。

export type CaptureConfig = {
  vaultDir: string
  dataDir: string
  tokens: Record<string, string>
  port?: number
}

export function serveCapture(config: CaptureConfig) {
  return Bun.serve({
    port: config.port ?? 8787,
    fetch: (req) => handleCapture(config, req),
  })
}

async function handleCapture(config: CaptureConfig, req: Request): Promise<Response> {
  if (req.method !== "POST" || new URL(req.url).pathname !== "/capture") {
    return json({ error: "not found" }, 404)
  }
  const channel = channelForToken(config, req.headers.get("Authorization"))
  if (!channel) return json({ error: "invalid token" }, 401)

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const url = hasText(body.url) ? body.url : undefined
  const inline = hasText(body.body) ? body.body : undefined
  if (!url && !inline) return json({ error: "url or body required" }, 400)

  // 捕获时刻由客户端决定（离线排队后补发仍记原始时间），缺省用服务器时间。
  const receivedAt = new Date()
  const clientCreated = hasText(body.created) ? new Date(body.created) : undefined
  const capturedAt = clientCreated && !Number.isNaN(clientCreated.getTime()) ? clientCreated : receivedAt

  const stamp = stampOf(hasText(body.created) ? body.created : undefined, capturedAt)
  const id = `${stamp}-${randomId(4)}`
  const meta = {
    id,
    type: String(body.type ?? "note"),
    source: String(body.source ?? channel),
    url,
    author: hasText(body.author) ? body.author : undefined,
    created: capturedAt.toISOString(),
  }
  const explicitTitle = hasText(body.title) ? body.title : undefined
  const title = explicitTitle ?? firstLine(inline) ?? (url ? authorityOf(url) : undefined) ?? "untitled"
  const relPath = `0-Inbox/${stamp}-${slugify(title)}.md`
  const absPath = path.join(config.vaultDir, relPath)
  await mkdir(path.dirname(absPath), { recursive: true })

  if (inline) {
    await Bun.write(absPath, renderNote({ ...meta, title, body: inline }))
  } else if (url) {
    // 先落盘仅链接笔记保证不丢，再同步抓取正文回填（票据 19：抓取失败标 fetch_failed）
    await Bun.write(absPath, renderNote({ ...meta, title, body: linkOnly(url) }))
    const article = await fetchArticle(url).catch(() => undefined)
    await Bun.write(
      absPath,
      renderNote({
        ...meta,
        title: explicitTitle ?? article?.title ?? title,
        body: article ? article.text : linkOnly(url),
        fetchFailed: !article,
      }),
    )
  }

  await enqueueJob(config, { noteId: id, type: "distill" })
  return json({ ok: true, note_id: id, path: relPath }, 200)
}

function channelForToken(config: CaptureConfig, header: string | null): string | null {
  if (!header?.startsWith("Bearer ")) return null
  const token = header.slice("Bearer ".length)
  return Object.keys(config.tokens).find((c) => config.tokens[c] === token) ?? null
}

function hasText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0
}

function firstLine(text: string | undefined): string | undefined {
  return text
    ?.split("\n")
    .map((line) => line.trim())
    .find((line) => line.length > 0)
}

// 返回 URL 的 authority（host 可含端口），用于缺省标题。
function authorityOf(url: string): string | undefined {
  return url.match(/^[a-z]+:\/\/([^/?#]+)/i)?.[1]
}

function linkOnly(url: string): string {
  return `原文链接：${url}`
}

// Readability 类提取的 MVP 版：去脚本/样式/标签后取纯文本，标题取 <title>。
async function fetchArticle(url: string): Promise<{ title?: string; text: string } | undefined> {
  const res = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(10_000) })
  if (!res.ok) return undefined
  const html = await res.text()
  const rawTitle = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]
  const text = collapseWhitespace(
    decodeEntities(
      html
        .replace(/<script[\s\S]*?<\/script>/gi, " ")
        .replace(/<style[\s\S]*?<\/style>/gi, " ")
        .replace(/<[^>]+>/g, " "),
    ),
  )
  if (!text) return undefined
  return { title: rawTitle ? decodeEntities(rawTitle).trim() : undefined, text }
}

function decodeEntities(text: string): string {
  return text
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
}

function collapseWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim()
}

function renderNote(args: {
  id: string
  title: string
  type: string
  source: string
  url?: string
  author?: string
  created: string
  body: string
  fetchFailed?: boolean
}): string {
  const lines = ["---"]
  lines.push(`id: ${args.id}`)
  lines.push(`title: ${yamlQuote(args.title)}`)
  lines.push(`type: ${args.type}`)
  lines.push(`source: ${args.source}`)
  if (args.url) lines.push(`url: ${args.url}`)
  if (args.author) lines.push(`author: ${yamlQuote(args.author)}`)
  lines.push(`created: ${args.created}`)
  if (args.fetchFailed) lines.push(`fetch_failed: true`)
  lines.push(`status: inbox`)
  lines.push("---")
  lines.push("")
  lines.push(args.body)
  return lines.join("\n") + "\n"
}

async function enqueueJob(config: CaptureConfig, job: { noteId: string; type: string }): Promise<void> {
  await mkdir(config.dataDir, { recursive: true })
  const record = {
    id: crypto.randomUUID(),
    note_id: job.noteId,
    type: job.type,
    status: "queued",
    retries: 0,
    error: null,
    created_at: new Date().toISOString(),
  }
  await appendFile(path.join(config.dataDir, "jobs.jsonl"), JSON.stringify(record) + "\n")
}

// 客户端给了 created 时，文件名前缀取其自述的墙上时间（不跨时区换算）。
function stampOf(created: string | undefined, fallback: Date): string {
  const parsed = created?.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/)
  if (parsed) return parsed.slice(1).join("")
  return formatStamp(fallback)
}

function formatStamp(date: Date): string {
  const p = (n: number) => String(n).padStart(2, "0")
  return (
    String(date.getFullYear()) + p(date.getMonth() + 1) + p(date.getDate()) + p(date.getHours()) + p(date.getMinutes())
  )
}

function randomId(len: number): string {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789"
  return Array.from({ length: len }, () => chars.charAt(Math.floor(Math.random() * chars.length))).join("")
}

function slugify(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
  return slug || "note"
}

function yamlQuote(value: string): string {
  return value.includes(":") || value.includes("#") ? JSON.stringify(value) : value
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  })
}
