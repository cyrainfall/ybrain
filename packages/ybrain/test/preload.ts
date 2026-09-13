import { Database } from "bun:sqlite"

// 测试预载：setCustomSQLite 必须在进程内任何 Database 实例之前调用且只能一次。
// 队列/调度等非向量测试也会 new Database，与向量测试文件并行跑时会竞争，
// 因此在 bunfig.toml preload 阶段（所有测试模块求值前）统一装载。
const customSqlitePath = process.env.CUSTOM_SQLITE_PATH
if (customSqlitePath) Database.setCustomSQLite(customSqlitePath)
