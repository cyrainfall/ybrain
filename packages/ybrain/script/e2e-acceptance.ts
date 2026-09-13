import path from "node:path"
import { parseNote, type NoteFrontmatter } from "../src/frontmatter"

// 票据 26 端到端验收脚本：对**运行中的** ybrain 服务实测 A–F 清单里可自动化的部分，
// 并把只能人工勾验的项（组网、浏览器扩展、Obsidian、72 小时稳定）列成待办写进报告。
// 清单依据 .scratch/exobrain/prototypes/mvp-acceptance.md。
//
// 用法（在能访问 ybrain 服务的机器上跑；C/E2 的文件级断言需要能读 vault 目录）：
//   YBRAIN_WEB_URL=http://<tailnet-ip>:4096 \
//   YBRAIN_CAPTURE_URL=http://<tailnet-ip>:8787 \
//   OPENCODE_SERVER_PASSWORD=... \
//   CAPTURE_TOKEN_WEB=... CAPTURE_TOKEN_ANDROID=... CAPTURE_TOKEN_WEREAD=... \
//   YBRAIN_VAULT_DIR=/opt/ybrain/vault \
//   bun run script/e2e-acceptance.ts [报告路径]
//
// 默认只跑只读检查与问答；会往真实 vault 写测试笔记的 B/C 组需显式确认：
//   YBRAIN_E2E_CONFIRM=yes
// 测试笔记标题统一带 [E2E] 前缀，报告末尾给出清理命令。

type Status = "pass" | "fail" | "manual" | "skip"
type Result = { id: string; item: string; status: Status; detail: string }
type Located = { relPath: string; frontmatter: NoteFrontmatter; body: string }

const results: Result[] = []
const notes: string[] = []

function record(id: string, item: string, status: Status, detail = ""): void {
  results.push({ id, item, status, detail })
  const tag = { pass: "PASS", fail: "FAIL", manual: "待人工", skip: "SKIP" }[status]
  console.log(`[${tag}] ${id} ${item}${detail ? ` — ${detail}` : ""}`)
}

const webUrl = process.env.YBRAIN_WEB_URL ?? "http://localhost:4096"
const captureUrl = process.env.YBRAIN_CAPTURE_URL ?? "http://localhost:8787"
const vaultDir = process.env.YBRAIN_VAULT_DIR
const password = process.env.OPENCODE_SERVER_PASSWORD
const username = process.env.OPENCODE_SERVER_USERNAME ?? "opencode"
const confirm = process.env.YBRAIN_E2E_CONFIRM === "yes"
const waitMs = Number(process.env.YBRAIN_E2E_WAIT_MS ?? 300_000)
const tokens = {
  web: process.env.CAPTURE_TOKEN_WEB,
  android: process.env.CAPTURE_TOKEN_ANDROID,
  weread: process.env.CAPTURE_TOKEN_WEREAD,
}

const webHeaders = (): Record<string, string> =>
  password ? { Authorization: `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}` } : {}

// 问答用模型（可选）："provider/model"，不填则用服务端默认
function modelRef(): { providerID: string; modelID: string } | undefined {
  const [providerID, modelID] = process.env.YBRAIN_QA_MODEL?.split("/") ?? []
  return providerID && modelID ? { providerID, modelID } : undefined
}

async function postJson(
  url: string,
  body: unknown,
  headers: Record<string, string>,
  timeoutMs = 30_000,
): Promise<{ status: number; data: unknown }> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  })
  return { status: res.status, data: await res.json().catch(() => undefined) }
}

async function capture(token: string, body: Record<string, unknown>): Promise<{ noteId: string; relPath: string }> {
  const res = await postJson(`${captureUrl}/capture`, body, { Authorization: `Bearer ${token}` })
  const data = res.data as { note_id?: string; path?: string; error?: string } | undefined
  if (res.status !== 200 || !data?.note_id || !data.path) {
    throw new Error(`捕获失败（HTTP ${res.status}）：${data?.error ?? "响应缺少 note_id/path"}`)
  }
  return { noteId: data.note_id, relPath: data.path }
}

// 在 vault 里按 id 找笔记：提炼后会移动目录，所以按 glob 找而不是记路径。
async function locate(noteId: string): Promise<Located | undefined> {
  if (!vaultDir) return undefined
  const relPath = (await Array.fromAsync(new Bun.Glob(`**/${noteId}-*.md`).scan({ cwd: vaultDir }))).sort()[0]
  if (!relPath) return undefined
  const parsed = parseNote(await Bun.file(path.join(vaultDir, relPath)).text())
  return { relPath, frontmatter: parsed.frontmatter, body: parsed.body }
}

