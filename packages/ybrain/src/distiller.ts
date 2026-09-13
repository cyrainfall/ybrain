import type { Database } from "bun:sqlite"
import path from "node:path"
import { DISTILLER_AGENT, distillTask } from "./agent"
import { parseNote, type NoteFrontmatter } from "./frontmatter"
import { RUN_TIMEOUT_MS, type JobRow } from "./queue"
import { abortSession, deleteSession, runHeadlessSession, type HeadlessClient } from "./session"
import { PARA_FOLDERS } from "./vault"

// 单次提炼执行（票据 24）：幂等检查 → 进程内隔离代理会话跑提炼流程 → 校验落盘结果。
// 队列状态翻转由调度器负责，本模块只返回成败；任何异常都由调度器按重试策略处理。
// 流程规范见 .scratch/exobrain/prototypes/distill-workflow.md §3。

export type DistillerDeps = {
  client: HeadlessClient
  db: Database
  vaultDir: string
  agent?: string
  timeoutMs?: number
}

export type DistillResult = {
  outcome: "done" | "skipped"
  notePath?: string
}

const PARA_DIRS = new Set<string>(PARA_FOLDERS)

export async function runDistillJob(deps: DistillerDeps, job: JobRow): Promise<DistillResult> {
  // 幂等关键：上次可能实际已提炼成功、只是 job 状态没翻转（崩溃/重启场景）。
  const before = await findNote(deps.db, deps.vaultDir, job.note_id)
  if (!before) throw new Error(`笔记文件不存在：${job.note_id}`)
  if (before.frontmatter.status === "distilled") return { outcome: "skipped", notePath: before.relPath }

  const sessionID = await runHeadlessSession(deps.client, {
    title: `distill:${job.note_id}`,
    agent: deps.agent ?? DISTILLER_AGENT,
    text: distillTask(job.note_id),
    timeoutMs: deps.timeoutMs ?? RUN_TIMEOUT_MS,
  })

  // 代理自称结束不算数：以笔记状态为准。失败会话保留（标题 distill: 前缀），dead 排障能看到完整记录。
  const check = verifyDistilled(await findNote(deps.db, deps.vaultDir, job.note_id))
  if (!check.ok) {
    await abortSession(deps.client, sessionID)
    throw new Error(check.reason)
  }

  await deleteSession(deps.client, sessionID)
  return { outcome: "done", notePath: check.path }
}

// 提炼完成的判定（验收 C2）：status 翻成 distilled，且已移出 0-Inbox 落到 PARA 目录。
// 只看 status 会漏掉代理忘记归类的情况——那种笔记会永远留在收件箱且被对账跳过。
function verifyDistilled(note: LocatedNote | undefined): { ok: true; path: string } | { ok: false; reason: string } {
  if (!note) return { ok: false, reason: "提炼后笔记文件找不到了" }
  if (note.frontmatter.status !== "distilled") {
    return { ok: false, reason: "提炼会话结束但笔记仍未标记 distilled（代理可能没调用 save_note）" }
  }
  if (!PARA_DIRS.has(note.relPath.split("/")[0] ?? "")) {
    return { ok: false, reason: `提炼后笔记仍在 ${note.relPath}，没有移入 PARA 目录` }
  }
  return { ok: true, path: note.relPath }
}

export type LocatedNote = { relPath: string; frontmatter: NoteFrontmatter }

// 笔记定位：先查索引（save_note 移动后会重索引），索引滞后或队列连接无 notes 表时
// 退化为全 vault 按 id 文件名前缀扫描（id 唯一，不会错配）。
export async function findNote(
  db: Database,
  vaultDir: string,
  noteId: string,
): Promise<LocatedNote | undefined> {
  const indexed = lookupIndexedPath(db, noteId)
  if (indexed) {
    const absPath = path.join(vaultDir, indexed)
    if (await Bun.file(absPath).exists()) return parse(absPath, indexed)
  }
  const match = (await Array.fromAsync(new Bun.Glob(`**/${noteId}-*.md`).scan({ cwd: vaultDir }))).sort()[0]
  if (!match) return undefined
  return parse(path.join(vaultDir, match), match)
}

function lookupIndexedPath(db: Database, noteId: string): string | undefined {
  try {
    const row = db.query("select path from notes where id = ?").get(noteId) as { path: string } | null
    return row?.path
  } catch {
    // 仅队列连接（无向量扩展的捕获降级模式）下没有 notes 表
    return undefined
  }
}

async function parse(absPath: string, relPath: string): Promise<LocatedNote> {
  return { relPath, frontmatter: parseNote(await Bun.file(absPath).text()).frontmatter }
}
