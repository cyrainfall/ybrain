import { afterEach, describe, expect, it } from "bun:test"
import type { Database } from "bun:sqlite"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { openQueue } from "../src/db"
import { parseNote, type NoteFrontmatter } from "../src/frontmatter"
import { claimNext, enqueue, markFailed } from "../src/queue"
import type { HeadlessClient } from "../src/session"
import { gatherFacts, isoWeekId, nextWeeklyRun, runWeeklyReview } from "../src/weekly"
import { writeNote } from "../src/vault"

// 周复盘（票据 24，验收 E3）：事实采集走真文件系统/真队列，
// 会话边界用假 client；周报落盘由系统侧完成。

const dirs: string[] = []
const opened: Database[] = []
afterEach(async () => {
  for (const db of opened) db.close()
  opened.length = 0
  await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })))
  dirs.length = 0
})

async function setup() {
  const dataDir = await mkdtemp(path.join(tmpdir(), "ybrain-weekly-data-"))
  const vaultDir = await mkdtemp(path.join(tmpdir(), "ybrain-weekly-vault-"))
  dirs.push(dataDir, vaultDir)
  const db = openQueue(path.join(dataDir, "index.db"))
  opened.push(db)
  return { db, vaultDir }
}

async function seedNote(
  vaultDir: string,
  relPath: string,
  frontmatter: Partial<NoteFrontmatter> & Pick<NoteFrontmatter, "id" | "title" | "created">,
  body = "正文",
): Promise<void> {
  await writeNote(vaultDir, relPath, {
    frontmatter: {
      type: "note",
      source: "web",
      status: "distilled",
      ...frontmatter,
    },
    body,
  })
}

describe("weekly review facts (ticket 24 / E3)", () => {
  it("collects this week's notes, dead jobs and reports Gitee as unconfigured before ticket 25", async () => {
    const now = new Date("2026-09-13T12:00:00.000Z")
    const { db, vaultDir } = await setup()
    await seedNote(vaultDir, "3-Resources/202609101000-aaaa-new.md", {
      id: "202609101000-aaaa",
      title: "本周新笔记",
      created: "2026-09-10T10:00:00.000Z",
    })
    await seedNote(vaultDir, "4-Archive/202608011000-bbbb-old.md", {
      id: "202608011000-bbbb",
      title: "上周以前",
      created: "2026-08-01T10:00:00.000Z",
    })
    await seedNote(vaultDir, "_index/weekly/202609131200-cccc-report.md", {
      id: "202609131200-cccc",
      title: "旧周报",
      created: "2026-09-13T12:00:00.000Z",
      kind: "weekly-review",
    })

    enqueue(db, { noteId: "202609101000-dead" }, new Date("2026-09-10T00:00:00.000Z"))
    // 三次尝试的时刻依次越过 1 分钟、10 分钟退避点，最后一次进 dead
    const attempts = [
      Date.parse("2026-09-10T01:00:00.000Z"),
      Date.parse("2026-09-10T01:02:00.000Z"),
      Date.parse("2026-09-10T01:13:00.000Z"),
    ]
    for (const now of attempts) {
      const job = claimNext(db, { now })
      if (job) markFailed(db, job.id, "模型 500", { now })
    }

    const facts = await gatherFacts(db, vaultDir, now)

    expect(facts.weekId).toBe("2026-W37")
    expect(facts.added.map((note) => note.title)).toEqual(["本周新笔记"])
    expect(facts.added[0]?.folder).toBe("3-Resources")
    expect(facts.dead).toHaveLength(1)
    expect(facts.dead[0]?.note_id).toBe("202609101000-dead")
    expect(facts.dead[0]?.error).toBe("模型 500")
    // 未注入 vault-git 时备份状态降级为「未启用」，不编造推送时间
    expect(facts.backup).toContain("未启用备份")
  })
})

describe("weekly scheduling helpers", () => {
  it("computes ISO week ids", () => {
    expect(isoWeekId(new Date("2024-01-01T00:00:00"))).toBe("2024-W01")
    expect(isoWeekId(new Date("2023-01-01T00:00:00"))).toBe("2022-W52")
    expect(isoWeekId(new Date("2026-09-13T12:00:00"))).toBe("2026-W37")
  })

  it("targets Sunday evening and wraps to the next week after the hour passes", () => {
    // 周三 12:00 → 当周日 20:00
    const wednesday = nextWeeklyRun(new Date("2026-09-09T12:00:00"), 20)
    expect(wednesday.getDay()).toBe(0)
    expect(wednesday.getHours()).toBe(20)
    expect(wednesday.getTime()).toBe(new Date("2026-09-13T20:00:00").getTime())

    // 周日 21:00 已过点 → 下周日
    const sundayLate = nextWeeklyRun(new Date("2026-09-13T21:00:00"), 20)
    expect(sundayLate.getTime()).toBe(new Date("2026-09-20T20:00:00").getTime())

    // 周日 19:00 未到点 → 当天
    const sundayEarly = nextWeeklyRun(new Date("2026-09-13T19:00:00"), 20)
    expect(sundayEarly.getTime()).toBe(new Date("2026-09-13T20:00:00").getTime())
  })
})

describe("runWeeklyReview", () => {
  it("persists the assistant report under _index/weekly and keeps the session", async () => {
    const now = new Date("2026-09-13T12:00:00.000Z")
    const { db, vaultDir } = await setup()
    const reindexed: string[] = []
    let created = ""
    let deleted = false
    const client = {
      session: {
        create: async (options: { body: { title?: string } }) => {
          created = options.body.title ?? ""
          return { data: { id: "s-weekly" }, error: undefined }
        },
        prompt: async () => ({ data: { info: { role: "assistant" } }, error: undefined }),
        messages: async () => ({
          data: [
            {
              info: { role: "user" },
              parts: [{ type: "text", text: "task" }],
            },
            {
              info: { role: "assistant" },
              parts: [{ type: "text", text: "# 周复盘 2026-W37\n\n## 本周新增概览\n无\n" }],
            },
          ],
          error: undefined,
        }),
        delete: async () => {
          deleted = true
          return { data: true }
        },
      },
    } as unknown as HeadlessClient

    const result = await runWeeklyReview(
      {
        client,
        db,
        vaultDir,
        reindexNote: async (relPath) => {
          reindexed.push(relPath)
          return "id"
        },
      },
      now,
    )

    expect(created).toBe("weekly:2026-W37")
    expect(result.path).toMatch(/^_index\/weekly\/\d{12}-[a-z0-9]{4}-weekly-2026-w37\.md$/)
    expect(deleted).toBe(false)
    const text = await Bun.file(path.join(vaultDir, result.path)).text()
    const note = parseNote(text)
    expect(note.frontmatter.kind).toBe("weekly-review")
    expect(note.frontmatter.status).toBe("distilled")
    expect(note.body).toContain("# 周复盘 2026-W37")
    expect(reindexed).toEqual([result.path])
  })
})
