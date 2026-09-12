import { describe, expect, it } from "bun:test"
import { parseNote, serializeNote, type NoteFrontmatter } from "../src/frontmatter"

// frontmatter 编解码（票据 22）：字段表见
// .scratch/exobrain/prototypes/data-model.md。必填 id/title/type/source/created/status。

const base: NoteFrontmatter = {
  id: "202609061032-abcd",
  title: "构建外脑",
  type: "clip",
  source: "web",
  created: "2026-09-06T10:32:00.000Z",
  status: "inbox",
}

describe("frontmatter codec", () => {
  it("round-trips frontmatter and body", () => {
    const body = "摘要内容\n\n## 原文\n原始正文"
    const text = serializeNote({ ...base, url: "https://example.com/x", author: "某人" }, body)

    expect(text.startsWith("---\n")).toBe(true)
    const parsed = parseNote(text)
    expect(parsed.frontmatter).toEqual({ ...base, url: "https://example.com/x", author: "某人" })
    expect(parsed.body.trim()).toBe(body)
  })

  it("keeps the created timestamp as an ISO string, not a Date", () => {
    const parsed = parseNote(serializeNote(base, "正文"))
    expect(parsed.frontmatter.created).toBe("2026-09-06T10:32:00.000Z")
    expect(typeof parsed.frontmatter.created).toBe("string")
  })

  it("parses YAML list fields into arrays", () => {
    const text = serializeNote(
      { ...base, status: "distilled", tags: ["威科夫", "投资"], related: ["[[另一篇笔记]]"] },
      "正文",
    )
    const { frontmatter } = parseNote(text)
    expect(frontmatter.tags).toEqual(["威科夫", "投资"])
    expect(frontmatter.related).toEqual(["[[另一篇笔记]]"])
  })

  it("survives values that would otherwise break YAML", () => {
    const title = "标题: 含冒号 # 和井号"
    const parsed = parseNote(serializeNote({ ...base, title }, "正文"))
    expect(parsed.frontmatter.title).toBe(title)
  })

  it("omits fields that are not set", () => {
    const parsed = parseNote(serializeNote({ ...base, author: undefined, url: undefined }, "正文"))
    expect("author" in parsed.frontmatter).toBe(false)
    expect("url" in parsed.frontmatter).toBe(false)
  })
})
