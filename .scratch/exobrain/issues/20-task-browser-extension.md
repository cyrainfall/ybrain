# 20 任务：浏览器剪藏扩展（Manifest V3）

Type: task
Status: open
Blocked by: 19

## 做什么

自研 Chrome/Edge 扩展（`extensions/clipper/`）：
1. 工具栏图标弹窗：Mozilla Readability（端内）提取当前页标题/作者/正文 → 预览（可补标签）→ 确认 POST；
2. 配置页：tailnet 地址 + web 渠道令牌存 chrome.storage；
3. 失败队列：发送失败存本地，弹窗/启动自动重试，图标角标显示积压数。

依据：[capture-api.md](../prototypes/capture-api.md) 客户端约定。

## 验收

验收 B1（普通文章 10 秒内入收件箱、正文完整）、B2（公众号文章）、B5（断网排队恢复后补发）。
