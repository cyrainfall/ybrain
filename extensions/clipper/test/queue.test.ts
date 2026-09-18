import { describe, expect, it } from "bun:test"
import { createQueue } from "../lib/queue.js"
import { memoryStorage } from "./lib/memory-storage.js"

// 发送失败队列（票据 20）：验证入队/出队与跨次持久化，不碰 chrome。

const payload = (title: string) => ({ source: "web", type: "clip", title, body: "x" })

type QueueItem = { id: string; payload: { title: string; created?: string } }
const titles = (items: QueueItem[]) => items.map((item) => item.payload.title)

describe("capture queue (ticket 20)", () => {
  it("adds a payload under a fresh id", async () => {
    const queue = createQueue(memoryStorage())
    const item = await queue.add(payload("a"))

    expect(item.id).toBeString()

    const list = await queue.list()
    expect(list).toHaveLength(1)
    expect(list[0]?.id).toBe(item.id)
    expect(list[0]?.payload.title).toBe("a")
  })

  it("keeps FIFO order and survives a reload of the extension", async () => {
    const storage = memoryStorage()
    const queue = createQueue(storage)
    await queue.add(payload("first"))
    await queue.add(payload("second"))

    // 服务工作线程会被回收，队列必须来自存储而不是内存
    const reloaded = createQueue(storage)
    expect(titles(await reloaded.list())).toEqual(["first", "second"])
  })

  it("removes a delivered item", async () => {
    const queue = createQueue(memoryStorage())
    const first = await queue.add(payload("first"))
    await queue.add(payload("second"))

    await queue.remove(first.id)
    expect(titles(await queue.list())).toEqual(["second"])
  })

  it("keeps the original capture time in the payload for a retry", async () => {
    const queue = createQueue(memoryStorage())
    const createdAt = "2026-09-18T10:00:00.000Z"
    await queue.add({ ...payload("offline"), created: createdAt })

    // 补发时投递的是入队那一刻的请求体，服务器仍记原始捕获时间
    expect((await queue.list())[0]?.payload.created).toBe(createdAt)
  })
})
