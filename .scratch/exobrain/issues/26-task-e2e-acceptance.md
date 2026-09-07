# 26 任务：端到端验收与恢复演练

Type: task
Status: open
Blocked by: 18, 20, 21, 24, 25

## 做什么

按 [mvp-acceptance.md](../prototypes/mvp-acceptance.md) 逐条实测勾验：

- A 访问组网（A1–A3）；B 捕获（B1–B5）；C 自动提炼（C1–C5）；D 问答（D1–D3）；E Mac 浏览与备份（E1–E3）；F 资源稳定（72 小时不 OOM、日志轮转）；
- 恢复演练：按 backup-plan.md 七步在干净环境（或重置容器/数据）走完全流程，reindex 后检索到旧笔记；
- 产出验收报告（每条通过/问题记录），未过项开修复任务。

## 验收

清单 A–F 全部勾选；恢复演练成功。此后 MVP 正式可用，进入增量阶段（微信读书同步为第一个增量）。
