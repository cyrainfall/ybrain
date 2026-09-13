import { afterEach, describe, expect, it } from "bun:test"
import type { Database } from "bun:sqlite"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { runDistillJob } from "../src/distiller"
import { openQueue } from "../src/db"
import { enqueue, claimNext, type JobRow } from "../src/queue"
import type { HeadlessClient } from "../src/session"
import { parseNote, type NoteFrontmatter } from "../src/frontmatter"
import { moveNote, readNote, writeNote } from "../src/vault"
import { createVaultGit } from "../src/vault-git"
import { describeGit, runGit } from "./lib/git"

// distiller 执行（票据 24）：真文件系统 + 真队列；进程内会话边界用假 client 代替，
// 假 client 在 prompt 调用里模拟代理对 vault 的读写（等价于 save_note 落盘）。
// 票据 25 的 Git 备份在同一批用例里用真 git + 本地裸仓库验证。

const dirs: string[] = []
const opened: Database[] = []
afterEach(async () => {
  for (const db of opened) db.close()
  opened.length = 0
  await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })))
  dirs.length = 0
})

async function setup() {
  const dataDir = await mkdtemp(path.join(tmpdir(), "ybrain-distill-data-"))
  const vaultDir = await mkdtemp(path.join(tmpdir(), "ybrain-distill-vault-"))
  dirs.push(dataDir, vaultDir)
  const db = openQueue(path.join(dataDir, "index.db"))
  opened.push(db)
  return { db, vaultDir }
}

function inboxNote(id: string, title: string): NoteFrontmatter {
  return {
    id,
    title,
    type: "note",
    source: "web",
    created: "2026-09-13T09:00:00.000Z",
    status: "inbox",
  }
}

async function seedInbox(vaultDir: string, frontmatter: NoteFrontmatter, body: string): Promise<string> {
  const relPath = `0-Inbox/${frontmatter.id}-slug.md`
  await writeNote(vaultDir, relPath, { frontmatter, body })
  return relPath
}

// 模拟提炼代理的 save_note：移动到 3-Resources 并翻 status=distilled。
async function simulateDistillation(vaultDir: string, relPath: string): Promise<void> {
  const note = await readNote(vaultDir, relPath)
  const target = await moveNote(vaultDir, relPath, "3-Resources")
  await writeNote(vaultDir, target, {
    frontmatter: {
      ...note.frontmatter,
      status: "distilled",
      summary: "一句话摘要",
      tags: ["外脑"],
    },
    body: "要点卡片\n",
  })
}

type PromptHandler = (options: {
  path: { id: string }
  body: { agent: string; parts: Array<{ type: string; text: string }> }
  signal?: AbortSignal
}) => Promise<unknown>

function fakeClient(handlers: { prompt: PromptHandler; createTitle?: string }): {
  client: HeadlessClient
  calls: { created: string[]; aborted: string[]; deleted: string[]; prompts: number }
} {
  const calls = {
    created: [] as string[],
    aborted: [] as string[],
    deleted: [] as string[],
    prompts: 0,
  }
  const client = {
    session: {
      create: async (options: { body: { title?: string } }) => {
        calls.created.push(options.body.title ?? "")
        return { data: { id: `s-${calls.created.length}` }, error: undefined }
      },
      prompt: async (options: Parameters<PromptHandler>[0]) => {
        calls.prompts++
        await handlers.prompt(options)
        return { data: { info: { role: "assistant" } }, error: undefined }
      },
      abort: async (options: { path: { id: string } }) => {
        calls.aborted.push(options.path.id)
        return { data: true, error: undefined }
      },
      delete: async (options: { path: { id: string } }) => {
        calls.deleted.push(options.path.id)
        return { data: true, error: undefined }
      },
      messages: async () => ({ data: [], error: undefined }),
    },
  } as unknown as HeadlessClient
  return { client, calls }
}

async function claimedJob(db: Database, noteId: string): Promise<JobRow> {
  enqueue(db, { noteId })
  return claimNext(db)!
}

