// 配置页（票据 20）：tailnet 地址 + web 渠道令牌存 chrome.storage.local。

import { loadSettings, saveSettings } from "./lib/settings.js"

const form = document.getElementById("settings")
const endpoint = document.getElementById("endpoint")
const token = document.getElementById("token")
const status = document.getElementById("status")

async function init() {
  const settings = await loadSettings(chrome.storage.local)
  endpoint.value = settings.endpoint
  token.value = settings.token
}

form.addEventListener("submit", async (event) => {
  event.preventDefault()
  const next = await saveSettings(chrome.storage.local, { endpoint: endpoint.value, token: token.value })
  endpoint.value = next.endpoint
  status.textContent = next.endpoint && next.token ? "已保存" : "已保存，但地址与令牌要都填上才能剪藏"
  status.hidden = false
})

void init()