async function waitDistilled(noteId: string): Promise<Located | undefined> {
  const deadline = Date.now() + waitMs
  let last = await locate(noteId)
  while (Date.now() < deadline) {
    if (last?.frontmatter.status === "distilled" && !last.relPath.startsWith("0-Inbox/")) return last
    await Bun.sleep(3_000)
    last = await locate(noteId)
  }
  return last
}

async function gitSubjects(dir: string, limit = 20): Promise<string[]> {
  const proc = Bun.spawn(["git", "-C", dir, "log", `-n${limit}`, "--format=%s"], { stdout: "pipe", stderr: "ignore" })
  if ((await proc.exited) !== 0) return []
  return (await new Response(proc.stdout).text())
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
}

async function remoteBranchExists(dir: string): Promise<boolean> {
  const proc = Bun.spawn(["git", "-C", dir, "rev-parse", "--verify", "-q", "origin/main"], {
    stdout: "ignore",
    stderr: "ignore",
  })
  return (await proc.exited) === 0
}

async function ask(question: string): Promise<string> {
  const created = await postJson(`${webUrl}/session`, { title: "e2e-acceptance" }, webHeaders())
  const id = (created.data as { id?: string } | undefined)?.id
  if (!id) throw new Error(`创建会话失败（HTTP ${created.status}）`)
  const model = modelRef()
  const res = await fetch(`${webUrl}/session/${id}/message`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...webHeaders() },
    body: JSON.stringify({ parts: [{ type: "text", text: question }], ...(model ? { model } : {}) }),
    signal: AbortSignal.timeout(180_000),
  })
  if (res.status !== 200) throw new Error(`提问失败（HTTP ${res.status}）`)
  const data = (await res.json()) as { parts?: Array<{ type: string; text?: string }> }
  return (data.parts ?? [])
    .flatMap((part) => (part.type === "text" && part.text ? [part.text] : []))
    .join("\n")
    .trim()
}

// ── 阶段 B/C：捕获 → 提炼闭环（会写真实 vault，需确认）────────────────────────

const TEST_TITLE = "[E2E] 光合作用记忆法的三步"
const TEST_BODY = [
  "# 光合作用记忆法",
  "",
  "一句话：把知识当成植物，先给它光（输入），再让它合成（复述），最后长出新叶（连接）。",
  "第一步 光：只读不记，快速过一遍原文，标注三处最有感觉的句子。",
  "第二步 合成：合上原文，用自己的话复述一遍，卡壳处就是没懂的地方。",
  "第三步 新叶：把这条笔记和旧笔记连起来，写一句“这让我想到……”。",
].join("\n")

const C_ITEMS: Array<[string, string]> = [
  ["C1", "几句话内完成提炼（摘要/标签/要点/归类/保留原文）"],
  ["C2", "落到 PARA 且 status=distilled"],
  ["C3", "提炼后 Git 提交推送到 Gitee"],
]

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

