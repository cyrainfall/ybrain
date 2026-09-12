import { mkdir, rename } from "node:fs/promises"
import path from "node:path"
import { parseNote, serializeNote, type NoteFrontmatter } from "./frontmatter"

// vault 读写（票据 22）：笔记文件是真相源，SQLite 只是可重建的检索加速层。
// 目录与命名规则、正文结构见 .scratch/exobrain/prototypes/data-model.md。

export type Note = { frontmatter: NoteFrontmatter; body: string }

export async function readNote(vaultDir: string, relPath: string): Promise<Note> {
  return parseNote(await Bun.file(path.join(vaultDir, relPath)).text())
}

export async function writeNote(vaultDir: string, relPath: string, note: Note): Promise<void> {
  const absPath = path.join(vaultDir, relPath)
  await mkdir(path.dirname(absPath), { recursive: true })
  await Bun.write(absPath, serializeNote(note.frontmatter, note.body))
}

// PARA 移动 = 文件系统改名并保留原名；Git 提交由票据 25 负责。
export async function moveNote(vaultDir: string, relPath: string, targetDir: string): Promise<string> {
  const target = path.join(targetDir, path.basename(relPath))
  await mkdir(path.join(vaultDir, path.dirname(target)), { recursive: true })
  await rename(path.join(vaultDir, relPath), path.join(vaultDir, target))
  return target
}

// 文件名 = id + slug：id 唯一，故同分钟同标题也不会互相覆盖；时间戳前缀可直接排序。
export function noteFileName(id: string, title: string): string {
  return `${id}-${slugify(title)}.md`
}

const ORIGINAL_MARKER = "## 原文"

// 原文区自其前的 `---` 分隔线起算，整体保留（data-model §6 正文结构）。
export function splitOriginal(body: string): { distilled: string; original: string | null } {
  const marker = body.indexOf(ORIGINAL_MARKER)
  if (marker < 0) return { distilled: body, original: null }
  const separator = body.lastIndexOf("\n---", marker)
  const cut = separator >= 0 ? separator + 1 : marker
  return { distilled: body.slice(0, cut), original: body.slice(cut) }
}

// 代理只改提炼区；原文区由系统保留，永不删除。
export function setDistilled(body: string, distilled: string): string {
  const original = splitOriginal(body).original
  const head = distilled.trimEnd()
  return original ? `${head}\n\n${original}` : `${head}\n`
}

function slugify(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
  return slug || "note"
}
