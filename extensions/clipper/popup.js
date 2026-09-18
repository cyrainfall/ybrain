// 弹窗（票据 20）：提取当前页正文 → 预览（可改标题/作者、补标签）→ 确认发送。
// 发送交给后台服务工作线程，弹窗关闭也不丢内容（先进队列再投递）。

import { buildPayload, parseTags } from "./lib/capture.js"
import { isConfigured, loadSettings } from "./lib/settings.js"

const el = (id) => document.getElementById(id)
const nodes = {
  unconfigured: el("unconfigured"),
  form: el("form"),
  queue: el("queue"),
  title: el("title"),
  author: el("author"),
  tags: el("tags"),
  preview: el("preview"),
  count: el("count"),
  status: el("status"),
  error: el("error"),
  send: el("send"),
  options: el("open-options"),
}

let article = null

async function init() {
  nodes.options.addEventListener("click", () => chrome.runtime.openOptionsPage())
  nodes.send.addEventListener("click", () => void send())

  // 打开弹窗即触发一次补发（票据 20：失败队列在弹窗打开时自动重试）
  await flushQueue()

  const settings = await loadSettings(chrome.storage.local)
  if (!isConfigured(settings)) {
    nodes.unconfigured.hidden = false
    return
  }

  nodes.form.hidden = false
  await extract()
}

async function extract() {
  setError("")
  setStatus("")
  nodes.send.disabled = true
  article = null

  const result = await currentArticle().catch((error) => ({
    ok: false,
    reason: `无法读取当前页面：${String(error?.message ?? error)}`,
  }))
  if (!result?.ok) return setError(result?.reason ?? "提取失败")

  article = result
  nodes.title.value = result.title ?? ""
  nodes.author.value = result.byline ?? ""
  nodes.preview.value = result.textContent
  nodes.count.textContent = `${result.textContent.length} 字${result.fallenBack ? "（整页兜底）" : ""}`
  nodes.send.disabled = false
}

async function currentArticle() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  if (!tab?.id) return { ok: false, reason: "没有找到当前标签页" }
  const [injection] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    files: ["vendor/Readability.js", "content/extract.js"],
  })
  return injection?.result ?? { ok: false, reason: "提取失败" }
}

async function send() {
  if (!article) return
  nodes.send.disabled = true
  setError("")
  setStatus("发送中…")

  const payload = buildPayload(
    { ...article, title: nodes.title.value, byline: nodes.author.value },
    { tags: parseTags(nodes.tags.value), createdAt: new Date().toISOString() },
  )
  const result = await chrome.runtime
    .sendMessage({ type: "capture", payload })
    .catch((error) => ({ ok: false, reason: String(error?.message ?? error) }))

  nodes.send.disabled = false
  showQueue(result.pending, result.reason)

  if (result.ok) {
    nodes.send.disabled = true
    return setStatus(`已进收件箱：${result.path}`, "ok")
  }
  if (result.queued) return setStatus(`发送失败，已排队（积压 ${result.pending} 条）：${result.reason}`, "error")
  setError(`发送失败：${result.reason}`)
}

async function flushQueue() {
  const result = await chrome.runtime.sendMessage({ type: "flush" }).catch(() => null)
  if (result) showQueue(result.pending, result.reason)
}

function showQueue(pending, reason) {
  if (typeof pending !== "number") return
  nodes.queue.textContent = pending > 0 ? `积压 ${pending} 条` : ""
  nodes.queue.title = pending > 0 ? (reason ?? "") : ""
}

function setStatus(text, tone) {
  nodes.status.textContent = text
  nodes.status.hidden = !text
  nodes.status.className = `status${tone ? ` ${tone}` : ""}`
}

function setError(text) {
  nodes.error.textContent = text
  nodes.error.hidden = !text
}

void init()
