import { mkdir } from "node:fs/promises"

// vault 的 Git 备份（票据 25）：提炼闭环后自动提交并推送 Gitee 私有仓库。
// 核心纪律：备份失败绝不阻塞提炼（票据 12 §6）——产物已在文件系统，下一次闭环会连带重试。
// 提交身份写死（不依赖容器内 ~/.gitconfig），远程地址由插件的 YBRAIN_VAULT_REMOTE 环境变量注入；
// 部署步骤见 deploy/README.md 第四节。

const AUTHOR_NAME = "ybrain"
const AUTHOR_EMAIL = "ybrain@localhost"
const BRANCH = "main"

export type GitStatus = { ok: true; detail: string } | { ok: false; reason: string }

export type BackupStatus = { remoteConfigured: boolean; lastPush?: string }

export type VaultGitOptions = {
  vaultDir: string
  // 未配置远程时只做本地提交（开发/演练），配置后自动维护 origin。
  remote?: string
}

export function createVaultGit(options: VaultGitOptions) {
  // -c 形式注入身份，避免依赖容器内 ~/.gitconfig；每次调用都带上，不污染全局配置。
  const identity = ["-c", `user.name=${AUTHOR_NAME}`, "-c", `user.email=${AUTHOR_EMAIL}`]

  async function git(args: string[], withIdentity = false): Promise<{ code: number; stdout: string; stderr: string }> {
    try {
      const proc = Bun.spawn(
        ["git", "-C", options.vaultDir, ...(withIdentity ? identity : []), ...args],
        { stdout: "pipe", stderr: "pipe" },
      )
      const [code, stdout, stderr] = await Promise.all([
        proc.exited,
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
      ])
      return { code, stdout: stdout.trim(), stderr: stderr.trim() }
    } catch (error) {
      // git 未安装或不可执行：备份能力整体降级，返回失败状态而不是抛出，
      // 保证提炼主流程不被外部命令缺失中断。
      return { code: -1, stdout: "", stderr: error instanceof Error ? error.message : String(error) }
    }
  }

  async function isRepo(): Promise<boolean> {
    return (await git(["rev-parse", "--is-inside-work-tree"])).stdout === "true"
  }

  // 首次使用或配置变更时对齐：init 仓库 + 维护 origin。
  async function ensureRepo(): Promise<GitStatus> {
    if (!(await isRepo())) {
      await mkdir(options.vaultDir, { recursive: true })
      const init = await git(["init", "-q"])
      if (init.code !== 0) return { ok: false, reason: `git init 失败：${init.stderr}` }
      // 统一分支名，避免不同 git 版本的默认分支（master/main）漂移
      await git(["symbolic-ref", "HEAD", `refs/heads/${BRANCH}`])
    }

    if (!options.remote) return { ok: true, detail: "本地仓库已就绪（未配置远程，仅本地提交）" }
    const current = (await git(["remote", "get-url", "origin"])).stdout
    if (current === options.remote) return { ok: true, detail: `远程 origin 已指向 ${options.remote}` }
    const set = await git(
      current
        ? ["remote", "set-url", "origin", options.remote]
        : ["remote", "add", "origin", options.remote],
    )
    if (set.code !== 0) return { ok: false, reason: `配置远程 origin 失败：${set.stderr}` }
    return { ok: true, detail: `远程 origin → ${options.remote}` }
  }

  // 提炼前拉取 Mac 端手写改动；冲突留给本人用 Git 合并（票据 25 第 4 条），只告警不阻塞。
  async function pull(): Promise<GitStatus> {
    if (!options.remote) return { ok: true, detail: "未配置远程，跳过 pull" }

    const fetched = await git(["fetch", "origin"])
    if (fetched.code !== 0) {
      return { ok: false, reason: `git fetch 失败（跳过本次拉取）：${fetched.stderr || fetched.stdout}` }
    }
    if ((await git(["rev-parse", "--verify", "-q", `origin/${BRANCH}`])).code !== 0) {
      return { ok: true, detail: "远程尚无提交，跳过合并" }
    }

    const merged = await git(["merge", "--no-edit", `origin/${BRANCH}`])
    if (merged.code !== 0) {
      return {
        ok: false,
        reason: `git merge 失败（可能有冲突，需本人用 Git 合并后继续）：${merged.stderr || merged.stdout}`,
      }
    }
    return { ok: true, detail: merged.stdout || "已是最新" }
  }

  async function commitAll(message: string): Promise<GitStatus> {
    if (!(await isRepo())) return { ok: false, reason: "vault 还不是 Git 仓库" }
    if (!(await git(["status", "--porcelain"])).stdout) return { ok: true, detail: "没有需要提交的改动" }

    const added = await git(["add", "-A"])
    if (added.code !== 0) return { ok: false, reason: `git add 失败：${added.stderr}` }
    const committed = await git(["commit", "-q", "-m", message], true)
    if (committed.code !== 0) return { ok: false, reason: `git commit 失败：${committed.stderr || committed.stdout}` }
    return { ok: true, detail: `已提交：${message}` }
  }

  // 推送所有本地领先提交——上次推送失败的会在这次一并补上（票据 25：下次重试）。
  async function push(): Promise<GitStatus> {
    if (!options.remote) return { ok: true, detail: "未配置远程，仅本地提交" }

    const pushed = await git(["push", "-q", "-u", "origin", `HEAD:${BRANCH}`])
    if (pushed.code !== 0) {
      return { ok: false, reason: `git push 失败（下次闭环重试）：${pushed.stderr || pushed.stdout}` }
    }
    return { ok: true, detail: "已推送到 Gitee" }
  }

  // 周复盘用：远程是否配置 + 最近一次推送到远程的时间（取远程跟踪分支最新提交时间近似）。
  async function backupStatus(): Promise<BackupStatus> {
    if (!options.remote) return { remoteConfigured: false }
    const refs = await git([
      "for-each-ref",
      "--sort=-committerdate",
      "--format=%(committerdate:iso-strict)",
      "refs/remotes/origin/",
    ])
    const lastPush = refs.stdout
      .split("\n")
      .map((line) => line.trim())
      .find(Boolean)
    return { remoteConfigured: true, lastPush }
  }

  return { ensureRepo, pull, commitAll, push, backupStatus }
}

export type VaultGit = ReturnType<typeof createVaultGit>
