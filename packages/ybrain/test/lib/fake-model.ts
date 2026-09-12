import { EMBEDDING_DIM } from "../../src/db"

// 测试替身：外部模型 API（嵌入 / 重排）的确定性实现。
// 用「字符袋」构造向量与相关性分——同一输入必得同一结果，且文本越相近分越高，
// 足以驱动真实的向量检索与重排排序，不依赖网络与密钥。

export function fakeEmbedder() {
  const batches: string[][] = []
  return {
    batches,
    async embed(texts: string[]): Promise<number[][]> {
      batches.push(texts)
      return texts.map((text) => {
        const counts = new Float32Array(EMBEDDING_DIM)
        Array.from(text).forEach((char) => {
          const slot = hashOf(char) % EMBEDDING_DIM
          counts[slot] = (counts[slot] ?? 0) + 1
        })
        const norm = Math.sqrt(Array.from(counts).reduce((sum, value) => sum + value * value, 0)) || 1
        return Array.from(counts, (value) => value / norm)
      })
    },
  }
}

export function fakeReranker() {
  return {
    async rerank(query: string, documents: string[], topN: number): Promise<{ index: number; score: number }[]> {
      const queryChars = new Set(Array.from(query))
      return documents
        .map((doc, index) => ({ index, score: sharedRatio(queryChars, doc) }))
        .sort((a, b) => b.score - a.score)
        .slice(0, topN)
    },
  }
}

// query 中有多大比例的字符出现在文档里；无共同字符即 0（用于验证可靠性阈值）。
function sharedRatio(queryChars: Set<string>, doc: string): number {
  if (queryChars.size === 0) return 0
  const shared = Array.from(new Set(Array.from(doc))).filter((char) => queryChars.has(char)).length
  return shared / queryChars.size
}

const hashOf = (text: string) =>
  Array.from(text).reduce((hash, char) => (hash * 31 + (char.codePointAt(0) ?? 0)) % 1_000_003, 0)
