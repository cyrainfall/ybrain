# 21 任务：Android HTTP Shortcuts 配置

Type: task
Status: open
Blocked by: 19

## 做什么

零代码配置（产出一份照做文档）：
1. HTTP Shortcuts 建"发到外脑"快捷方式：POST `http://<tailnet-ip>:8787/capture`，Bearer android 令牌；
2. 接系统分享菜单：分享文本 → type: note；分享链接 → type: clip 仅 URL；
3. 配置 2 次重试 + 失败通知；桌面放速记小部件；
4. Tailscale 设始终连接。

## 验收

验收 B3（分享文字 10 秒内入收件箱）、B4（分享链接服务器抓正文或落仅链接笔记）。
