# 10 设计：笔记数据模型与 PARA 落地

Type: prototype
Status: open
Blocked by: 06

## Question

在架构决策（06）确定的底座上，产出一个具体可反应的数据模型工件：

1. **笔记单元的形态**：一条笔记/一篇剪藏的文件或记录结构——Markdown 正文 + 头部元数据（frontmatter）字段设计：来源渠道、原始链接、捕获时间、标题、标签、PARA 分类（项目/领域/资源/存档）、处理状态（收件箱/已提炼/已归档）；
2. **PARA 落地方式**：文件夹、标签还是元数据字段表达 PARA；"存档"作为时间胶囊如何靠检索而非分类来用；
3. **收件箱到知识库的状态流转**：捕获 → 提炼中 → 已提炼 → （可选）归档的状态机；
4. **产出工件**：一个真实的示例笔记文件（用一篇示例文章走完全流程）、元数据字段说明表、目录结构树。

工件要粗糙但具体，用于和本人确认"笔记到底长什么样"。

## Answer

2026-09-06 产出工件并经本人确认三项关键抉择。

**工件位置**：[prototypes/data-model.md](../prototypes/data-model.md)（规范）+ [prototypes/vault/](../prototypes/vault/)（四篇示例：剪藏收件箱原文态、同篇提炼后态、安卓速记、微信读书书摘）。

**已确认的数据模型**：

1. **PARA 落地**：`0-Inbox / 1-Projects / 2-Areas / 3-Resources / 4-Archive` 五个文件夹表达位置（项目可建子文件夹），标签表达主题，两者正交；归档 = 移入 4-Archive，不改标签、检索照常命中；
2. **笔记形态**：单 Markdown 文件 = YAML frontmatter（id/title/type/source/url/created/status/tags/summary/related/distilled_* 等，字段表见规范文档）+ 正文；`id`（时间戳+随机后缀）为稳定身份，文件改名/移动不影响索引；
3. **原文保留**：剪藏/书摘原文在提炼后**同文件底部 `## 原文` 区完整保留**，向量分块只取正文区；单文件即完整档案；
4. **状态机**：inbox（留 0-Inbox）→ distilled（代理提炼后移入 PARA 文件夹并原子翻转）→ archived（移入 4-Archive，可复活）；"提炼中"瞬态只记在 SQLite jobs 表；提炼失败原文留收件箱、任务重试；
5. **书摘粒度**：微信读书每次同步按"书+日期"聚合成一篇 weread 笔记进收件箱；代理提炼时把值得沉淀的划线拆成独立 `type: card` 知识卡片并双链回书摘；
6. **SQLite 加速层**：notes / chunks / vec_chunks（sqlite-vec，1024 维 bge-m3）/ jobs 四张表，可从 vault 完整重建（文件是真相源）。细节归票据 11。
