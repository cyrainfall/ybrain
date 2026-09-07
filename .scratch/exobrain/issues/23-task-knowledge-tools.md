# 23 任务：四个原生知识工具注册

Type: task
Status: open
Blocked by: 22

## 做什么

在 ybrain fork 中注册为 opencode 原生工具（代理可调用）：
1. `search_knowledge(query, k?, include_archived?)`：粗取 top8 → 重排 → 返回 top k（含 note_id/title/path/url/status/snippet/分数）；rerank<0.1 由代理指令判"无依据"；
2. `get_note(note_id?|path?)`：返回 frontmatter + 全文；
3. `list_inbox()`：0-Inbox 全部笔记摘要；
4. `save_note(...)`：新建/更新笔记、PARA 移动、frontmatter 增量、原文区系统保留；
5. 加载代理系统指令（AGENTS.md，回答规则 + 提炼规则，见 rag-tools-and-prompt.md）。

依据：[rag-tools-and-prompt.md](../prototypes/rag-tools-and-prompt.md)。

## 验收

Web 界面中代理能调用工具回答：有依据的问题给出处；无依据问题答"资料里没有可靠依据"；归档笔记可命中（验收 D1–D3）。
