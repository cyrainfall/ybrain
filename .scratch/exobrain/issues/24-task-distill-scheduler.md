# 24 任务：提炼队列、distiller 会话与周复盘

Type: task
Status: open
Blocked by: 23

## 做什么

1. jobs 队列调度：单并发领取 queued；状态机 running→done/failed（重试 ≤2，退避 1min/10min）→dead（收件箱标红）；重启把 running 重置 queued；幂等（提炼前查 status）；10 分钟超时；
2. 进程内创建隔离代理会话（身份 ybrain-distiller）跑提炼流程：读原文→search_knowledge 5 条→摘要/标签/要点/双链/归类→save_note（weread 拆卡逻辑预留但 MVP 不启用）；
3. 捕获落盘即入队、随到随做；
4. 每周日晚周复盘会话：本周新增概览、归档建议、Gitee 最近推送时间、dead 任务数；
5. distiller 系统指令加一句"识别用户抱怨/愿望→写 `0-Inbox/feedback/`（kind: feedback）"（为票据 27 自我改进回路预留入口；MVP 只做识别和落盘，不做 propose/apply）；
6. 归类存疑在笔记顶部标注"待确认"不阻塞；批注区留白。

依据：[distill-workflow.md](../prototypes/distill-workflow.md)。

## 验收

验收 C1–C5（几分钟内完成提炼并移动、失败重试与标红、停服期间内容恢复后补处理且不重复）、E3（周复盘产出）。
