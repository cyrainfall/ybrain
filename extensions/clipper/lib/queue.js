// 发送失败队列（票据 20）：发送失败的剪藏存 chrome.storage.local，
// 下次补发时按原捕获时间投递（payload.created 已固定，补发不会把时间记成补发时刻）。
// 存储适配器与 chrome.storage.local 同形（get/set），测试注入内存实现。

export const QUEUE_KEY = "queue"

export function createQueue(storage) {
  const list = async () => (await storage.get(QUEUE_KEY))[QUEUE_KEY] ?? []
  const write = (items) => storage.set({ [QUEUE_KEY]: items })

  return {
    list,
    async add(payload) {
      const item = { id: crypto.randomUUID(), payload }
      await write([...(await list()), item])
      return item
    },
    async remove(id) {
      await write((await list()).filter((item) => item.id !== id))
    },
  }
}
