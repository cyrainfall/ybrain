import type { Database } from "bun:sqlite"
import path from "node:path"
import { parseNote } from "./frontmatter"

// 提炼任务队列（票据 24）：状态机 queued → running → done / failed（退避重试）→ dead。
// 单进程单并发领取，绝不并行跑提炼（2 核约束）。
// 队列只记状态，笔记文件是真相源：jobs 表丢了可扫描 0-Inbox 重建（reconcileInbox）。
// 规范见 .scratch/exobrain/prototypes/distill-workflow.md §2。

export const JOB_TYPE_DISTILL = "distill"
export const MAX_RETRIES = 2
export const BACKOFF_MS = [60_000, 600_000] as const
export const RUN_TIMEOUT_MS = 10 * 60_000

export type JobStatus = "queued" | "running" | "done" | "failed" | "dead"

export type JobRow = {
  id: string
  note_id: string
  type: string
  status: JobStatus
  retries: number
  error: string | null
  created_at: string
  run_after: number
  started_at: number | null
}

export type EnqueueInput = {
  noteId: string
  type?: string
}

// 幂等入队：同一笔记同类任务只要已有记录（含 dead）就不重复插入。
// 返回是否真的插入——捕获补发、收件箱对账都靠它去重。
export function enqueue(db: Database, job: EnqueueInput, now: Date = new Date()): boolean {
  const result = db
    .prepare(
      `insert into jobs (id, note_id, type, status, retries, error, created_at, run_after, started_at)
       select ?, ?, ?, 'queued', 0, null, ?, 0, null
       where not exists (select 1 from jobs where note_id = ? and type = ?)`,
    )
    .run(crypto.randomUUID(), job.noteId, job.type ?? JOB_TYPE_DISTILL, now.toISOString(), job.noteId, job.type ?? JOB_TYPE_DISTILL)
  return result.changes > 0
}

// 进程启动恢复：上次没跑完的 running 一律回到 queued。
// 提炼侧靠"先查笔记 status 已 distilled 就直接收尾"保证这次重跑不会重复写。
export function recoverRunning(db: Database): number {
  return db
    .prepare(
      `update jobs set status = 'queued', started_at = null, run_after = 0
       where status = 'running'`,
    )
    .run().changes
}

function getJob(db: Database, id: string): JobRow | null {
  return (db.query("select * from jobs where id = ?").get(id) as JobRow | undefined) ?? null
}

// 一次失败：第 1/2 次失败进 failed 退避（1 分钟、10 分钟），第三次仍失败进 dead。
// dead 任务留在收件箱等本人处理（界面标红读 deadNoteIds，队列只负责状态）。
export function markFailed(
  db: Database,
  id: string,
  error: unknown,
  options: { now?: number; maxRetries?: number } = {},
): JobRow | null {
  const job = getJob(db, id)
  if (!job || job.status === "done" || job.status === "dead") return job
  const now = options.now ?? Date.now()
  const retries = job.retries + 1
  const message = String(error instanceof Error ? error.message : error).slice(0, 2000)

  if (retries > (options.maxRetries ?? MAX_RETRIES)) {
    db.prepare(
      `update jobs set status = 'dead', retries = ?, error = ?, run_after = 0, started_at = null where id = ?`,
    ).run(retries, message, id)
    return getJob(db, id)
  }

  db.prepare(
    `update jobs set status = 'failed', retries = ?, error = ?,
      run_after = ?, started_at = null where id = ?`,
  ).run(retries, message, now + BACKOFF_MS[retries - 1]!, id)
  return getJob(db, id)
}

export function markDone(db: Database, id: string): void {
  db.prepare(
    `update jobs set status = 'done', error = null, run_after = 0, started_at = null where id = ?`,
  ).run(id)
}

function expireTimeouts(db: Database, now: number, timeoutMs: number): void {
  const stale = db
    .query("select id from jobs where status = 'running' and started_at is not null and started_at < ?")
    .all(now - timeoutMs) as { id: string }[]
  stale.forEach((row) => markFailed(db, row.id, `提炼超时（超过 ${Math.round(timeoutMs / 1000)} 秒）`, { now }))
}

// 领取下一个可执行任务：先把超时的 running 按失败处理，再单条原子领取。
// queued 立即可取；failed 要等退避时刻 run_after 到达。
export function claimNext(
  db: Database,
  options: { now?: number; timeoutMs?: number } = {},
): JobRow | null {
  const now = options.now ?? Date.now()
  return db.transaction(() => {
    expireTimeouts(db, now, options.timeoutMs ?? RUN_TIMEOUT_MS)
    const due = db
      .query(
        `select id from jobs
         where status = 'queued' or (status = 'failed' and run_after <= ?)
         order by created_at asc, id asc limit 1`,
      )
      .get(now) as { id: string } | undefined
    if (!due) return null
    const claimed = db
      .prepare(
        `update jobs set status = 'running', started_at = ?, error = null
         where id = ? and status in ('queued', 'failed')`,
      )
      .run(now, due.id)
    return claimed.changes > 0 ? getJob(db, due.id) : null
  })()
}

export function listJobs(db: Database, status?: JobStatus): JobRow[] {
  const rows = status
    ? (db.query("select * from jobs where status = ? order by created_at asc").all(status) as JobRow[])
    : (db.query("select * from jobs order by created_at asc").all() as JobRow[])
  return rows
}

export function countJobs(db: Database, status: JobStatus): number {
  return (db.query("select count(*) as n from jobs where status = ?").get(status) as { n: number }).n
}

// dead 任务的笔记 id 集合：界面据此把收件箱里对应的笔记标红（验收 C5）。
export function deadNoteIds(db: Database): Set<string> {
  return new Set(
    (db.query("select note_id from jobs where status = 'dead'").all() as { note_id: string }[]).map(
      (row) => row.note_id,
    ),
  )
}

// 收件箱对账：任何还在 0-Inbox 的 inbox 笔记（feedback 除外）都该有个提炼任务，
// 没有就补排。jobs 表丢失、停服期间手工放进去的内容都靠它补处理且不重复。
export async function reconcileInbox(db: Database, vaultDir: string): Promise<string[]> {
  const paths = (await Array.fromAsync(new Bun.Glob("0-Inbox/**/*.md").scan({ cwd: vaultDir }))).sort()
  const enqueued: string[] = []
  for (const relPath of paths) {
    const { frontmatter } = parseNote(await Bun.file(path.join(vaultDir, relPath)).text())
    if (frontmatter.kind === "feedback") continue
    if (frontmatter.status && frontmatter.status !== "inbox") continue
    const noteId = frontmatter.id || path.basename(relPath, ".md")
    if (enqueue(db, { noteId, type: JOB_TYPE_DISTILL })) enqueued.push(noteId)
  }
  return enqueued
}
