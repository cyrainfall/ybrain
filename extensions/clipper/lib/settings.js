// 扩展配置（票据 20）：tailnet 地址 + web 渠道令牌，存 chrome.storage.local。
// 捕获接口只在内网（Tailscale 虚拟网卡）可达，所以地址是形如 http://100.64.0.1:8787 的裸地址。
// 本模块不直接碰 chrome，存储适配器由调用方传入（与 chrome.storage.local 同形），便于测试。

export const SETTINGS_KEY = "settings"

export const DEFAULT_SETTINGS = { endpoint: "", token: "" }

export async function loadSettings(storage) {
  const stored = await storage.get(SETTINGS_KEY)
  return { ...DEFAULT_SETTINGS, ...stored?.[SETTINGS_KEY] }
}

export async function saveSettings(storage, settings) {
  const next = {
    endpoint: normalizeEndpoint(settings.endpoint),
    token: String(settings.token ?? "").trim(),
  }
  await storage.set({ [SETTINGS_KEY]: next })
  return next
}

export function isConfigured(settings) {
  return Boolean(settings?.endpoint && settings?.token)
}

// 容错：允许直接粘贴文档里的完整捕获地址（…/capture）、带尾斜杠的地址或不带协议的主机。
export function normalizeEndpoint(input) {
  const trimmed = String(input ?? "")
    .trim()
    .replace(/\/+$/, "")
    .replace(/\/capture$/i, "")
  if (!trimmed) return ""
  return /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`
}
