import { Database } from "bun:sqlite"

// P1-3 spike：验证 ybrain 运行时链路 bun:sqlite + sqlite-vec 可用。
// 容器内扩展路径由 SQLITE_VEC_PATH=/opt/ybrain/extensions/vec0.so 提供。
// macOS 开发机上 Bun 默认链接系统 SQLite（不支持扩展加载），
// 通过 CUSTOM_SQLITE_PATH 指向 Homebrew 的 libsqlite3 后再实例化。
// 验证点：加载扩展 -> 建 1024 维 vec0 虚拟表（与生产嵌入维度一致）->
// 写入 float32 向量 -> KNN 查询命中精确匹配。
const extPath = process.env.SQLITE_VEC_PATH
if (!extPath) {
  console.error("FAIL: SQLITE_VEC_PATH is not set")
  process.exit(1)
}
if (process.env.CUSTOM_SQLITE_PATH) {
  Database.setCustomSQLite(process.env.CUSTOM_SQLITE_PATH)
}

const DIM = 1024
const db = new Database(":memory:")
db.loadExtension(extPath)

const versionRow = db.query("select vec_version() as v").get() as { v: string }
console.log(`sqlite-vec version: ${versionRow.v}`)

db.exec(`create virtual table vec_notes using vec0(embedding float[${DIM}])`)

// 5 个 one-hot 向量：彼此正交，rowid=3 的向量在第 2 维为 1，与查询完全一致。
const oneHot = (index: number) => {
  const v = new Float32Array(DIM)
  v[index] = 1
  return v
}
const insert = db.prepare("insert into vec_notes(rowid, embedding) values (?, ?)")
for (let i = 0; i < 5; i++) insert.run(i + 1, Buffer.from(oneHot(i).buffer))

const knn = db.prepare("select rowid, distance from vec_notes where embedding match ? order by distance limit 3")
const rows = knn.all(Buffer.from(oneHot(2).buffer)) as { rowid: number; distance: number }[]
console.log("knn result:", JSON.stringify(rows))

if (rows[0]?.rowid !== 3 || rows[0].distance !== 0) {
  console.error("FAIL: expected rowid=3 with distance 0 as nearest neighbor")
  process.exit(1)
}
if (rows.length !== 3) {
  console.error(`FAIL: expected 3 results, got ${rows.length}`)
  process.exit(1)
}

db.close()
console.log("PASS: sqlite-vec loads, 1024-dim vec0 table works, KNN returns exact match first")
