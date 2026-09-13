import { afterEach, describe, expect, it } from "bun:test"
import type { Database } from "bun:sqlite"
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { openQueue } from "../src/db"
import { serializeNote, type NoteFrontmatter } from "../src/frontmatter"
import { countJobs, enqueue, listJobs } from "../src/queue"
import { startScheduler } from "../src/scheduler"
import type { JobRow } from "../src/queue"

// 调度器（票据 24）：真 SQLite + 真定时循环；模型执行由注入的 run 函数代替，
// 断言调度纪律本身（串行、状态翻转、失败不阻塞、启动恢复/对账）。

const dirs: string[] = []
const opened: Database[] = []
const schedulers: Array<{ stop: () => Promise<void> }> = []
afterEach(async () => {
  await Promise.all(schedulers.map((s) => s.stop()))
  schedulers.length = 0
  for (const db of opened) db.close()
  opened.length = 0
  await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })))
  dirs.length = 0
})

async function setup() {
  const dataDir = await mkdtemp(path.join(tmpdir(), "ybrain-sched-data-"))
  const vaultDir = await mkdtemp(path.join(tmpdir(), "ybrain-sched-vault-"))
  dirs.push(dataDir, vaultDir)
  const db = openQueue(path.join(dataDir, "index.db"))
  opened.push(db)
  return { db, vaultDir }
}

async function waitFor(db: Database, predicate: () => boolean, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  throw new Error("condition not met before timeout")
}

describe("distill scheduler (ticket 24)", () => {
  it("drains the queue serially and flips every job to done", async () => {
    const { db } = await setup()
    enqueue(db, { noteId: "note-a" }, new Date(1_000))
    enqueue(db, { noteId: "note-b" }, new Date(2_000))
    enqueue(db, { noteId: "note-c" }, new Date(3_000))

    let active = 0
    let maxActive = 0
    const processed: string[] = []
    const scheduler = startScheduler({
      db,
      vaultDir: tmpdir(),
      intervalMs: 2,
      run: async (job) => {
        active++
        maxActive = Math.max(maxActive, active)
        await new Promise((resolve) => setTimeout(resolve, 5))
        processed.push(job.note_id)
        active--
      },
    })
    schedulers.push(scheduler)

    await waitFor(db, () => countJobs(db, "done") === 3)
    expect(processed).toEqual(["note-a", "note-b", "note-c"])
    expect(maxActive).toBe(1)
  })

  it("marks a failing job failed with the error but keeps processing later jobs", async () => {
    const { db } = await setup()
    enqueue(db, { noteId: "bad" }, new Date(1_000))
    enqueue(db, { noteId: "good" }, new Date(2_000))

    const scheduler = startScheduler({
      db,
      vaultDir: tmpdir(),
      intervalMs: 2,
      run: async (job: JobRow) => {
        if (job.note_id === "bad") throw new Error("model said no")
      },
    })
    schedulers.push(scheduler)

    await waitFor(db, () => countJobs(db, "done") === 1 && countJobs(db, "failed") === 1)
    const bad = listJobs(db).find((job) => job.note_id === "bad")!
    expect(bad.status).toBe("failed")
    expect(bad.retries).toBe(1)
    expect(bad.error).toBe("model said no")
  })

  it("recovers a stale running job on startup", async () => {
    const { db, vaultDir } = await setup()
    db.prepare(
      `insert into jobs (id, note_id, type, status, retries, error, created_at, run_after, started_at)
       values ('job-stuck', 'note-stuck', 'distill', 'running', 0, null, '2026-09-13T00:00:00.000Z', 0, 123)`,
    ).run()
    enqueue(db, { noteId: "note-new" }, new Date(2_000))

    const ran: string[] = []
    const scheduler = startScheduler({
      db,
      vaultDir,
      intervalMs: 2,
      run: async (job) => {
        ran.push(job.note_id)
      },
    })
    schedulers.push(scheduler)

    await waitFor(db, () => countJobs(db, "done") === 2)
    expect(ran).toContain("note-stuck")
    expect(ran).toContain("note-new")
  })

  it("reconciles the inbox on startup: a note without a job gets distilled once", async () => {
    const { db, vaultDir } = await setup()
    const frontmatter: NoteFrontmatter = {
      id: "202609130900-aaaa",
      title: "停服期间手工放入的笔记",
      type: "note",
      source: "manual",
      created: "2026-09-13T09:00:00.000Z",
      status: "inbox",
    }
    await mkdir(path.join(vaultDir, "0-Inbox"), { recursive: true })
    await writeFile(path.join(vaultDir, "0-Inbox", `${frontmatter.id}-slug.md`), serializeNote(frontmatter, "正文"))

    const runs: string[] = []
    const scheduler = startScheduler({
      db,
      vaultDir,
      intervalMs: 2,
      run: async (job) => {
        runs.push(job.note_id)
      },
    })
    schedulers.push(scheduler)

    await waitFor(db, () => countJobs(db, "done") === 1)
    expect(runs).toEqual(["202609130900-aaaa"])
    // 多等几个循环确认没有重复处理
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(runs).toEqual(["202609130900-aaaa"])
  })
})
