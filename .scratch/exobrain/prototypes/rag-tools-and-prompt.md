# 检索工具契约与代理指令草稿（票据 11 工件）

2026-09-06。原型验证结果见票据 11 Answer。

## 1. 原生知识工具契约（ybrain 内注册给代理的工具）

### `search_knowledge`

语义检索个人知识库。代理回答任何关于"我以前看过/记过什么"的问题前必须先调用。

```ts
// 入参
{
  query: string;          // 自然语言问题或主题，原样传入即可
  k?: number;             // 返回条数，默认 5
  include_archived?: boolean; // 默认 true（存档照常可检索）
}
// 返回
Array<{
  note_id: string;        // 笔记稳定 id
  title: string;
  path: string;           // vault 内相对路径（PARA 位置可见）
  url: string | null;     // 剪藏原始链接，回答引用出处用
  status: "inbox" | "distilled" | "archived";
  snippet: string;        // 命中的分块文本（约 300–500 字）
  vector_score: number;   // 粗取余弦分（调试用）
  rerank_score: number;   // 重排相关性分 0–1，**低于 0.1 视为不可靠**
}>
```

内部流程：bge-m3 嵌入 query → sqlite-vec 粗取 top 8 → bge-reranker-v2-m3 精排 → 返回 top k。

### `get_note`

```ts
// 入参：{ note_id?: string; path?: string }
// 返回：{ frontmatter: {...}, body: string }  // 笔记全文（含原文区）
```
检索到片段但需要完整上下文（原文细节、完整要点）时调用。

### `list_inbox`

```ts
// 无入参；返回 0-Inbox/ 下全部笔记：[{ note_id, title, type, source, created, path }]
```
提炼任务与"我有什么没处理的"类问题使用。

### `save_note`

```ts
// 入参
{
  note_id?: string;       // 提供=更新已有笔记；省略=新建（自动生成 id 与文件名）
  title?: string;
  para_folder?: "1-Projects" | "2-Areas" | "3-Resources" | "4-Archive"; // 移动位置
  frontmatter_patch?: object;  // 摘要/标签/related/status 等字段增量更新
  body?: string;          // 完整正文（提炼区）；原文区由系统保留，代理不触碰
}
// 返回：{ note_id, path }
```
提炼写回、归档、知识卡片落盘都走它。**代理不直接写文件系统**，frontmatter 与原文区的完整性由工具保证。

## 2. 代理系统指令草稿（ybrain 的 AGENTS.md / 系统规则）

```
你是我的外脑（ybrain），管理我个人的 Markdown 知识库。回答与处理知识时遵守：

【回答规则】
1. 回答关于我知识库的问题前，必须先调用 search_knowledge；片段不够时用 get_note 读全文。
2. 只依据检索结果和笔记原文回答，不要编造我没有记录过的内容。
3. 每条事实性结论都要给出处：笔记标题 + 原始链接（url 为空时给 vault 路径）。
4. 若 top 结果 rerank_score 全部低于 0.1，或检索内容无法支撑问题，直接说
   "我的资料里没有可靠依据"，并说明缺什么、建议我捕获什么。不要硬答。
5. 存档（4-Archive）笔记与其他笔记同等对待，命中就引用。

【提炼规则】（处理 list_inbox 中的笔记时）
1. 读原文 → search_knowledge 找 2–3 条相关旧笔记 → 写摘要（一句话）、3–5 个标签、
   要点卡片，并用 related 字段双链到相关笔记。
2. PARA 归类：有明确截止目标→1-Projects；长期责任/兴趣→2-Areas；待用素材→3-Resources。
   不确定时放 3-Resources，并在结果里说明，由我调整。
3. 微信读书书摘（type: weread）：把值得沉淀的单条划线拆成 type: card 新笔记，
   并双链回书摘；书摘本身归入 3-Resources。
4. 写回一律用 save_note，不要自己改写 frontmatter 或删除原文区。
5. 我的个人批注区（"## 个人批注"）留空，不要代写。

【语气】简洁、直接、像我自己的笔记；中文回答。
```

## 3. 原型验证中确定的工程参数

| 参数 | 取值 | 依据 |
| --- | --- | --- |
| 嵌入模型 | bge-m3，1024 维 | 原型实测 |
| 分块 | 按 Markdown 标题切段；超长段按中文句末标点贪心聚合，目标 400 字、上限 600、重叠约 50 字 | 原型切出 9 块/4 篇，粒度合适 |
| 索引范围 | 提炼区（`## 原文` 之前）；收件箱笔记索引全文 | 原文区不进向量库，需要时 get_note 读 |
| 粗取/精排 | 粗取 top 8 → 重排 top k（默认 5） | 原型实测重排能把粗取噪声（0.49）压到 0.05 以下 |
| 可靠性阈值 | rerank_score < 0.1 视为"资料不足" | 原型中无对应资料的问题重排分均 ≤ 0.09 |
| 索引对账 | 以 note_id 为准：文件移动/改名后先删旧 chunks 再插新 chunks | 原型暴露：同一笔记收件箱态与提炼态被重复索引 |
