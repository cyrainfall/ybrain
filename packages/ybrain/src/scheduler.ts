import type { Database } from "bun:sqlite"
import { claimNext, markDone, markFailed, reconcileInbox, recoverRunning, type JobRow } from "./queue"

// 提炼调度器（票据 24）：轮询 jobs 队列，单并发串行领取执行。
// 随到随做——捕获入队后最迟一个轮询间隔（默认 5 秒）开始提炼；
// 退避中的 failed 任务到 run_after 才会再被领取；dead 不再打扰，只在日志/周复盘出现。
// 启动时先把残留 running 重置为 queued；空闲时定期对账收件箱（笔记是真相源），
// 覆盖停服期间手工放入或入队失败的笔记，且靠幂等入队保证不重复。

export type SchedulerDeps = {
  db: Database
  vaultDir: string
  run: (job: JobRow) => Promise<void>
  intervalMs?: number
  reconcileMs?: number
}

export function startScheduler(deps: SchedulerDeps): { stop: () => Promise<void> } {
  const intervalMs = deps.intervalMs ?? 5_000
  const reconcileMs = deps.reconcileMs ?? 60_000
  let timer: ReturnType<typeof setTimeout> | undefined
  let stopped = false
  let inflight: Promise<void> | undefined
  let lastReconcile = 0

  async function runOne(job: JobRow): Promise<void> {
    try {
      await deps.run(job)
      markDone(deps.db, job.id)
      console.log(`ybrain distill done: ${job.note_id}`)
    } catch (error) {
      const row = markFailed(deps.db, job.id, error)
      const message = error instanceof Error ? error.message : String(error)
      if (row?.status === "dead") {
        console.error(`ybrain distill dead after ${row.retries} attempts: ${job.note_id}: ${message}`)
        return
      }
      console.warn(`ybrain distill failed (attempt ${row?.retries}): ${job.note_id}: ${message}`)
    }
  }

  async function tick(): Promise<void> {
    if (stopped) return
    const job = claimNext(deps.db)
    if (job) {
      inflight = runOne(job).finally(() => {
        inflight = undefined
      })
      await inflight
      // 队列里可能还有积压，立刻再领，不等轮询间隔
      schedule(0)
      return
    }

    // 空闲才做对账：扫描收件箱把漏排的笔记补进队列（幂等，不覆盖运行中的任务）
    if (Date.now() - lastReconcile >= reconcileMs) {
      lastReconcile = Date.now()
      const enqueued = await reconcileInbox(deps.db, deps.vaultDir)
      if (enqueued.length > 0) {
        console.log(`ybrain scheduler: 收件箱补排 ${enqueued.length} 篇：${enqueued.join(", ")}`)
        schedule(0)
        return
      }
    }
    schedule(intervalMs)
  }

  function schedule(delay: number): void {
    if (!stopped) timer = setTimeout(() => void tick().catch(console.error), delay)
  }

  const recovered = recoverRunning(deps.db)
  if (recovered > 0) console.log(`ybrain scheduler: ${recovered} 个未完成任务已重新排队`)
  schedule(0)

  return {
    async stop() {
      stopped = true
      clearTimeout(timer)
      if (inflight) await inflight.catch(() => {})
    },
  }
}
