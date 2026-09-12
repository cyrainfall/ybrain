import { describe, expect, it } from "bun:test"
import { indexableBody, splitChunks } from "../src/chunk"

// 分块器（票据 22）：纯函数，逻辑照搬已验证原型
// .scratch/exobrain/prototypes/rag-prototype/search_demo.py。
// 参数：目标块长 400 字 / 硬上限 600 字 / 重叠约 50 字。

describe("indexableBody", () => {
  it("returns the whole body when there is no 原文 section", () => {
    expect(indexableBody("摘要\n\n要点")).toBe("摘要\n\n要点")
  })

  it("keeps only the distilled part before the 原文 section", () => {
    const body = "摘要内容\n\n---\n\n## 原文\n原始正文不该入索引"
    const result = indexableBody(body)
    expect(result).toContain("摘要内容")
    expect(result).not.toContain("原始正文不该入索引")
    expect(result).not.toContain("## 原文")
  })
})

describe("splitChunks", () => {
  it("splits a body into one chunk per markdown section", () => {
    const body = "# 第一章\n内容一\n\n## 第二节\n内容二"
    expect(splitChunks(body)).toEqual(["# 第一章\n内容一", "## 第二节\n内容二"])
  })

  it("drops empty sections", () => {
    expect(splitChunks("\n\n# 只有一节\n内容")).toEqual(["# 只有一节\n内容"])
  })

  it("aggregates a long section into overlapping chunks within the hard limit", () => {
    // 40 句互不相同的中文句子，每句约 24 字 → 单节约 960 字，超过 600 上限，触发句子聚合
    const sentences = Array.from({ length: 40 }, (_, i) => `第${String(i).padStart(3, "0")}句${"内容".repeat(8)}。`)
    const body = sentences.join("")

    const chunks = splitChunks(body)

    // 长节必须被切成多块
    expect(chunks.length).toBeGreaterThan(1)
    // 硬上限 600 字
    for (const chunk of chunks) expect(chunk.length).toBeLessThanOrEqual(600)
    // 相邻块按“取前块末 50 字”重叠
    for (let i = 1; i < chunks.length; i++) {
      expect(chunks[i]!.startsWith(chunks[i - 1]!.slice(-50))).toBe(true)
    }
    // 不丢内容：每句都能在某个块里找到
    const joined = chunks.join("")
    for (const sentence of sentences) expect(joined).toContain(sentence.slice(0, 7))
  })
})
