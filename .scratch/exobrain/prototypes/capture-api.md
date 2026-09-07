# 捕获层接口约定（票据 08 工件，构建依据）

2026-09-06 定稿。范围：MVP 渠道 = 浏览器扩展（Mac）+ HTTP Shortcuts（Android）+ 微信读书同步（票据 15）；**企业微信不进 MVP**。

## 1. 接口

`POST http://<tailnet-ip>:8787/capture`，仅监听 Tailscale 虚拟网卡。

请求头：`Authorization: Bearer <CAPTURE_TOKEN_*>`、`Content-Type: application/json`。

请求体（全部字段除 source/type 外可选）：

| 字段 | 说明 |
| --- | --- |
| `source` | `web` / `android` / `weread` / `manual` |
| `type` | `clip`（剪藏/链接）/ `note`（纯文本速记） |
| `title` | 标题；缺省服务器取正文首行或域名 |
| `url` | 原始链接 |
| `author` | 作者 |
| `body` | 正文纯文本/Markdown；**缺省且有 url 时服务器抓取** |
| `created` | ISO 8601；缺省服务器时间 |

响应：`200 { "ok": true, "note_id": "...", "path": "0-Inbox/...md" }`
错误：`401`（令牌无效）、`400`（url 与 body 都没有）、`500`（落盘失败，客户端应重试）。

## 2. 服务器行为

1. 验令牌（按渠道独立令牌：`CAPTURE_TOKEN_WEB` / `_ANDROID` / `_WEREAD`，存 .env，可单独吊销）；
2. **永远先落盘**：写 `0-Inbox/<时间戳>-<slug>.md`（frontmatter 按票据 10 规范，`status: inbox`）→ 返回 200；
3. `body` 缺失但有 `url`：落盘后异步抓取正文（TS 侧 Readability 类提取），成功则回填正文区并重新提交索引；失败标记 `fetch_failed: true`（正文区留链接说明），不阻塞、可日后手动/定时重试；
4. 落盘后入 jobs 队列（票据 12）；微信公众号等公开文章链接服务器可直接抓取。

## 3. 客户端约定

**浏览器扩展（自研，Manifest V3，Chrome/Edge）**：
- 工具栏图标 → 弹窗：Readability 提取当前页标题/正文 → 预览（可补标签）→ 确认发送；
- 令牌存扩展本地存储，目标地址为 tailnet IP（配置页可改）；
- 失败处理：发送失败存入 `chrome.storage.local` 队列，弹窗/启动时自动重试，成功清除，队列数在图标角标提示。

**Android（HTTP Shortcuts，零代码）**：
- 系统分享菜单 → 分享 URL/文本到 HTTP Shortcuts 小组件 → POST 上述接口（`source: android`；分享文本为 `note`，分享链接为 `clip` 仅 URL）；
- 配置内置 2 次重试；失败时 Shortcuts 弹错误通知，可手动重发；
- 前置：Tailscale 常开（Android 客户端可设始终连接）。

**微信读书同步**：走票据 15 的同步任务，服务端内部直接落盘（同接口契约，`source: weread`）。

**微信内容（MVP 降级方案）**：公众号文章在手机浏览器打开 → 分享 URL 给 Shortcuts → 服务器抓公开链接；微信会话里的文字灵感 → 复制后用 Shortcuts 发纯文本（`type: note`）。

## 4. 不做的事（MVP 边界）

- 不做企业微信自建应用（捕获与推送均不做；周报/通知先靠打开 Web 界面，雾区跟踪）；
- 不做登录/多用户（单用户 + 渠道令牌）；
- 不做限流（Tailscale 内网只有自己）；
- 服务器抓取不执行 JS、不处理需登录页面（此类由浏览器扩展端内提取覆盖）。