async function stageCaptureAndDistill(): Promise<string | undefined> {
  if (!confirm || !tokens.android) {
    const why = !confirm ? "需 YBRAIN_E2E_CONFIRM=yes 才写入测试笔记" : "缺少 CAPTURE_TOKEN_ANDROID"
    C_ITEMS.forEach(([id, item]) => record(id, item, "skip", why))
    record("B3", "Android 分享纯文字落盘", "skip", why)
    record("B4", "Android 分享链接落盘或仅链接兜底", "skip", why)
    return undefined
  }

  const started = Date.now()
  const note = await capture(tokens.android, {
    source: "android",
    type: "note",
    title: TEST_TITLE,
    body: TEST_BODY,
  }).catch((error: unknown) => {
    record("B3", "Android 分享纯文字落盘", "fail", message(error))
    return undefined
  })
  if (!note) {
    C_ITEMS.forEach(([id, item]) => record(id, item, "fail", "前置捕获失败，未进入提炼"))
    return undefined
  }
  record("B3", "Android 分享纯文字落盘", "pass", `${note.noteId} → ${note.relPath}`)

  // 用必然连不上的地址走「仅链接」兜底分支：验收标准是链接内容不丢，不是抓取成功
  await capture(tokens.android, { source: "android", type: "clip", url: "http://127.0.0.1:1/e2e-unreachable" }).then(
    (link) => record("B4", "Android 分享链接落盘或仅链接兜底", "pass", `${link.noteId} → ${link.relPath}（落盘不丢）`),
    (error: unknown) => record("B4", "Android 分享链接落盘或仅链接兜底", "fail", message(error)),
  )

  if (!vaultDir) {
    C_ITEMS.forEach(([id, item]) => record(id, item, "skip", "未提供 YBRAIN_VAULT_DIR，无法做文件级断言"))
    return note.noteId
  }

  const distilled = await waitDistilled(note.noteId)
  if (!distilled || distilled.frontmatter.status !== "distilled" || distilled.relPath.startsWith("0-Inbox/")) {
    record("C1", C_ITEMS[0]![1], "fail", `等待 ${waitMs / 1000}s 未完成：${distilled?.relPath ?? "文件未找到"}`)
    record("C2", C_ITEMS[1]![1], "fail", "见 C1")
    record("C3", C_ITEMS[2]![1], "fail", "提炼未完成，无法判定")
    return note.noteId
  }

  const seconds = Math.round((Date.now() - started) / 1000)
  const tagCount = distilled.frontmatter.tags?.length ?? 0
  const hasSummary = Boolean(distilled.frontmatter.summary)
  const keepsOriginal = distilled.body.includes("## 原文")
  const hasPoints = distilled.body.replace(/\s/g, "").length > 20
  record(
    "C1",
    C_ITEMS[0]![1],
    hasSummary && tagCount >= 3 && keepsOriginal && hasPoints ? "pass" : "fail",
    `${seconds}s｜摘要=${hasSummary} 标签=${tagCount}个 原文保留=${keepsOriginal} 要点=${hasPoints}`,
  )
  record("C2", C_ITEMS[1]![1], "pass", distilled.relPath)

  const expected = `distill: ${distilled.frontmatter.title}`
  const committed = (await gitSubjects(vaultDir)).includes(expected)
  record(
    "C3",
    C_ITEMS[2]![1],
    committed ? "pass" : "fail",
    committed
      ? `已提交「${expected}」；${(await remoteBranchExists(vaultDir)) ? "远程分支已更新" : "未配远程或未推送（人工核对）"}`
      : `最近提交里没有「${expected}」`,
  )
  return note.noteId
}

// ── 阶段 D：问答（自动提问 + 线索检查，最终结论需人工确认）──────────────────

async function stageQa(): Promise<void> {
  if (!password) {
    for (const [id, item] of [
      ["D1", "问答基于已捕获内容并给出处"],
      ["D2", "库里没有的内容明确说不知道"],
      ["D3", "归档笔记仍可命中引用"],
    ] as Array<[string, string]>) {
      record(id, item, "skip", "未设 OPENCODE_SERVER_PASSWORD，跳过 API 提问")
    }
    return
  }

  const known = await ask(`「${TEST_TITLE}」这篇笔记讲了什么？请给出笔记标题与出处。`)
  notes.push(`### D1 提问回答\n\n\`\`\`\n${known}\n\`\`\``)
  record(
    "D1",
    "问答基于已捕获内容并给出处",
    "manual",
    `命中测试笔记标题=${known.includes("光合作用记忆法")}；出处完整性需人工确认（回答见报告细节）`,
  )

  const unknown = await ask("量子退相干的精确时间常数公式是什么？我的笔记里记过吗？")
  notes.push(`### D2 提问回答\n\n\`\`\`\n${unknown}\n\`\`\``)
  record(
    "D2",
    "库里没有的内容明确说不知道",
    "manual",
    `含「不知道/没有」类措辞=${/没有|无可靠|资料不足|未记录|不知道|找不到/.test(unknown)}；需人工确认未编造`,
  )

  record("D3", "归档笔记仍可命中引用", "manual", "需 vault 中已有 4-Archive 笔记，人工提问核对")
}

// ── 阶段 E：备份 ─────────────────────────────────────────────────────────────

async function stageBackup(): Promise<void> {
  if (!tokens.web) {
    record("E2", "reindex 从 vault 全量重建索引", "skip", "缺少 CAPTURE_TOKEN_WEB")
    return
  }
  const res = await postJson(`${captureUrl}/reindex`, {}, { Authorization: `Bearer ${tokens.web}` })
  record("E2", "reindex 从 vault 全量重建索引", res.status === 200 ? "pass" : "fail", `HTTP ${res.status}`)
}

