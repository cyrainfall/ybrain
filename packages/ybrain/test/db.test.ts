import { afterEach, describe, expect, it } from "bun:test"
import { Database } from "bun:sqlite"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { openIndex } from "../src/db"

// SQLite 索引层（票据 22）：notes / chunks / vec_chunks / jobs 四表。
// vec_chunks 是 sqlite-vec 虚拟表，需要扩展；本地按 deploy/README 第 6 条配置
// SQLITE_VEC_PATH（macOS 另需 CUSTOM_SQLITE_PATH）后才会运行，
// CI 无扩展时自动跳过（向量能力由 Docker spike 阶段验证）。

const vecExtension = process.env.SQLITE_VEC_PATH
const customSqlite = process.env.CUSTOM_SQLITE_PATH
const describeVec = vecExtension ? describe : describe.skip

const dirs: string[] = []
const opened: Database[] = []
afterEach(async () => {
  for (const db of opened) db.close()
  opened.length = 0
  await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })))
  dirs.length = 0
})

async function open(): Promise<Database> {
  const dir = await mkdtemp(path.join(tmpdir(), "ybrain-index-"))
  dirs.push(dir)
  const db = openIndex({
    path: path.join(dir, "index.db"),
    vecExtension: vecExtension!,
    customSqlitePath: customSqlite,
  })
  opened.push(db)
  return db
}

describeVec("SQLite 索引 schema", () => {
  it("creates the four tables", async () => {
    const db = await open()
    const names = (
      db.query("select name from sqlite_master where type = 'table'").all() as { name: string }[]
    ).map((row) => row.name)

    expect(names).toContain("notes")
    expect(names).toContain("chunks")
    expect(names).toContain("vec_chunks")
    expect(names).toContain("jobs")
  })

  it("is idempotent across reopens", async () => {
    const db = await open()
    const dbPath = (db.query("pragma database_list").all() as { file: string }[])[0]!.file
    db.close()
    expect(() =>
      openIndex({ path: dbPath, vecExtension: vecExtension!, customSqlitePath: customSqlite }).close(),
    ).not.toThrow()
  })

  it("makes vec_chunks a 1024-dimension vector table", async () => {
    const db = await open()
    const insert = db.prepare("insert into vec_chunks(rowid, embedding) values (?, ?)")

    insert.run(1, Buffer.from(new Float32Array(1024).buffer))
    expect(() => insert.run(2, Buffer.from(new Float32Array(3).buffer))).toThrow()

    const rows = db
      .query("select rowid, distance from vec_chunks where embedding match ? order by distance limit 1")
      .all(Buffer.from(new Float32Array(1024).buffer)) as { rowid: number; distance: number }[]
    expect(rows[0]?.rowid).toBe(1)
  })
})
