import { afterEach, describe, expect, it } from "bun:test"
import { mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { serveCapture } from "../src/capture"

// 捕获接口（票据 19）：通过真实 HTTP + 文件系统观察行为，不 mock 内部。
// 验收：三渠道正确落盘、错令牌 401、无 url 无 body 400（见各切片）。

const channels = { web: "tok-web", android: "tok-android", weread: "tok-weread" }

const servers: Array<{ stop: (closeActiveConnections?: boolean) => Promise<unknown> }> = []
afterEach(async () => {
  await Promise.all(servers.map((s) => s.stop(true)))
  servers.length = 0
})

type Ctx = { base: string; vaultDir: string; dataDir: string }

async function withServer<T>(fn: (ctx: Ctx) => Promise<T>): Promise<T> {
  const vaultDir = await mkdtemp(path.join(tmpdir(), "ybrain-vault-"))
  const dataDir = await mkdtemp(path.join(tmpdir(), "ybrain-data-"))
  const server = serveCapture({ vaultDir, dataDir, tokens: channels, port: 0 })
  servers.push(server)
  return fn({ base: `http://localhost:${server.port}`, vaultDir, dataDir })
}

async function post(base: string, token: string | null, body: unknown) {
  return fetch(`${base}/capture`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  })
}

// 解析 frontmatter（--- 之间的 YAML 行）为简单 key:value 字典；足够测试断言。
function parseFrontmatter(text: string): Record<string, string> {
  const m = text.match(/^---\n([\s\S]*?)\n---\n/)
  if (!m || m[1] === undefined) throw new Error("no frontmatter")
  const out: Record<string, string> = {}
  for (const line of m[1].split("\n")) {
    const i = line.indexOf(":")
    if (i > 0) out[line.slice(0, i).trim()] = line.slice(i + 1).trim()
  }
  return out
}

