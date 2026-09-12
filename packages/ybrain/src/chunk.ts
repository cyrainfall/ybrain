// 分块器（票据 22）：逻辑照搬已验证原型
// .scratch/exobrain/prototypes/rag-prototype/search_demo.py（分块参数经原型实测确定）。

export const CHUNK_TARGET = 400 // 目标块长（字）
export const CHUNK_MAX = 600 // 硬上限（字）
const CHUNK_OVERLAP = 50 // 相邻块重叠（字）

// 提炼后的笔记只索引「## 原文」之前的提炼区；收件箱笔记（无原文区）索引全文。
export function indexableBody(body: string): string {
  const idx = body.indexOf("## 原文")
  return idx >= 0 ? body.slice(0, idx) : body
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
