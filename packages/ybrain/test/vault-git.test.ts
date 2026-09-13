import { afterEach, describe, expect, it } from "bun:test"
import { mkdir, mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { createVaultGit } from "../src/vault-git"
import { describeGit, runGit } from "./lib/git"

// vault 的 Git 备份（票据 25）：真 git 进程 + 真仓库，不 mock。
// 用本地裸仓库当远程，等价复刻「提炼后 Gitee 可见提交」（验收 C3）的推送链路。

const dirs: string[] = []
afterEach(async () => {
  await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })))
  dirs.length = 0
})

async function tempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), prefix))
  dirs.push(dir)
  return dir
}

async function writeNote(vaultDir: string, name: string, body: string): Promise<void> {
  await mkdir(path.join(vaultDir, "0-Inbox"), { recursive: true })
  await Bun.write(path.join(vaultDir, "0-Inbox", name), body)
}

// 建一个裸仓库当远程，并可从它读出分支内容。
async function bareRemote(): Promise<string> {
  const dir = await tempDir("ybrain-remote-")
  runGit(dir, ["init", "--bare", "-q"])
  return dir
}

describeGit("vault git backup (ticket 25)", () => {
  it("initializes the vault as a git repository with a stable main branch", async () => {
    const vaultDir = await tempDir("ybrain-git-")
    const git = createVaultGit({ vaultDir })

    const status = await git.ensureRepo()
    expect(status.ok).toBe(true)
    expect(runGit(vaultDir, ["rev-parse", "--is-inside-work-tree"]).out).toBe("true")
    expect(runGit(vaultDir, ["symbolic-ref", "--short", "HEAD"]).out).toBe("main")

    // 幂等：再次调用不报错
    expect((await git.ensureRepo()).ok).toBe(true)
  })

  it("commits all vault changes with the given message and a fixed author", async () => {
    const vaultDir = await tempDir("ybrain-git-")
    const git = createVaultGit({ vaultDir })
    await git.ensureRepo()
    await writeNote(vaultDir, "a.md", "第一条")

    const status = await git.commitAll("distill: 测试笔记")
    expect(status.ok).toBe(true)
    expect(runGit(vaultDir, ["log", "-1", "--format=%s"]).out).toBe("distill: 测试笔记")
    expect(runGit(vaultDir, ["log", "-1", "--format=%an"]).out).toBe("ybrain")
  })

  it("skips the commit when the vault has no changes", async () => {
    const vaultDir = await tempDir("ybrain-git-")
    const git = createVaultGit({ vaultDir })
    await git.ensureRepo()
    await writeNote(vaultDir, "a.md", "第一条")
    await git.commitAll("distill: 第一条")

    const again = await git.commitAll("distill: 第二条")
    expect(again.ok).toBe(true)
    expect(again.ok && again.detail).toContain("没有需要提交")
    // 仍只有一条提交
    expect(runGit(vaultDir, ["rev-list", "--count", "HEAD"]).out).toBe("1")
  })

  it("pushes the distill commit to the configured remote", async () => {
    const remote = await bareRemote()
    const vaultDir = await tempDir("ybrain-git-")
    const git = createVaultGit({ vaultDir, remote })
    await git.ensureRepo()
    await writeNote(vaultDir, "a.md", "第一条")
    await git.commitAll("distill: 第一条")

    const pushed = await git.push()
    expect(pushed.ok).toBe(true)
    expect(runGit(remote, ["log", "-1", "--format=%s", "main"]).out).toBe("distill: 第一条")
  })

  it("reports push failure instead of throwing so distillation is never blocked", async () => {
    const missing = path.join(await tempDir("ybrain-git-"), "no-such-remote.git")
    const vaultDir = await tempDir("ybrain-git-")
    const git = createVaultGit({ vaultDir, remote: missing })
    await git.ensureRepo()
    await writeNote(vaultDir, "a.md", "第一条")
    await git.commitAll("distill: 第一条")

    const pushed = await git.push()
    expect(pushed.ok).toBe(false)
    // 提交已在本地，等下次闭环重试
    expect(runGit(vaultDir, ["log", "-1", "--format=%s"]).out).toBe("distill: 第一条")
  })

  it("does local-only commits and skips pull when no remote is configured", async () => {
    const vaultDir = await tempDir("ybrain-git-")
    const git = createVaultGit({ vaultDir })
    await git.ensureRepo()

    const pulled = await git.pull()
    expect(pulled.ok).toBe(true)
    expect(pulled.ok && pulled.detail).toContain("未配置远程")
    const pushed = await git.push()
    expect(pushed.ok).toBe(true)
    expect(pushed.ok && pushed.detail).toContain("未配置远程")
  })

  it("pulls remote changes so Mac edits flow back before distillation", async () => {
    const remote = await bareRemote()
    // 先在远程放一条提交（模拟 Mac 端 Obsidian 推送）
    const seed = await tempDir("ybrain-seed-")
    runGit(seed, ["init", "-q"])
    await Bun.write(path.join(seed, "mac.md"), "Mac 手写")
    runGit(seed, ["-c", "user.name=mac", "-c", "user.email=mac@local", "add", "-A"])
    runGit(seed, ["-c", "user.name=mac", "-c", "user.email=mac@local", "commit", "-q", "-m", "mac: 手写"])
    runGit(seed, ["remote", "add", "origin", remote])
    runGit(seed, ["push", "-q", "origin", "HEAD:main"])

    const vaultDir = await tempDir("ybrain-git-")
    const git = createVaultGit({ vaultDir, remote })
    await git.ensureRepo()

    const pulled = await git.pull()
    expect(pulled.ok).toBe(true)
    expect(await Bun.file(path.join(vaultDir, "mac.md")).text()).toBe("Mac 手写")
  })

  it("reports backup status for the weekly review", async () => {
    const noRemoteDir = await tempDir("ybrain-git-")
    const noRemote = createVaultGit({ vaultDir: noRemoteDir })
    expect(await noRemote.backupStatus()).toEqual({ remoteConfigured: false })

    const remote = await bareRemote()
    const vaultDir = await tempDir("ybrain-git-")
    const git = createVaultGit({ vaultDir, remote })
    await git.ensureRepo()
    await writeNote(vaultDir, "a.md", "第一条")
    await git.commitAll("distill: 第一条")
    // 推送前没有远程跟踪分支
    expect((await git.backupStatus()).lastPush).toBeUndefined()

    await git.push()
    const after = await git.backupStatus()
    expect(after.remoteConfigured).toBe(true)
    expect(after.lastPush).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })
})
