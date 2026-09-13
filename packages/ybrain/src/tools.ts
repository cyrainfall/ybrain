import type { ToolDefinition } from "@opencode-ai/plugin"
import { tool } from "@opencode-ai/plugin"
import type { Database } from "bun:sqlite"
import path from "node:path"
import { NOTE_STATUSES, NOTE_TYPES, parseNote, type NoteFrontmatter } from "./frontmatter"
import { deadNoteIds } from "./queue"
import type { SearchHit, SearchOptions } from "./search"
import {
  deriveTitle,
  moveNote,
  newNoteId,
  noteFileName,
  PARA_FOLDERS,
  readNote,
  setDistilled,
  writeNote,
} from "./vault"

// 四个原生知识工具（票据 23）：契约见
// .scratch/exobrain/prototypes/rag-tools-and-prompt.md §1。
// 代理一律通过 save_note 写库、不直接碰文件，frontmatter 与原文区的完整性由工具保证。

export type ToolDeps = {
  vaultDir: string
  db: Database
  search: (query: string, options?: SearchOptions) => Promise<SearchHit[]>
  reindexNote: (relPath: string) => Promise<string>
  // 提炼模型名，写进 distilled 笔记的 distill_model 字段（溯源用）。
  distillModel?: string
}

// 反馈笔记的专用落点（票据 24 为票据 27 自我改进回路预留）。
const FEEDBACK_FOLDER = "0-Inbox/feedback"

export function createTools(deps: ToolDeps) {
  return {
    search_knowledge: searchKnowledge(deps),
    get_note: getNote(deps),
    list_inbox: listInbox(deps),
    save_note: saveNote(deps),
  }
}

function searchKnowledge(deps: ToolDeps): ToolDefinition {
  return tool({
    description:
      "语义检索我的个人知识库。回答任何「我以前看过/记过什么」的问题前必须先调用。" +
      "返回按相关性排序的笔记片段，其中 rerank_score 低于 0.1 视为依据不可靠。",
    args: {
      query: tool.schema.string().describe("自然语言问题或主题，原样传入即可"),
      k: tool.schema.number().optional().describe("返回条数，默认 5"),
      include_archived: tool.schema.boolean().optional().describe("是否包含存档笔记，默认 true"),
    },
    async execute(args) {
      // 契约要求返回数组；无命中即空数组，由代理依据指令回答「资料不足」。
      return JSON.stringify(await deps.search(args.query, { k: args.k, includeArchived: args.include_archived }), null, 2)
    },
  })
}

function getNote(deps: ToolDeps): ToolDefinition {
  return tool({
    description:
      "读取笔记全文（frontmatter + 正文，含原文区）。检索到片段但需要完整上下文时调用；" +
      "note_id 与 path 至少给一个。",
    args: {
      note_id: tool.schema.string().optional().describe("笔记 id，来自 search_knowledge 的结果"),
      path: tool.schema.string().optional().describe("vault 内相对路径，如 0-Inbox/202609061032-abcd-x.md"),
    },
    async execute(args) {
      const relPath = args.path ?? lookupPath(deps, args.note_id)
      if (!relPath) {
        return args.note_id
          ? `索引里找不到 note_id=${args.note_id} 的笔记，可改用 path 直接指定文件。`
          : "需要提供 note_id 或 path，至少一个。"
      }
      const file = Bun.file(path.join(deps.vaultDir, relPath))
      if (!(await file.exists())) return `笔记文件不存在：${relPath}`
      return JSON.stringify(await readNote(deps.vaultDir, relPath), null, 2)
    },
  })
}

function listInbox(deps: ToolDeps): ToolDefinition {
  return tool({
    description:
      "列出收件箱（0-Inbox）里的笔记摘要，用于「我有什么没处理的」类问题与提炼流程。" +
      "返回契约内的全部收件箱笔记，kind: feedback 的反馈笔记也在其中（供票据 27 自我改进回路，不参与提炼）。",
    args: {},
    async execute() {
      const paths = (await Array.fromAsync(new Bun.Glob("0-Inbox/**/*.md").scan({ cwd: deps.vaultDir }))).sort()
      const notes = await Promise.all(
        paths.map(async (relPath) => {
          const { frontmatter } = parseNote(await Bun.file(path.join(deps.vaultDir, relPath)).text())
          return {
            note_id: frontmatter.id,
            title: frontmatter.title,
            type: frontmatter.type,
            source: frontmatter.source,
            created: frontmatter.created,
            path: relPath,
            kind: frontmatter.kind,
          }
        }),
      )
      if (notes.length === 0) return "收件箱是空的。"
      // dead 任务随收件箱返回，供界面标红（验收 C5）；队列状态不是笔记属性，只做读取时拼接。
      const dead = deadNoteIds(deps.db)
      return JSON.stringify(notes.map((note) => ({ ...note, dead: dead.has(note.note_id) })), null, 2)
    },
  })
}

