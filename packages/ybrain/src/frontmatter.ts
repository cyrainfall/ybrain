import matter from "gray-matter"

// frontmatter 编解码（票据 22）：字段表见 .scratch/exobrain/prototypes/data-model.md。
// 必填 id/title/type/source/created/status；其余按需出现。
export type NoteFrontmatter = {
  id: string
  title: string
  type: string
  source: string
  created: string
  status: string
  url?: string
  author?: string
  tags?: string[]
  summary?: string
  related?: string[]
  distilled_at?: string
  distill_model?: string
  book?: string
  chapter?: string
  fetch_failed?: boolean
}

export function parseNote(text: string): { frontmatter: NoteFrontmatter; body: string } {
  const parsed = matter(text)
  return { frontmatter: toIsoStrings(parsed.data as Record<string, unknown>), body: parsed.content }
}

export function serializeNote(frontmatter: NoteFrontmatter, body: string): string {
  return matter.stringify(
    body,
    Object.fromEntries(Object.entries(frontmatter).filter(([, value]) => value !== undefined)),
  )
}

// js-yaml 会把 ISO 时间解析成 Date；本系统一律以字符串存时间（data-model 字段表）。
function toIsoStrings(data: Record<string, unknown>): NoteFrontmatter {
  return Object.fromEntries(
    Object.entries(data).map(([key, value]) => [key, value instanceof Date ? value.toISOString() : value]),
  ) as NoteFrontmatter
}
