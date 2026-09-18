import { afterEach, describe, expect, it } from "bun:test"
import { CaptureError, buildPayload, isPermanentFailure, parseTags, sendCapture } from "../lib/capture.js"

// 捕获请求（票据 20）：请求体形状 + 真实 HTTP 投递（不 mock fetch，用一个真 server 观察收到的请求）。

const servers: Array<{ stop: (closeActiveConnections?: boolean) => Promise<unknown> }> = []
afterEach(async () => {
  await Promise.all(servers.map((server) => server.stop(true)))
  servers.length = 0
})

const article = {
  title: "  标题  ",
  byline: " 作者 ",
  textContent: "正文内容",
  url: "https://example.com/a",
}

// 投递失败的两种形态（HTTP 状态码 / 断网）都从异常里取，测试里统一收口
async function failure(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise
  } catch (error) {
    return error instanceof Error ? error : new Error(String(error))
  }
  throw new Error("expected the capture to fail")
}

describe("capture payload (ticket 20)", () => {
  it("maps an extracted article onto the /capture contract", () => {
    const payload = buildPayload(article, { tags: ["架构"], createdAt: "2026-09-18T10:00:00.000Z" })

    expect(payload).toEqual({
      source: "web",
      type: "clip",
      title: "标题",
      author: "作者",
      body: "正文内容",
      url: "https://example.com/a",
      tags: ["架构"],
      created: "2026-09-18T10:00:00.000Z",
    })
  })

  it("omits empty title, author and tags so the server can fill them in", () => {
    const payload = buildPayload({ title: " ", byline: "", textContent: "x", url: "https://example.com" })

    expect(payload.title).toBeUndefined()
    expect(payload.author).toBeUndefined()
    expect(payload.tags).toBeUndefined()
    expect(payload.created).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })

  it("splits tags on ascii/chinese commas, enum punctuation and spaces", () => {
    expect(parseTags("架构, tailscale，知识管理、剪藏 架构")).toEqual(["架构", "tailscale", "知识管理", "剪藏"])
    expect(parseTags("  ")).toEqual([])
  })
})

describe("capture delivery (ticket 20)", () => {
  it("posts the payload to /capture with the bearer token", async () => {
    let received: { url: string; method: string; auth: string | null; body: unknown } | undefined
    const server = Bun.serve({
      port: 0,
      fetch: async (req) => {
        received = {
          url: new URL(req.url).pathname,
          method: req.method,
          auth: req.headers.get("Authorization"),
          body: await req.json(),
        }
        return Response.json({ ok: true, note_id: "202609181000-abcd", path: "0-Inbox/202609181000-abcd-t.md" })
      },
    })
    servers.push(server)

    const settings = { endpoint: `http://localhost:${server.port}`, token: "tok-web" }
    const result = await sendCapture(settings, buildPayload(article, { createdAt: "2026-09-18T10:00:00.000Z" }))

    expect(result).toEqual({ ok: true, note_id: "202609181000-abcd", path: "0-Inbox/202609181000-abcd-t.md" })
    expect(received?.url).toBe("/capture")
    expect(received?.method).toBe("POST")
    expect(received?.auth).toBe("Bearer tok-web")
    expect(received?.body).toMatchObject({ source: "web", type: "clip", body: "正文内容" })
  })

  it("treats a 400 as permanent so the queue does not keep a request the server will always reject", async () => {
    const server = Bun.serve({
      port: 0,
      fetch: () => Response.json({ error: "url or body required" }, { status: 400 }),
    })
    servers.push(server)

    const rejected = await failure(sendCapture({ endpoint: `http://localhost:${server.port}`, token: "t" }, {}))
    expect(rejected).toBeInstanceOf(CaptureError)
    expect(String(rejected)).toBe("CaptureError: HTTP 400")
    expect(isPermanentFailure(rejected)).toBe(true)
  })

  it("keeps 401 and unreachable servers as retryable so fixing config or network flushes them", async () => {
    const unauthorized = Bun.serve({
      port: 0,
      fetch: () => Response.json({ error: "invalid token" }, { status: 401 }),
    })
    servers.push(unauthorized)

    const rejected = await failure(
      sendCapture({ endpoint: `http://localhost:${unauthorized.port}`, token: "wrong" }, {}),
    )
    expect(String(rejected)).toBe("CaptureError: HTTP 401")
    expect(isPermanentFailure(rejected)).toBe(false)

    // 断网：fetch 直接抛 TypeError，同样留在队列里等补发
    const unreachable = Object.assign(() => Promise.reject(new TypeError("Failed to fetch")), {
      preconnect: fetch.preconnect,
    })
    const offline = await failure(sendCapture({ endpoint: "http://100.64.0.1:8787", token: "t" }, {}, unreachable))
    expect(offline).toBeInstanceOf(TypeError)
    expect(isPermanentFailure(offline)).toBe(false)
  })
})
