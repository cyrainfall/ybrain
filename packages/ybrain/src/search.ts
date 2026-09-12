import type { Database } from "bun:sqlite"
import type { Embedder, Reranker } from "./siliconflow"

// 检索（票据 22）：向量粗取 top retrieveK → 重排精取 top k，与 Python 原型
// search_demo.py 同流程。重排分 < 0.1 视为「资料不足」的判定由代理侧执行（票据 23）。

export type SearchHit = {
  note_id: string
  title: string
  path: string
  url: string | null
  status: string
  snippet: string
  vector_score: number
  rerank_score: number
}

export type SearchDeps = {
  db: Database
  embedder: Embedder
  reranker: Reranker
  retrieveK?: number
}

type Candidate = {
  snippet: string
  note_id: string
  title: string
  path: string
  status: string
  url: string | null
  distance: number
}

export function createSearch(deps: SearchDeps) {
  const retrieveK = deps.retrieveK ?? 8

  async function search(query: string, options: { k?: number } = {}): Promise<SearchHit[]> {
    const [queryVector] = await deps.embedder.embed([query])
    if (!queryVector) return []

    const candidates = deps.db
      .query(
        `select c.text as snippet, c.note_id as note_id, n.title as title,
                n.path as path, n.status as status, n.url as url, v.distance as distance
         from vec_chunks v
         join chunks c on c.id = v.rowid
         join notes n on n.id = c.note_id
         where v.embedding match ? and k = ?
         order by v.distance`,
      )
      .all(Buffer.from(new Float32Array(queryVector).buffer), retrieveK) as Candidate[]

    if (candidates.length === 0) return []

    const hits = await deps.reranker.rerank(
      query,
      candidates.map((candidate) => candidate.snippet),
      options.k ?? 5,
    )

    return hits.flatMap((hit) => {
      const candidate = candidates[hit.index]
      if (!candidate) return []
      return [
        {
          note_id: candidate.note_id,
          title: candidate.title,
          path: candidate.path,
          url: candidate.url,
          status: candidate.status,
          snippet: candidate.snippet,
          vector_score: cosineFromDistance(candidate.distance),
          rerank_score: hit.score,
        },
      ]
    })
  }

  return { search }
}

// bge-m3 输出已归一化，L2 距离 d 与余弦相似度满足 cos = 1 − d²/2（粗取分仅供调试）。
function cosineFromDistance(distance: number): number {
  return Math.max(-1, Math.min(1, 1 - (distance * distance) / 2))
}
