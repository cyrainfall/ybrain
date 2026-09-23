// 分块器（票据 22）：逻辑照搬已验证原型
// .scratch/exobrain/prototypes/rag-prototype/search_demo.py（分块参数经原型实测确定）。

import { splitOriginal } from "./vault"

export const CHUNK_TARGET = 400 // 目标块长（字）
export const CHUNK_MAX = 600 // 硬上限（字）
const CHUNK_OVERLAP = 50 // 相邻块重叠（字）

// 提炼后的笔记只索引「## 原文」之前的提炼区；还没有提炼区的笔记索引全文——
// 包括正文已收进原文区但没提炼完、停在收件箱的笔记（票据 28），否则它们会从检索里消失。
export function indexableBody(body: string): string {
  const { distilled, original } = splitOriginal(body)
  if (!original) return body
  // 只有分隔线与空白＝提炼区还是空的
  return distilled.replace(/[-\s]/g, "") ? distilled : body
}

// 先按 Markdown 标题切段；超长段按中文句末标点切句，贪心聚合到目标块长。
export function splitChunks(body: string): string[] {
  return body
    .split(/\n(?=#{1,3} )/)
    .flatMap((section) => {
      const sec = section.trim()
      if (!sec) return []
      if (sec.length <= CHUNK_MAX) return [sec]

      // 贪心聚合：加下一句会超目标块长就先落盘，并以约 50 字重叠起新块。
      const chunks: string[] = []
      let buf = ""
      for (const sentence of sec.split(/(?<=[。！？!?\n])/)) {
        if (buf.length + sentence.length > CHUNK_TARGET && buf) {
          chunks.push(buf)
          buf = buf.slice(-CHUNK_OVERLAP) + sentence
        } else {
          buf += sentence
        }
      }
      if (buf.trim()) chunks.push(buf)
      return chunks
    })
    .map((chunk) => chunk.trim())
    .filter((chunk) => chunk.length > 0)
}
