import { afterEach, describe, expect, it } from "bun:test"
import type { Database } from "bun:sqlite"
import { mkdtemp, mkdir, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { openQueue } from "../src/db"
import { serializeNote, type NoteFrontmatter } from "../src/frontmatter"
import {
  BACKOFF_MS,
  claimNext,
  countJobs,
  enqueue,
  listJobs,
  markDone,
  markFailed,
  MAX_RETRIES,
  reconcileInbox,
  recoverRunning,
} from "../src/queue"

// 任务队列状态机（票据 24）：真 SQLite + 真文件系统，不 mock。
// 规范见 .scratch/exobrain/prototypes/distill-workflow.md §2。

const dirs: string[] = []
const opened: Database[] = []
afterEach(async () => {
  for (const db of opened) db.close()
  opened.length = 0
  await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })))
  dirs.length = 0
})

async function setup(): Promise<{ db: Database; vaultDir: string }> {
  const dataDir = await mkdtemp(path.join(tmpdir(), "ybrain-queue-data-"))
  const vaultDir = await mkdtemp(path.join(tmpdir(), "ybrain-queue-vault-"))
  dirs.push(dataDir, vaultDir)
  const db = openQueue(path.join(dataDir, "index.db"))
  opened.push(db)
  return { db, vaultDir }
}

const T0 = Date.parse("2026-09-13T12:00:00.000Z")

