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

// 注意：建表用 create table if not exists，字段变更不会迁移旧库。
// data/ 是可重建的索引层（vault 才是真相源）：改结构后删掉 index.db 重跑 reindex 即可。
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

create table if not exists jobs (
  id text primary key,
  note_id text not null,
  type text not null,
  status text not null,
  retries integer not null default 0,
  error text,
  created_at text not null
);
create index if not exists jobs_status on jobs(status);
`

// setCustomSQLite 是进程级设置，必须在创建任何 Database 之前调用一次且仅一次。
let customSqliteConfigured = false

export function openIndex(options: OpenIndexOptions): Database {
  if (options.customSqlitePath && !customSqliteConfigured) {
    Database.setCustomSQLite(options.customSqlitePath)
    customSqliteConfigured = true
  }
  const db = new Database(options.path)
  db.loadExtension(options.vecExtension)
  db.exec(SCHEMA)
  return db
}
