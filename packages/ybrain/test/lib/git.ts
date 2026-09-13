import { describe } from "bun:test"

// 测试共享的 git 断言工具（票据 25）：跑真 git 进程读写临时仓库，不 mock。
// 本机没有 git 时整组 git 相关用例自动跳过（与向量扩展的 describeVec 同一套约定）。

export const gitAvailable =
  Bun.spawnSync(["git", "--version"], { stdout: "ignore", stderr: "ignore" }).exitCode === 0

export const describeGit = gitAvailable ? describe : describe.skip

export function runGit(cwd: string, args: string[]): { code: number; out: string } {
  const proc = Bun.spawnSync(["git", "-C", cwd, ...args], { stdout: "pipe", stderr: "pipe" })
  return { code: proc.exitCode, out: proc.stdout.toString().trim() }
}
