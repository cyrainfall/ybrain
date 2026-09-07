# 22 任务：数据层（frontmatter/SQLite/向量嵌入）

Type: task
Status: open
Blocked by: 17

## 做什么

在 `packages/ybrain/` 实现（Bun/TS）：
1. vault 读写：frontmatter 解析/序列化（按票据 10 字段表）、文件命名与 PARA 移动、原文区保留；
2. SQLite（bun:sqlite）+ sqlite-vec：notes / chunks / vec_chunks（1024 维）/ jobs 四表；
3. 分块器：按 Markdown 标题切段 + 中文句末标点贪心聚合（目标 400/上限 600/重叠 50），只取提炼区；
4. 嵌入：SiliconFlow bge-m3（批量）；重排：bge-reranker-v2-m3；
5. 文件变更监听 → 按 note_id 删旧 chunks 再嵌入新 chunks；`ybrain reindex` 全量重建命令。

逻辑照搬已验证原型：[search_demo.py](../prototypes/rag-prototype/search_demo.py)。

## 验收

对 prototypes/vault 示例库 reindex 后，检索四个演示提问结果与 Python 原型一致（命中、重排分、阈值判断）。