describe("runDistillJob (ticket 24)", () => {
  it("runs the distiller session and verifies the note is distilled", async () => {
    const { db, vaultDir } = await setup()
    const id = "202609130900-aaaa"
    const relPath = await seedInbox(vaultDir, inboxNote(id, "外脑构想"), "原文")
    const fake = fakeClient({
      prompt: async () => {
        await simulateDistillation(vaultDir, relPath)
      },
    })

    const result = await runDistillJob(
      { client: fake.client, db, vaultDir, timeoutMs: 5_000 },
      await claimedJob(db, id),
    )

    expect(result.outcome).toBe("done")
    expect(result.notePath).toBe(`3-Resources/${id}-slug.md`)
    expect(fake.calls.created[0]).toBe(`distill:${id}`)
    expect(fake.calls.prompts).toBe(1)
    expect(fake.calls.aborted).toEqual([])
    expect(fake.calls.deleted).toEqual(["s-1"])
    expect(await Bun.file(path.join(vaultDir, relPath)).exists()).toBe(false)
    const written = parseNote(await Bun.file(path.join(vaultDir, result.notePath!)).text())
    expect(written.frontmatter.status).toBe("distilled")
  })

  it("skips creating a session when the note is already distilled (idempotent retry)", async () => {
    const { db, vaultDir } = await setup()
    const id = "202609130900-bbbb"
    const frontmatter = { ...inboxNote(id, "已提炼"), status: "distilled" as const }
    await writeNote(vaultDir, `3-Resources/${id}-slug.md`, { frontmatter, body: "要点" })
    const fake = fakeClient({ prompt: async () => {} })

    const result = await runDistillJob({ client: fake.client, db, vaultDir }, await claimedJob(db, id))

    expect(result.outcome).toBe("skipped")
    expect(fake.calls.created).toEqual([])
    expect(fake.calls.prompts).toBe(0)
  })

  it("fails when the note file is missing so the job can retry", async () => {
    const { db, vaultDir } = await setup()
    const fake = fakeClient({ prompt: async () => {} })

    await expect(
      runDistillJob({ client: fake.client, db, vaultDir }, await claimedJob(db, "202609130900-cccc")),
    ).rejects.toThrow("不存在")
    expect(fake.calls.created).toEqual([])
  })

  it("aborts and keeps the session when the agent run throws", async () => {
    const { db, vaultDir } = await setup()
    const id = "202609130900-dddd"
    await seedInbox(vaultDir, inboxNote(id, "失败案例"), "原文")
    const fake = fakeClient({
      prompt: async () => {
        throw new Error("模型 500")
      },
    })

    await expect(runDistillJob({ client: fake.client, db, vaultDir }, await claimedJob(db, id))).rejects.toThrow(
      "模型 500",
    )
    expect(fake.calls.aborted).toEqual(["s-1"])
    expect(fake.calls.deleted).toEqual([])
  })

  it("fails when the agent finishes without marking the note distilled", async () => {
    const { db, vaultDir } = await setup()
    const id = "202609130900-eeee"
    await seedInbox(vaultDir, inboxNote(id, "半途而废"), "原文")
    const fake = fakeClient({ prompt: async () => {} })

    await expect(runDistillJob({ client: fake.client, db, vaultDir }, await claimedJob(db, id))).rejects.toThrow(
      "distilled",
    )
    expect(fake.calls.aborted).toEqual(["s-1"])
    expect(fake.calls.deleted).toEqual([])
  })

  it("fails when the agent marks distilled but never moves the note out of the inbox (C2)", async () => {
    const { db, vaultDir } = await setup()
    const id = "202609130900-gggg"
    const relPath = await seedInbox(vaultDir, inboxNote(id, "忘记归类"), "原文")
    const fake = fakeClient({
      prompt: async () => {
        // 只翻状态、不移动：笔记仍在 0-Inbox，对账也会因 status≠inbox 而跳过它
        const note = await readNote(vaultDir, relPath)
        await writeNote(vaultDir, relPath, {
          frontmatter: { ...note.frontmatter, status: "distilled" },
          body: "要点\n",
        })
      },
    })

    await expect(runDistillJob({ client: fake.client, db, vaultDir }, await claimedJob(db, id))).rejects.toThrow("PARA")
    expect(fake.calls.aborted).toEqual(["s-1"])
    expect(fake.calls.deleted).toEqual([])
  })

  it("stops waiting and aborts when the run exceeds the timeout", async () => {
    const { db, vaultDir } = await setup()
    const id = "202609130900-ffff"
    await seedInbox(vaultDir, inboxNote(id, "超时案例"), "原文")
    const fake = fakeClient({
      prompt: async (options) =>
        new Promise((_resolve, reject) => {
          const signal = options.signal ?? new AbortController().signal
          if (signal.aborted) reject(signal.reason)
          signal.addEventListener("abort", () => reject(signal.reason))
        }),
    })

    await expect(
      runDistillJob({ client: fake.client, db, vaultDir, timeoutMs: 30 }, await claimedJob(db, id)),
    ).rejects.toThrow()
    expect(fake.calls.aborted).toEqual(["s-1"])
  })
})

describeGit("distill git backup (ticket 25)", () => {
  it("commits and pushes the distillation when a vault git is wired in (C3)", async () => {
    const { db, vaultDir } = await setup()
    const remote = await mkdtemp(path.join(tmpdir(), "ybrain-remote-"))
    dirs.push(remote)
    runGit(remote, ["init", "--bare", "-q"])

    const git = createVaultGit({ vaultDir, remote })
    await git.ensureRepo()

    const id = "202609130900-hhhh"
    const relPath = await seedInbox(vaultDir, inboxNote(id, "外链备份"), "原文")
    const fake = fakeClient({
      prompt: async () => {
        await simulateDistillation(vaultDir, relPath)
      },
    })

    const result = await runDistillJob({ client: fake.client, db, vaultDir, git }, await claimedJob(db, id))

    expect(result.outcome).toBe("done")
    // 提炼闭环提交并推送，message 为 distill: <标题>
    expect(runGit(vaultDir, ["log", "-1", "--format=%s"]).out).toBe("distill: 外链备份")
    expect(runGit(remote, ["log", "-1", "--format=%s", "main"]).out).toBe("distill: 外链备份")
    expect(runGit(vaultDir, ["status", "--porcelain"]).out).toBe("")
  })
})
