# 19 任务：捕获接口与收件箱落盘

Type: task
Status: open
Blocked by: 17

## 做什么

在 ybrain 进程内起 Bun.serve（8787，仅 Tailscale 网卡）：
1. `POST /capture`：Bearer 渠道令牌（web/android/weread 三个，.env 配置）；
2. 按票据 10 规范写 `0-Inbox/` Markdown（frontmatter + 正文），返回 note_id/path；
3. body 缺失但有 url 时服务器抓取正文（Readability 类提取，TS 实现），失败标记 `fetch_failed` 落"仅链接"笔记；
4. 永远先落盘再返回；落盘后写 jobs 队列表（queued）。

依据：[capture-api.md](../prototypes/capture-api.md)、[data-model.md](../prototypes/data-model.md)。

## 验收

curl 模拟三渠道请求，笔记正确落盘；错误令牌 401；无 url 无 body 返回 400。
