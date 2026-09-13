import type { Database } from "bun:sqlite"
import path from "node:path"
import { REVIEWER_AGENT } from "./agent"
import { parseNote } from "./frontmatter"
import { listJobs } from "./queue"
import { lastAssistantText, runHeadlessSession, type HeadlessClient } from "./session"
import { newNoteId, noteFileName, writeNote } from "./vault"
import type { VaultGit } from "./vault-git"

// 周复盘会话（票据 24，验收 E3）：每周日晚由代理扫描本周新增、产出周报、建议归档。
// 客观事实（新增清单/dead 任务/Gitee 推送时间）由系统侧采集后随任务注入，代理只做综合；
// 周报正文由系统落盘 _index/weekly/，代理本身只读不写。

export const DEFAULT_REVIEW_HOUR = 20

export type WeeklyDeps = {
  client: HeadlessClient
  db: Database
  vaultDir: string
  reindexNote: (relPath: string) => Promise<string>
  agent?: string
  hour?: number
  now?: () => Date
  git?: VaultGit
}

export type WeeklyFacts = {
  weekId: string
  since: string
  added: Array<{ title: string; path: string; folder: string; type: string }>
  dead: Array<{ note_id: string; title: string; error: string | null }>
  backup: string
}

export async function gatherFacts(
  db: Database,
  vaultDir: string,
  now: Date = new Date(),
  git?: VaultGit,
): Promise<WeeklyFacts> {
  const since = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
  const paths = (await Array.fromAsync(new Bun.Glob("**/*.md").scan({ cwd: vaultDir }))).sort()
  const added: WeeklyFacts["added"] = []
  for (const relPath of paths) {
    if (relPath.startsWith("_index/")) continue
    const { frontmatter } = parseNote(await Bun.file(path.join(vaultDir, relPath)).text())
    const created = frontmatter.created ? new Date(frontmatter.created) : undefined
    if (!created || Number.isNaN(created.getTime()) || created < since) continue
    added.push({
      title: frontmatter.title,
      path: relPath,
      folder: relPath.split("/")[0] ?? "",
      type: frontmatter.type,
    })
  }

  const dead = listJobs(db, "dead").map((job) => ({
    note_id: job.note_id,
    title: noteTitle(db, job.note_id),
    error: job.error,
  }))

  return {
    weekId: isoWeekId(now),
    since: since.toISOString(),
    added,
    dead,
    backup: await describePush(git),
  }
}

// 备份状态由 vault-git 统一提供（票据 25），周复盘只负责把它说成人话。
async function describePush(git: VaultGit | undefined): Promise<string> {
  if (!git) return "未启用备份（票据 25 未配置）"
  const status = await git.backupStatus()
  if (!status.remoteConfigured) return "未配置 Gitee 远程（票据 25 待完成）"
  if (!status.lastPush) return "已配置 Gitee 远程，但尚无推送记录"
  return `Gitee 远程最近提交时间 ${status.lastPush}`
}

function noteTitle(db: Database, noteId: string): string {
  try {
    const row = db.query("select title from notes where id = ?").get(noteId) as { title: string } | null
    return row?.title ?? noteId
  } catch {
    return noteId
  }
}

export function weeklyTask(facts: WeeklyFacts): string {
  const added =
    facts.added.length > 0
      ? facts.added.map((note) => `- [${note.folder}] ${note.title}（${note.type}，${note.path}）`).join("\n")
      : "（本周无新增笔记）"
  const dead =
    facts.dead.length > 0
      ? facts.dead.map((job) => `- ${job.title}（${job.note_id}）：${job.error ?? "未知错误"}`).join("\n")
      : "无"
  return [
    `这是 ${facts.weekId} 的周复盘，统计起点 ${facts.since}。客观事实如下，请按你的固定结构产出周报：`,
    "",
    "【本周新增笔记】",
    added,
    "",
    "【dead 提炼任务】",
    dead,
    "",
    "【备份】",
    facts.backup,
    "",
    "归档建议请用 get_note / search_knowledge 核实后再下结论。产出周报后结束。",
  ].join("\n")
}

export async function runWeeklyReview(
  deps: WeeklyDeps,
  now: Date = new Date(),
): Promise<{ sessionID: string; path: string }> {
  const facts = await gatherFacts(deps.db, deps.vaultDir, now, deps.git)
  const sessionID = await runHeadlessSession(deps.client, {
    title: `weekly:${facts.weekId}`,
    agent: deps.agent ?? REVIEWER_AGENT,
    text: weeklyTask(facts),
  })

  const report = await lastAssistantText(deps.client, sessionID)
  if (!report) throw new Error("周复盘会话没有产出文本")
  const relPath = await persistReport(deps, facts.weekId, report)
  await deps.reindexNote(relPath)
  // 会话保留：本人可在 Web 界面打开 weekly: 前缀的会话查看依据与追问。
  return { sessionID, path: relPath }
}

async function persistReport(deps: WeeklyDeps, weekId: string, report: string): Promise<string> {
  const id = newNoteId()
  const relPath = `_index/weekly/${noteFileName(id, `weekly ${weekId}`)}`
  await writeNote(deps.vaultDir, relPath, {
    frontmatter: {
      id,
      title: `周复盘 ${weekId}`,
      type: "note",
      source: "agent",
      created: new Date().toISOString(),
      status: "distilled",
      kind: "weekly-review",
    },
    body: report,
  })
  return relPath
}

// ISO 周编号（YYYY-Www），周一为一周起点。
export function isoWeekId(date: Date): string {
  const utc = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()))
  const dayNum = utc.getUTCDay() || 7
  utc.setUTCDate(utc.getUTCDate() + 4 - dayNum)
  const yearStart = new Date(Date.UTC(utc.getUTCFullYear(), 0, 1))
  const week = Math.ceil(((utc.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7)
  return `${utc.getUTCFullYear()}-W${String(week).padStart(2, "0")}`
}

// 下一个周日 hour 点（服务器本地时区）；当天已过点则排到下周日。
export function nextWeeklyRun(now: Date, hour: number): Date {
  const target = new Date(now)
  target.setHours(hour, 0, 0, 0)
  const daysUntilSunday = (7 - target.getDay()) % 7
  target.setDate(target.getDate() + daysUntilSunday)
  if (target.getTime() <= now.getTime()) target.setDate(target.getDate() + 7)
  return target
}

export function startWeeklyReview(deps: WeeklyDeps): { stop: () => void } {
  const hour = deps.hour ?? DEFAULT_REVIEW_HOUR
  let timer: ReturnType<typeof setTimeout>

  const schedule = () => {
    const delay = nextWeeklyRun(new Date(), hour).getTime() - Date.now()
    timer = setTimeout(run, delay)
  }

  const run = () => {
    void (async () => {
      try {
        const result = await runWeeklyReview(deps, deps.now ? deps.now() : new Date())
        console.log(`ybrain weekly review done: ${result.path}`)
      } catch (error) {
        console.error(`ybrain weekly review failed: ${error instanceof Error ? error.message : error}`)
      } finally {
        schedule()
      }
    })()
  }

  schedule()
  return {
    stop() {
      clearTimeout(timer)
    },
  }
}