describe("capture endpoint /capture (ticket 19)", () => {
  it("writes an inbox note + enqueues a distill job for a valid web capture", async () => {
    await withServer(async ({ base, vaultDir, dataDir }) => {
      const res = await post(base, "tok-web", {
        source: "web",
        type: "note",
        title: "Hello World",
        body: "first capture body",
      })

      expect(res.status).toBe(200)
      const json = await res.json()
      expect(json.ok).toBe(true)
      expect(json.note_id).toMatch(/^\d{12}-[a-z0-9]{4}$/)
      expect(json.path).toMatch(/^0-Inbox\/\d{12}-[a-z0-9]{4}-hello-world\.md$/)

      const noteText = await Bun.file(path.join(vaultDir, String(json.path))).text()
      const fm = parseFrontmatter(noteText)
      expect(fm.id).toBe(json.note_id)
      expect(fm.title).toBe("Hello World")
      expect(fm.type).toBe("note")
      expect(fm.source).toBe("web")
      expect(fm.status).toBe("inbox")
      expect(fm.created).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)
      expect(noteText).toContain("first capture body")

      const jobs = (await Bun.file(path.join(dataDir, "jobs.jsonl")).text()).trim().split("\n")
      expect(jobs.length).toBe(1)
      const job = JSON.parse(jobs[0]!)
      expect(job.note_id).toBe(json.note_id)
      expect(job.type).toBe("distill")
      expect(job.status).toBe("queued")
    })
  })

  it("rejects a wrong bearer token with 401", async () => {
    await withServer(async ({ base }) => {
      const res = await post(base, "wrong-token", { source: "web", type: "note", body: "x" })
      expect(res.status).toBe(401)
    })
  })

  it("rejects a missing Authorization header with 401", async () => {
    await withServer(async ({ base }) => {
      const res = await post(base, null, { source: "web", type: "note", body: "x" })
      expect(res.status).toBe(401)
    })
  })

  it("rejects a capture with neither url nor body with 400", async () => {
    await withServer(async ({ base, dataDir, vaultDir }) => {
      const res = await post(base, "tok-web", { source: "web", type: "note", title: "empty" })
      expect(res.status).toBe(400)

      // 拒绝时不落盘、不入队
      expect(await Bun.file(path.join(dataDir, "jobs.jsonl")).exists()).toBe(false)
      expect(await Bun.file(path.join(vaultDir, "0-Inbox")).exists()).toBe(false)
    })
  })

  it("accepts the android channel token and records source=android", async () => {
    await withServer(async ({ base, vaultDir }) => {
      const res = await post(base, "tok-android", {
        source: "android",
        type: "note",
        title: "Shared text",
        body: "灵感片段",
      })
      expect(res.status).toBe(200)
      const json = await res.json()
      const fm = parseFrontmatter(await Bun.file(path.join(vaultDir, String(json.path))).text())
      expect(fm.source).toBe("android")
    })
  })

  it("accepts the weread channel token and records source=weread", async () => {
    await withServer(async ({ base, vaultDir }) => {
      const res = await post(base, "tok-weread", {
        source: "weread",
        type: "note",
        title: "划线",
        body: "书摘内容",
      })
      expect(res.status).toBe(200)
      const json = await res.json()
      const fm = parseFrontmatter(await Bun.file(path.join(vaultDir, String(json.path))).text())
      expect(fm.source).toBe("weread")
    })
  })

  it("lands a link-only note with fetch_failed when the url cannot be fetched", async () => {
    await withServer(async ({ base, vaultDir, dataDir }) => {
      // 端口 1 无服务监听 → 连接立即被拒
      const res = await post(base, "tok-web", {
        source: "web",
        type: "clip",
        url: "http://127.0.0.1:1/unreachable",
      })
      expect(res.status).toBe(200)
      const json = await res.json()
      const text = await Bun.file(path.join(vaultDir, String(json.path))).text()
      const fm = parseFrontmatter(text)
      expect(fm.url).toBe("http://127.0.0.1:1/unreachable")
      expect(fm.fetch_failed).toBe("true")
      expect(text).toContain("http://127.0.0.1:1/unreachable")

      const job = JSON.parse((await Bun.file(path.join(dataDir, "jobs.jsonl")).text()).trim())
      expect(job.note_id).toBe(json.note_id)
    })
  })

  it("backfills the note body from the page when body is missing", async () => {
    const page = Bun.serve({
      port: 0,
      fetch: () =>
        new Response(
          "<html><head><title>Fetched Title</title></head><body><article>Fetched body text</article></body></html>",
          { headers: { "Content-Type": "text/html" } },
        ),
    })
    servers.push(page)

    await withServer(async ({ base, vaultDir }) => {
      const res = await post(base, "tok-web", {
        source: "web",
        type: "clip",
        url: `http://localhost:${page.port}/article`,
      })
      expect(res.status).toBe(200)
      const json = await res.json()
      const text = await Bun.file(path.join(vaultDir, String(json.path))).text()
      const fm = parseFrontmatter(text)
      expect(fm.fetch_failed).toBeUndefined()
      expect(fm.title).toBe("Fetched Title")
      expect(text).toContain("Fetched body text")
    })
  })

  it("honours a client-supplied created time for id, filename and frontmatter", async () => {
    await withServer(async ({ base, vaultDir }) => {
      // 离线排队后补发的场景：捕获时刻由客户端决定，而非补发时刻
      const created = "2026-01-02T03:04:05+08:00"
      const res = await post(base, "tok-web", {
        source: "android",
        type: "note",
        title: "Backfilled",
        body: "queued while offline",
        created,
      })
      expect(res.status).toBe(200)
      const json = await res.json()
      expect(json.note_id).toMatch(/^202601020304-[a-z0-9]{4}$/)
      expect(json.path).toMatch(/^0-Inbox\/202601020304-[a-z0-9]{4}-backfilled\.md$/)

      const fm = parseFrontmatter(await Bun.file(path.join(vaultDir, String(json.path))).text())
      expect(fm.created).toBe(new Date(created).toISOString())
    })
  })
})
