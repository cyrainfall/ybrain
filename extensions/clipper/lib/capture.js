// 捕获请求（票据 20）：把端内提取的文章拼成 /capture 请求体并发送。
// 接口契约见 .scratch/exobrain/prototypes/capture-api.md。

export const CAPTURE_SOURCE = "web"

export class CaptureError extends Error {
  constructor(status, message) {
    super(message)
    this.name = "CaptureError"
    this.status = status
  }
}

export function buildPayload(article, options = {}) {
  const tags = options.tags ?? []
  return {
    source: CAPTURE_SOURCE,
    type: "clip",
    title: article.title?.trim() || undefined,
    url: article.url,
    author: article.byline?.trim() || undefined,
    body: article.textContent,
    tags: tags.length > 0 ? tags : undefined,
    // 捕获时刻由客户端决定：离线排队后补发仍记原始时间
    created: options.createdAt ?? new Date().toISOString(),
  }
}

// 标签输入按逗号（中英文）、顿号与空白切分，去重后交给服务端写 frontmatter。
export function parseTags(input) {
  return Array.from(
    new Set(
      String(input ?? "")
        .split(/[,，、\s]+/)
        .map((tag) => tag.trim())
        .filter((tag) => tag.length > 0),
    ),
  )
}

// 只有 400（请求体本身有问题）算永久失败，重试无意义；
// 断网、5xx、令牌写错都留在队列里，等用户修好配置或网络恢复后自动补发。
export function isPermanentFailure(error) {
  return error instanceof CaptureError && error.status === 400
}

export async function sendCapture(settings, payload, fetchImpl = fetch) {
  const response = await fetchImpl(`${settings.endpoint}/capture`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${settings.token}`,
    },
    body: JSON.stringify(payload),
  })
  if (!response.ok) throw new CaptureError(response.status, `HTTP ${response.status}`)
  return await response.json()
}
