import { describe, expect, it } from "bun:test"
import { DEFAULT_SETTINGS, isConfigured, loadSettings, normalizeEndpoint, saveSettings } from "../lib/settings.js"
import { memoryStorage } from "./lib/memory-storage.js"

// 配置存取（票据 20）：地址容错与前缀补全。

describe("settings (ticket 20)", () => {
  it("defaults to an empty endpoint and token", async () => {
    expect(await loadSettings(memoryStorage())).toEqual(DEFAULT_SETTINGS)
  })

  it("keeps a saved endpoint without a protocol as http and drops the trailing path", () => {
    expect(normalizeEndpoint("100.64.0.1:8787")).toBe("http://100.64.0.1:8787")
    expect(normalizeEndpoint("http://100.64.0.1:8787/")).toBe("http://100.64.0.1:8787")
    // 直接粘贴文档里的完整捕获地址也能用
    expect(normalizeEndpoint("http://100.64.0.1:8787/capture")).toBe("http://100.64.0.1:8787")
    expect(normalizeEndpoint("  https://ybrain.example.com  ")).toBe("https://ybrain.example.com")
    expect(normalizeEndpoint("")).toBe("")
  })

  it("normalizes and persists on save", async () => {
    const storage = memoryStorage()
    const saved = await saveSettings(storage, { endpoint: "100.64.0.1:8787/capture/", token: " tok " })

    expect(saved).toEqual({ endpoint: "http://100.64.0.1:8787", token: "tok" })
    expect(await loadSettings(storage)).toEqual(saved)
  })

  it("is only configured with both endpoint and token", () => {
    expect(isConfigured({ endpoint: "http://x:8787", token: "t" })).toBe(true)
    expect(isConfigured({ endpoint: "http://x:8787", token: "" })).toBe(false)
    expect(isConfigured({ endpoint: "", token: "t" })).toBe(false)
    expect(isConfigured(undefined)).toBe(false)
  })
})
