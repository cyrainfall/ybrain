// 嵌入 / 重排（票据 22）：外部 API 走端口隔开，测试注入确定性替身。
// 选型见票据 07；模型与参数见 prototypes/rag-tools-and-prompt.md §3。
// 契约（与 Python 原型 search_demo.py 一致）：
//   POST /embeddings { model, input: string[] }        → { data: [{ embedding: number[] }] }
//   POST /rerank     { model, query, documents, top_n } → { results: [{ index, relevance_score }] }

export const SILICONFLOW_BASE_URL = "https://api.siliconflow.cn/v1"
export const EMBED_MODEL = "BAAI/bge-m3"
export const RERANK_MODEL = "BAAI/bge-reranker-v2-m3"

export type Embedder = { embed(texts: string[]): Promise<number[][]> }
export type RerankHit = { index: number; score: number }
export type Reranker = { rerank(query: string, documents: string[], topN: number): Promise<RerankHit[]> }

export type SiliconFlowConfig = { apiKey: string; baseUrl?: string; embedModel?: string; rerankModel?: string }

export function createEmbedder(config: SiliconFlowConfig): Embedder {
  return {
    async embed(texts) {
      return (
        await post<{ data: { embedding: number[] }[] }>(config, "/embeddings", {
          model: config.embedModel ?? EMBED_MODEL,
          input: texts,
        })
      ).data.map((item) => item.embedding)
    },
  }
}

export function createReranker(config: SiliconFlowConfig): Reranker {
  return {
    async rerank(query, documents, topN) {
      return (
        await post<{ results: { index: number; relevance_score: number }[] }>(config, "/rerank", {
          model: config.rerankModel ?? RERANK_MODEL,
          query,
          documents,
          top_n: topN,
          return_documents: false,
        })
      ).results.map((hit) => ({ index: hit.index, score: hit.relevance_score }))
    },
  }
}

async function post<T>(config: SiliconFlowConfig, path: string, payload: unknown): Promise<T> {
  const res = await fetch(`${config.baseUrl ?? SILICONFLOW_BASE_URL}${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${config.apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(60_000),
  })
  if (!res.ok) throw new Error(`SiliconFlow ${path} 失败：HTTP ${res.status} ${await res.text()}`)
  return (await res.json()) as T
}
