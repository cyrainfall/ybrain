// 后台服务（票据 20）：持有发送队列、角标与补发心跳。
// 弹窗打开、浏览器启动、以及有积压时的一分钟心跳都会触发补发；投递成功的项出队，角标显示积压数。

import { isPermanentFailure, sendCapture } from "./lib/capture.js"
import { createQueue } from "./lib/queue.js"
import { isConfigured, loadSettings } from "./lib/settings.js"

const RETRY_ALARM = "ybrain-retry"

const queue = createQueue(chrome.storage.local)

// 投递串行化：每个调用点的那一轮都排在前面所有轮之后，
// 这样刚入队的项一定能被它自己发起的那一轮看到（否则会误报成「已排队」）。
let tail = Promise.resolve()

function flush() {
  const run = tail.then(() => runFlush())
  tail = run.catch(() => {})
  return run
}

async function runFlush() {
  const settings = await loadSettings(chrome.storage.local)
  const items = await queue.list()
  if (!isConfigured(settings)) {
    return { sent: [], dropped: [], pending: await syncQueueState(), reason: "尚未配置捕获地址与令牌" }
  }

  const sent = []
  const dropped = []
  let reason = ""

  // 顺序投递：断网时后续项大概率同样失败，遇到可重试错误就停下，留到下一轮
  for (const item of items) {
    try {
      const result = await sendCapture(settings, item.payload)
      await queue.remove(item.id)
      sent.push({ id: item.id, noteId: result.note_id, path: result.path })
    } catch (error) {
      const message = String(error?.message ?? error)
      if (isPermanentFailure(error)) {
        await queue.remove(item.id)
        dropped.push({ id: item.id, reason: message })
        continue
      }
      reason = message
      break
    }
  }

  return { sent, dropped, pending: await syncQueueState(), reason }
}

// 角标跟积压数走；只有存在积压时才挂一分钟心跳，网络恢复后不必重开弹窗也能补发（验收 B5）
async function syncQueueState() {
  const pending = (await queue.list()).length
  await chrome.action.setBadgeText({ text: pending > 0 ? String(pending) : "" })
  if (pending === 0) {
    await chrome.alarms.clear(RETRY_ALARM)
    return pending
  }

  await chrome.action.setBadgeBackgroundColor({ color: "#3b5bdb" })
  if (!(await chrome.alarms.get(RETRY_ALARM))) await chrome.alarms.create(RETRY_ALARM, { periodInMinutes: 1 })
  return pending
}

// 先入队再投递：弹窗中途关闭也不会丢内容，最差只是留到下一轮
async function handleCapture(payload) {
  const item = await queue.add(payload)
  const result = await flush()

  const sent = result.sent.find((entry) => entry.id === item.id)
  if (sent) return { ok: true, noteId: sent.noteId, path: sent.path, pending: result.pending }

  const dropped = result.dropped.find((entry) => entry.id === item.id)
  if (dropped) return { ok: false, reason: dropped.reason }

  return { ok: false, queued: true, reason: result.reason, pending: result.pending }
}

// chrome 的响应只能在任务结束后回调；成功与失败都收敛成一条消息
function respond(sendResponse, task) {
  task.then(
    (response) => sendResponse(response),
    (error) => sendResponse({ ok: false, reason: String(error?.message ?? error) }),
  )
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "capture") {
    respond(sendResponse, handleCapture(message.payload))
    return true
  }
  if (message?.type === "flush") {
    respond(
      sendResponse,
      flush().then((result) => ({ ok: true, ...result })),
    )
    return true
  }
  return false
})

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === RETRY_ALARM) void flush()
})

chrome.runtime.onStartup.addListener(() => void flush())

chrome.runtime.onInstalled.addListener(() => void syncQueueState())

// 服务工作线程每次唤醒（含浏览器启动）都尝试一轮并校正角标
void flush()
