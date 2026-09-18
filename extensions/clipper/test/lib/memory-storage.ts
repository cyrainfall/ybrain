// chrome.storage.local 的内存替身（与它同形：get 只返回命中的键），供测试注入。
export function memoryStorage(initial: Record<string, unknown> = {}) {
  const data: Record<string, unknown> = { ...initial }
  return {
    data,
    get: async (key: string) => (key in data ? { [key]: data[key] } : {}),
    set: async (entries: Record<string, unknown>) => void Object.assign(data, entries),
  }
}
