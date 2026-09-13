import type { Database } from "bun:sqlite"
import path from "node:path"
import { DISTILLER_AGENT, distillTask } from "./agent"
import { parseNote, type NoteFrontmatter } from "./frontmatter"
import { RUN_TIMEOUT_MS, type JobRow } from "./queue"
import { abortSession, deleteSession, runHeadlessSession, type HeadlessClient } from "./session"
import { PARA_FOLDERS } from "./vault"
import type { GitStatus, VaultGit } from "./vault-git"

// 单次提炼执行（票据 24）：幂等检查 → 进程内隔离代理会话跑提炼流程 → 校验落盘结果。
// 队列状态翻转由调度器负责，本模块只返回成败；任何异常都由调度器按重试策略处理。
// 票据 25 在此挂上 Git 备份：提炼前拉取 Mac 回流、成功后自动提交并推送（失败只告警）。
// 流程规范见 .scratch/exobrain/prototypes/distill-workflow.md §3。

export type DistillerDeps = {
  client: HeadlessClient
  db: Database
  vaultDir: string
  agent?: string
  timeoutMs?: number
  git?: VaultGit
}

export type DistillResult = {
  outcome: "done" | "skipped"
  notePath?: string
}

const PARA_DIRS = new Set<string>(PARA_FOLDERS)

export async function runDistillJob(deps: DistillerDeps, job: JobRow): Promise<DistillResult> {
  // 提炼前先拉取：Mac 端手写改动回流，避免后续推送分叉（票据 25 第 4 条）
  if (deps.git) await reportBackup("pull", await deps.git.pull())

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

  // 提炼闭环的备份（票据 25 / 验收 C3）：提交与推送都失败不阻塞——job 照样算成功，
  // 产物已在 vault，下一次闭环的 push 会把领先的提交一并补上。
  if (deps.git) {
    await reportBackup("commit", await deps.git.commitAll(`distill: ${check.note.frontmatter.title}`))
    await reportBackup("push", await deps.git.push())
  }

  return { outcome: "done", notePath: check.note.relPath }
}

function reportBackup(action: "pull" | "commit" | "push", status: GitStatus): void {
  if (status.ok) {
    console.log(`ybrain git ${action}: ${status.detail}`)
    return
  }
  console.warn(`ybrain git ${action} failed: ${status.reason}`)
}

// 提炼完成的判定（验收 C2）：status 翻成 distilled，且已移出 0-Inbox 落到 PARA 目录。
// 只看 status 会漏掉代理忘记归类的情况——那种笔记会永远留在收件箱且被对账跳过。
function verifyDistilled(
  note: LocatedNote | undefined,
): { ok: true; note: LocatedNote } | { ok: false; reason: string } {
  if (!note) return { ok: false, reason: "提炼后笔记文件找不到了" }
  if (note.frontmatter.status !== "distilled") {
    return { ok: false, reason: "提炼会话结束但笔记仍未标记 distilled（代理可能没调用 save_note）" }
  }
  if (!PARA_DIRS.has(note.relPath.split("/")[0] ?? "")) {
    return { ok: false, reason: `提炼后笔记仍在 ${note.relPath}，没有移入 PARA 目录` }
  }
  return { ok: true, note }
}

export type LocatedNote = { relPath: string; frontmatter: NoteFrontmatter }

// 笔记定位：先查索引（save_note 移动后会重索引），索引滞后或队列连接无 notes 表时
// 退化为全 vault 按 id 文件名前缀扫描（id 唯一，不会错配）。
export async function findNote(db: Database, vaultDir: string, noteId: string): Promise<LocatedNote | undefined> {
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
