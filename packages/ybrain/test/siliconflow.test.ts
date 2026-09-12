import { afterEach, describe, expect, it } from "bun:test"
import { createEmbedder, createReranker, EMBED_MODEL, RERANK_MODEL } from "../src/siliconflow"

// 嵌入 / 重排（票据 22）：外部 API 用端口隔开，真实现按 SiliconFlow 契约发请求。
// 这里用本地 stub HTTP 服务器做真实请求-响应验证（不 mock 内部，不花钱、不进 CI 外网）。

const servers: Array<{ stop: (closeActiveConnections?: boolean) => Promise<unknown> }> = []
afterEach(async () => {
  await Promise.all(servers.map((server) => server.stop(true)))
  servers.length = 0
})

type Captured = { path: string; auth: string | null; body: unknown }

function stub(handler: (req: Request) => Response | Promise<Response>): string {
  const server = Bun.serve({ port: 0, fetch: handler })
  servers.push(server)
  return `http://localhost:${server.port}`
}

function captureRequests(respond: (body: unknown) => Response): { base: string; seen: Captured[] } {
  const seen: Captured[] = []
  const base = stub(async (req) => {
    const body = await req.json()
    seen.push({ path: new URL(req.url).pathname, auth: req.headers.get("authorization"), body })
    return respond(body)
  })
  return { base, seen }
}

describe("createEmbedder", () => {
  it("posts the batch to /embeddings and returns vectors in input order", async () => {
    const { base, seen } = captureRequests(() =>
      Response.json({ data: [{ embedding: [0.1, 0.2] }, { embedding: [0.3, 0.4] }] }),
    )

    const vectors = await createEmbedder({ apiKey: "k", baseUrl: base }).embed(["甲", "乙"])

    expect(vectors).toEqual([
      [0.1, 0.2],
      [0.3, 0.4],
    ])
    expect(seen[0]?.path).toBe("/embeddings")
    expect(seen[0]?.auth).toBe("Bearer k")
    expect(seen[0]?.body).toEqual({ model: EMBED_MODEL, input: ["甲", "乙"] })
  })

  it("throws when the API responds with an error", async () => {
    const base = stub(() => new Response("unauthorized", { status: 401 }))
    await expect(createEmbedder({ apiKey: "bad", baseUrl: base }).embed(["x"])).rejects.toThrow()
  })
})

describe("createReranker", () => {
  it("posts to /rerank and maps index/score pairs", async () => {
    const { base, seen } = captureRequests(() =>
      Response.json({
        results: [
          { index: 1, relevance_score: 0.9 },
          { index: 0, relevance_score: 0.2 },
        ],
      }),
    )

    const hits = await createReranker({ apiKey: "k", baseUrl: base }).rerank("问题", ["甲", "乙"], 2)

    expect(hits).toEqual([
      { index: 1, score: 0.9 },
      { index: 0, score: 0.2 },
    ])
    expect(seen[0]?.path).toBe("/rerank")
    expect(seen[0]?.body).toEqual({
      model: RERANK_MODEL,
      query: "问题",
      documents: ["甲", "乙"],
      top_n: 2,
      return_documents: false,
    })
  })
})
