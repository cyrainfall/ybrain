import { mkdir, rename } from "node:fs/promises"
import path from "node:path"
import { parseNote, serializeNote, type NoteFrontmatter } from "./frontmatter"

// vault 读写（票据 22）：笔记文件是真相源，SQLite 只是可重建的检索加速层。
// 目录与命名规则、正文结构见 .scratch/exobrain/prototypes/data-model.md。

// data-model §1：PARA 用文件夹表达「放哪」（标签管「关于什么」，两者正交）。
export const PARA_FOLDERS = ["1-Projects", "2-Areas", "3-Resources", "4-Archive"] as const

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

// 笔记 id = 时间戳前缀 + 4 位随机；文件名复用同一 id（data-model 命名与身份规则）。
// 客户端给了 created 时取其自述的墙上时间（离线补发仍记原始时刻），不跨时区换算。
export function newNoteId(created?: string): string {
  const wallClock = created?.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/)
  const now = new Date()
  const pad = (n: number) => String(n).padStart(2, "0")
  const stamp = wallClock
    ? wallClock.slice(1).join("")
    : `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}${pad(now.getHours())}${pad(now.getMinutes())}`

  const chars = "abcdefghijklmnopqrstuvwxyz0123456789"
  const suffix = Array.from({ length: 4 }, () => chars.charAt(Math.floor(Math.random() * chars.length))).join("")
  return `${stamp}-${suffix}`
}

// 标题缺省规则（data-model 字段表）：取正文首个非空行。
export function deriveTitle(body: string | undefined): string | undefined {
  return body
    ?.split("\n")
    .map((line) => line.trim())
    .find((line) => line.length > 0)
}

const ORIGINAL_MARKER = "## 原文"
const ORIGINAL_SEPARATOR = "---"

// 原文区自其前的 `---` 分隔线起算，整体保留（data-model §6 正文结构）。
// 分隔线可能还没有（票据 28 入队时只有原文、还没提炼区），此时原文区就是 marker 起的整段。
export function splitOriginal(body: string): { distilled: string; original: string | null } {
  const marker = body.indexOf(ORIGINAL_MARKER)
  if (marker < 0) return { distilled: body, original: null }
  const separator = body.lastIndexOf(`\n${ORIGINAL_SEPARATOR}`, marker)
  const cut = separator >= 0 ? separator + 1 : marker
  return { distilled: body.slice(0, cut), original: body.slice(cut) }
}

// 入队正文固化（票据 28）：抓取落盘与手工放进收件箱的笔记都没有原文区标记，
// 而 save_note 只写提炼区，没有标记的正文会被整体覆盖——提炼前先整段收进原文区。已带则原样返回。
// 不写 `---` 分隔线：分隔线由 setDistilled 在拼接提炼区时补，body 以 `---` 开头会让 frontmatter 解析错乱。
export function ensureOriginalSection(body: string): string {
  if (splitOriginal(body).original) return body
  return `${ORIGINAL_MARKER}\n\n${body.trim()}\n`
}

// 代理只改提炼区；原文区由系统保留，永不删除。
export function setDistilled(body: string, distilled: string): string {
  const original = splitOriginal(body).original
  const head = distilled.trimEnd()
  if (!original) return `${head}\n`
  const section = original.replace(/^-{3,}[ \t]*\n+/, "").trimEnd()
  return `${head}\n\n${ORIGINAL_SEPARATOR}\n\n${section}\n`
}

function slugify(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
  return slug || "note"
}