describe("jobs queue (ticket 24)", () => {
  it("enqueues and claims one job at a time, first in first out", () => {
    const { db } = setupSync()
    expect(enqueue(db, { noteId: "note-a" }, new Date(T0))).toBe(true)
    expect(enqueue(db, { noteId: "note-b" }, new Date(T0 + 1))).toBe(true)

    const first = claimNext(db, { now: T0 })
    expect(first?.note_id).toBe("note-a")
    expect(first?.status).toBe("running")
    expect(first?.started_at).toBe(T0)
    // 单并发：已有 running 在手时仍可领取下一个由调度器纪律保证；
    // 队列层只保证按序给出——第二个仍是最早的待办
    expect(claimNext(db, { now: T0 })?.note_id).toBe("note-b")
  })

  it("is idempotent per note_id + type across every status", () => {
    const { db } = setupSync()
    expect(enqueue(db, { noteId: "note-a" })).toBe(true)
    expect(enqueue(db, { noteId: "note-a" })).toBe(false)

    const job = claimNext(db)!
    markDone(db, job.id)
    expect(enqueue(db, { noteId: "note-a" })).toBe(false)

    expect(enqueue(db, { noteId: "note-a", type: "sync" })).toBe(true)
  })

  it("backs off failed jobs 1 minute then 10 minutes and goes dead after the third failure", () => {
    const { db } = setupSync()
    enqueue(db, { noteId: "note-a" })
    const job = claimNext(db, { now: T0 })!

    const firstFailure = markFailed(db, job.id, "boom", { now: T0 })!
    expect(firstFailure.status).toBe("failed")
    expect(firstFailure.retries).toBe(1)
    expect(firstFailure.run_after).toBe(T0 + BACKOFF_MS[0])
    expect(firstFailure.started_at).toBeNull()
    // 退避未到不领取
    expect(claimNext(db, { now: T0 + BACKOFF_MS[0] - 1 })).toBeNull()

    const retry1 = claimNext(db, { now: T0 + BACKOFF_MS[0] })!
    expect(retry1.id).toBe(job.id)
    const secondFailure = markFailed(db, retry1.id, "boom", { now: T0 + BACKOFF_MS[0] })!
    expect(secondFailure.retries).toBe(2)
    expect(secondFailure.status).toBe("failed")
    expect(secondFailure.run_after).toBe(T0 + BACKOFF_MS[0] + BACKOFF_MS[1])

    const retry2 = claimNext(db, { now: T0 + BACKOFF_MS[0] + BACKOFF_MS[1] })!
    const dead = markFailed(db, retry2.id, "boom", { now: T0 + BACKOFF_MS[0] + BACKOFF_MS[1] })!
    expect(dead.status).toBe("dead")
    expect(dead.retries).toBe(MAX_RETRIES + 1)
    // dead 永不再被领取
    expect(
      claimNext(db, { now: T0 + BACKOFF_MS[0] + BACKOFF_MS[1] + 100_000_000 }),
    ).toBeNull()
    expect(countJobs(db, "dead")).toBe(1)
  })

  it("records the error message on failure", () => {
    const { db } = setupSync()
    enqueue(db, { noteId: "note-a" })
    const job = claimNext(db)!
    const failed = markFailed(db, job.id, new Error("model unavailable"))!
    expect(failed.error).toBe("model unavailable")
  })

  it("resets running jobs back to queued on process restart", () => {
    const { db } = setupSync()
    enqueue(db, { noteId: "note-a" })
    claimNext(db, { now: T0 })
    expect(listJobs(db, "running")).toHaveLength(1)

    expect(recoverRunning(db)).toBe(1)
    const retried = claimNext(db, { now: T0 + 1000 })!
    expect(retried.note_id).toBe("note-a")
    expect(retried.retries).toBe(0)
    expect(retried.started_at).toBe(T0 + 1000)
  })

  it("treats a running job past the 10-minute timeout as a failed attempt", () => {
    const { db } = setupSync()
    enqueue(db, { noteId: "note-a" })
    claimNext(db, { now: T0 })

    // 10 分钟不到：仍 running，不被超时处理
    expect(claimNext(db, { now: T0 + 10 * 60_000 - 1 })).toBeNull()
    // 恰好超过：超时计一次失败，进入退避
    const afterTimeout = claimNext(db, { now: T0 + 10 * 60_000 + 1 })
    expect(afterTimeout).toBeNull()
    const job = listJobs(db, "failed")[0]!
    expect(job.retries).toBe(1)
    expect(job.error).toContain("超时")
  })

  it("reconciles the inbox: enqueues missing inbox notes but skips feedback and distilled notes", async () => {
    const { db, vaultDir } = await setup()
    await writeInboxNote(vaultDir, "202609130900-aaaa", "待提炼", { status: "inbox" })
    await writeInboxNote(vaultDir, "202609130901-bbbb", "反馈", {
      status: "inbox",
      kind: "feedback",
      subdir: "feedback",
    })
    await writeInboxNote(vaultDir, "202609130902-cccc", "已提炼但还在收件箱", { status: "distilled" })

    const enqueued = await reconcileInbox(db, vaultDir)
    expect(enqueued).toEqual(["202609130900-aaaa"])

    // 再跑一次幂等，不重复入队
    expect(await reconcileInbox(db, vaultDir)).toEqual([])

    // 已有 dead 记录的笔记不补排（留给本人处理）
    const job = claimNext(db)!
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) markFailed(db, job.id, "x")
    expect(await reconcileInbox(db, vaultDir)).toEqual([])
  })
})

function setupSync(): { db: Database } {
  const dataDir = mkdirSync()
  const db = openQueue(path.join(dataDir, "index.db"))
  opened.push(db)
  return { db }
}

function mkdirSync(): string {
  const dir = path.join(tmpdir(), `ybrain-queue-${crypto.randomUUID()}`)
  mkdir(dir, { recursive: true })
  dirs.push(dir)
  return dir
}

async function writeInboxNote(
  vaultDir: string,
  id: string,
  title: string,
  options: { status: string; kind?: string; subdir?: string },
): Promise<void> {
  const dir = path.join(vaultDir, "0-Inbox", options.subdir ?? "")
  await mkdir(dir, { recursive: true })
  const frontmatter: NoteFrontmatter = {
    id,
    title,
    type: "note",
    source: "web",
    created: "2026-09-13T09:00:00.000Z",
    status: options.status,
    ...(options.kind ? { kind: options.kind } : {}),
  }
  await Bun.write(path.join(dir, `${id}-slug.md`), serializeNote(frontmatter, "正文"))
}
