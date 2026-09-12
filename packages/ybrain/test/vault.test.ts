import { afterEach, describe, expect, it } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { moveNote, noteFileName, readNote, setDistilled, splitOriginal, writeNote } from "../src/vault"
import type { NoteFrontmatter } from "../src/frontmatter"

// vault 读写（票据 22）：frontmatter 经编解码、PARA 移动、原文区保留、文件命名。
// 字段表与正文结构见 .scratch/exobrain/prototypes/data-model.md。

const dirs: string[] = []
afterEach(async () => {
  await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })))
  dirs.length = 0
})

async function withVault<T>(fn: (vaultDir: string) => Promise<T>): Promise<T> {
  const vaultDir = await mkdtemp(path.join(tmpdir(), "ybrain-vault-"))
  dirs.push(vaultDir)
  return fn(vaultDir)
}

const base: NoteFrontmatter = {
  id: "202609061032-abcd",
  title: "Build Exobrain",
  type: "note",
  source: "manual",
  created: "2026-09-06T10:32:00.000Z",
  status: "inbox",
}

describe("noteFileName", () => {
  it("combines the id and a slug of the title", () => {
    expect(noteFileName("202609061032-abcd", "Build Exobrain")).toBe("202609061032-abcd-build-exobrain.md")
  })

  it("falls back to a generic slug when the title has no ascii words", () => {
    expect(noteFileName("202609061032-abcd", "构建外脑")).toBe("202609061032-abcd-note.md")
  })

  it("gives different names to notes captured in the same minute", () => {
    const first = noteFileName("202609061032-aaaa", "构建外脑")
    const second = noteFileName("202609061032-bbbb", "构建外脑")
    expect(first).not.toBe(second)
  })
})

describe("readNote / writeNote", () => {
  it("round-trips a note through the filesystem", async () => {
    await withVault(async (vaultDir) => {
      const relPath = `0-Inbox/${noteFileName(base.id, base.title)}`
      await writeNote(vaultDir, relPath, { frontmatter: base, body: "正文内容" })

      const note = await readNote(vaultDir, relPath)
      expect(note.frontmatter).toEqual(base)
      expect(note.body.trim()).toBe("正文内容")
    })
  })
})

describe("moveNote", () => {
  it("moves a note into a PARA folder and leaves no copy behind", async () => {
    await withVault(async (vaultDir) => {
      const relPath = `0-Inbox/${noteFileName(base.id, base.title)}`
      await writeNote(vaultDir, relPath, { frontmatter: base, body: "正文内容" })

      const moved = await moveNote(vaultDir, relPath, "3-Resources")

      expect(moved).toBe(`3-Resources/${noteFileName(base.id, base.title)}`)
      expect(await Bun.file(path.join(vaultDir, moved)).exists()).toBe(true)
      expect(await Bun.file(path.join(vaultDir, relPath)).exists()).toBe(false)
      expect((await readNote(vaultDir, moved)).body.trim()).toBe("正文内容")
    })
  })
})

describe("原文区保留", () => {
  it("splits the body at the 原文 section, keeping its separator", () => {
    const { distilled, original } = splitOriginal("摘要\n\n---\n\n## 原文\n原始正文")
    expect(distilled).toBe("摘要\n\n")
    expect(original).toBe("---\n\n## 原文\n原始正文")
  })

  it("replaces the distilled part but keeps the 原文 section verbatim", () => {
    const updated = setDistilled("旧摘要\n\n---\n\n## 原文\n原始正文", "新摘要")
    expect(updated).toContain("新摘要")
    expect(updated).not.toContain("旧摘要")
    expect(updated).toContain("---\n\n## 原文\n原始正文")
  })

  it("replaces the whole body when there is no 原文 section", () => {
    expect(setDistilled("旧正文", "新正文").trim()).toBe("新正文")
  })
})
