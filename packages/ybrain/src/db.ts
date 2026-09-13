import { Database } from "bun:sqlite"

// SQLite 索引层（票据 22）：笔记文件是真相源，本库随时可从 vault 重建（reindex）。
// 表结构见 .scratch/exobrain/prototypes/data-model.md §5。
// vec_chunks 依赖 sqlite-vec 扩展：生产镜像的扩展路径由 SQLITE_VEC_PATH 提供
// （见 deploy/Dockerfile）；macOS 本地开发另需 CUSTOM_SQLITE_PATH（见 deploy/README 第 6 条）。

export const EMBEDDING_DIM = 1024

export type OpenIndexOptions = {
  path: string
  vecExtension: string
  customSqlitePath?: string
}

// jobs 表不依赖向量扩展：捕获服务在索引能力未配置时也要能入队（票据 24），
// 因此 DDL 单独导出，openQueue 用普通连接在同一个 index.db 上建它。
const JOBS_SCHEMA = `
create table if not exists jobs (
  id text primary key,
  note_id text not null,
  type text not null,
  status text not null,
  retries integer not null default 0,
  error text,
  created_at text not null,
  run_after integer not null default 0,
  started_at integer
);
create index if not exists jobs_status on jobs(status);
`

const SCHEMA = `
create table if not exists notes (
  id text primary key,
  path text not null,
  title text not null,
  type text not null,
  status text not null,
  url text,
  tags text,
  hash text not null,
  mtime integer not null
);

create table if not exists chunks (
  id integer primary key autoincrement,
  note_id text not null,
  ordinal integer not null,
  text text not null,
  embed_model text,
  embedded_at text
);
create index if not exists chunks_note_id on chunks(note_id);

create virtual table if not exists vec_chunks using vec0(embedding float[${EMBEDDING_DIM}]);

${JOBS_SCHEMA}
`

// 票据 24 前建的库没有 run_after / started_at；数据层可整体重建，
// 但加两列很便宜，顺手补齐避免旧库的领取查询直接报错。
function ensureJobsColumns(db: Database) {
  const columns = new Set(
    (db.query("pragma table_info(jobs)").all() as { name: string }[]).map((column) => column.name),
  )
  if (!columns.has("run_after")) db.exec("alter table jobs add column run_after integer not null default 0")
  if (!columns.has("started_at")) db.exec("alter table jobs add column started_at integer")
}

// setCustomSQLite 是进程级设置，必须在创建任何 Database 之前调用一次且仅一次。
let customSqliteConfigured = false

export function openIndex(options: OpenIndexOptions): Database {
  if (options.customSqlitePath && !customSqliteConfigured) {
    try {
      Database.setCustomSQLite(options.customSqlitePath)
    } catch (error) {
      // 测试预载（test/preload.ts）等场景已先装载过 sqlite：真正不兼容时
      // 下面的 loadExtension 会立刻报错，这里不吞其他问题。
      if (!String((error as Error)?.message).includes("already loaded")) throw error
    }
    customSqliteConfigured = true
  }
  const db = new Database(options.path)
  db.loadExtension(options.vecExtension)
  db.exec(SCHEMA)
  ensureJobsColumns(db)
  return db
}

// 只打开队列能力（不加载向量扩展）：捕获与提炼调度在索引未配置时仍可工作。
// 同一个 index.db 文件在同一进程内只会有知识连接或队列连接之一写入，不并发开两个。
export function openQueue(path: string): Database {
  const db = new Database(path)
  db.exec(JOBS_SCHEMA)
  ensureJobsColumns(db)
  return db
}