function saveNote(deps: ToolDeps): ToolDefinition {
  return tool({
    description:
      "新建或更新笔记。给 note_id 表示更新：正文只替换提炼区、原文区由系统保留；" +
      "省略 note_id 表示新建（落 0-Inbox，source 记为 agent）。",
    args: {
      note_id: tool.schema.string().optional().describe("更新已有笔记；省略则新建"),
      title: tool.schema.string().optional().describe("标题，新建时缺省取正文首行"),
      para_folder: tool.schema
        .enum(PARA_FOLDERS)
        .optional()
        .describe("移动到 PARA 目录；不填则留在原目录（新建时落 0-Inbox）"),
      folder: tool.schema
        .enum([FEEDBACK_FOLDER])
        .optional()
        .describe("仅新建反馈笔记时使用：落 0-Inbox/feedback，系统自动标记 kind: feedback"),
      frontmatter_patch: tool.schema
        .object({
          summary: tool.schema.string().optional(),
          tags: tool.schema.array(tool.schema.string()).optional(),
          related: tool.schema.array(tool.schema.string()).optional(),
          type: tool.schema.enum(NOTE_TYPES).optional().describe("书摘拆卡时用 card"),
          status: tool.schema.enum(NOTE_STATUSES).optional(),
        })
        .optional()
        .describe("frontmatter 增量更新：摘要 / 标签 / 相关笔记 / 类型 / 状态"),
      body: tool.schema.string().optional().describe("提炼区正文；原文区不要包含在内"),
    },
    async execute(args) {
      const patch = args.frontmatter_patch ?? {}

      if (args.note_id) {
        const relPath = lookupPath(deps, args.note_id)
        if (!relPath) return `索引里找不到 note_id=${args.note_id} 的笔记。`
        const existing = await readNote(deps.vaultDir, relPath)
        const frontmatter: NoteFrontmatter = {
          ...existing.frontmatter,
          ...patch,
          ...(args.title ? { title: args.title } : {}),
          distilled_at: new Date().toISOString(),
          // 只有真正完成提炼（status 翻 distilled）才记录模型，代理的普通改不动它。
          ...(patch.status === "distilled" && deps.distillModel ? { distill_model: deps.distillModel } : {}),
        }
        const body = args.body === undefined ? existing.body : setDistilled(existing.body, args.body)
        // 目标目录与当前不同才移动；moveNote 用原名，正文与原文区不受影响
        const folder = args.para_folder
        const target =
          folder && path.dirname(relPath) !== folder ? await moveNote(deps.vaultDir, relPath, folder) : relPath
        await writeNote(deps.vaultDir, target, { frontmatter, body })
        await deps.reindexNote(target)
        return JSON.stringify({ note_id: args.note_id, path: target })
      }

      const id = newNoteId()
      const title = args.title ?? deriveTitle(args.body) ?? "untitled"
      const folder = args.folder ?? args.para_folder ?? "0-Inbox"
      const relPath = `${folder}/${noteFileName(id, title)}`
      const frontmatter: NoteFrontmatter = {
        id,
        title,
        type: "note",
        source: "agent",
        created: new Date().toISOString(),
        status: "inbox",
        ...(args.folder === FEEDBACK_FOLDER ? { kind: "feedback" } : {}),
        ...patch,
      }
      await writeNote(deps.vaultDir, relPath, { frontmatter, body: args.body ?? "" })
      await deps.reindexNote(relPath)
      return JSON.stringify({ note_id: id, path: relPath })
    },
  })
}

function lookupPath(deps: ToolDeps, noteId: string | undefined): string | undefined {
  if (!noteId) return undefined
  const row = deps.db.query("select path from notes where id = ?").get(noteId) as { path: string } | null
  return row?.path
}