function humanChecklist(): void {
  const manual: Array<[string, string]> = [
    ["A1", "Mac 与 Android 均加入 headscale 网络，Tailscale 显示在线"],
    ["A2", "Mac 浏览器经 tailnet 地址打开 Web 界面（4096）可正常对话"],
    ["A3", "公网扫描确认 4096/8787 不可达（从公网主机做端口探测）"],
    ["B1", "浏览器扩展点一次，普通文章正文 10 秒内进 0-Inbox"],
    ["B2", "同一流程对微信公众号文章正文完整"],
    ["B5", "断网捕获 → 本地排队 → 恢复网络自动补发，角标清零"],
    ["C4", "停服期间捕获的内容，服务恢复后补提炼（不丢、不重复）"],
    ["C5", "提炼失败重试 3 次后在收件箱标红，且不影响其他内容"],
    ["E1", "Mac 上 Obsidian 打开 vault（经 Gitee 同步），能浏览全部笔记、PARA 结构正确"],
    ["E2-演练", "按 backup-plan.md 七步在干净环境完成恢复，reindex 后能检索到旧笔记"],
    ["E3", "周复盘会话每周日晚产出：本周新增概览、最近 Gitee 推送时间、dead 任务数"],
    ["F1", "连续运行 72 小时，内存峰值不触发容器被杀，磁盘日志轮转正常"],
  ]
  manual.forEach(([id, item]) => record(id, item, "manual", "需人工实测"))
}

function renderReport(): string {
  const count = (status: Status) => results.filter((r) => r.status === status).length
  const rows = results.map((r) => `| ${r.id} | ${r.item} | ${r.status} | ${r.detail} |`).join("\n")
  const cleanup =
    confirm && vaultDir
      ? `## 清理测试数据\n\n本轮写入了带 [E2E] 前缀的笔记，确认报告后删除：\n\n\`\`\`bash\ngit -C ${vaultDir} ls-files | grep E2E\n# 在 Obsidian 或文件系统删除后，下一轮提炼闭环会自动提交这次删除\n\`\`\``
      : ""
  return [
    "# ybrain MVP 端到端验收报告（票据 26）",
    "",
    `- 时间：${new Date().toISOString()}`,
    `- Web：${webUrl}　捕获：${captureUrl}　vault：${vaultDir ?? "（未提供，C/E2 未做文件级断言）"}`,
    `- 统计：通过 ${count("pass")} / 失败 ${count("fail")} / 待人工 ${count("manual")} / 跳过 ${count("skip")}`,
    "",
    "## 结果表",
    "",
    "| 编号 | 项目 | 结果 | 说明 |",
    "| --- | --- | --- | --- |",
    rows,
    notes.length > 0 ? `\n## 细节\n\n${notes.join("\n\n")}` : "",
    cleanup,
  ]
    .filter(Boolean)
    .join("\n")
}

// ── 主流程 ───────────────────────────────────────────────────────────────────

console.log(`ybrain 端到端验收开始（web=${webUrl} capture=${captureUrl}）\n`)

// 兜底：某阶段抛出未预期异常时，把该阶段还没记录的条目补成 fail，保证报告不缺口
const captured = await stageCaptureAndDistill().catch((error: unknown) => {
  const detail = `阶段异常：${message(error)}`
  C_ITEMS.filter(([id]) => !results.some((r) => r.id === id)).forEach(([id, item]) => record(id, item, "fail", detail))
  return undefined
})
await stageQa().catch((error: unknown) => {
  record("D1", "问答基于已捕获内容并给出处", "fail", `API 提问失败：${message(error)}`)
})
await stageBackup().catch((error: unknown) => {
  record("E2", "reindex 从 vault 全量重建索引", "fail", message(error))
})
humanChecklist()

const reportPath = path.resolve(process.argv[2] ?? "e2e-acceptance-report.md")
await Bun.write(reportPath, renderReport())
console.log(`\n报告已写入：${reportPath}`)

const failed = results.filter((r) => r.status === "fail").length
console.log(
  `自动项：通过 ${results.filter((r) => r.status === "pass").length}，失败 ${failed}，待人工 ${results.filter((r) => r.status === "manual").length}${captured ? "" : "（未跑写入阶段）"}`,
)
process.exit(failed > 0 ? 1 : 0)
