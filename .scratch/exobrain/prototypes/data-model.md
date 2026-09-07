# 数据模型规范（v0 草案，供本人过目反应）

2026-09-06，票据 10 工件。配套示例见 [vault/](vault/) 目录。

## 1. 目录结构（PARA 用文件夹表达）

```
vault/
├── 0-Inbox/            # 收件箱：所有捕获先落这里，status: inbox
├── 1-Projects/         # 项目：有明确目标/截止的短期努力（如：外脑MVP、装修）
│   └── 外脑MVP/         #   一个项目一个子文件夹，可放多篇笔记
├── 2-Areas/            # 领域：长期维护的责任与兴趣（如：健康、投资、前端）
├── 3-Resources/        # 资源：未来可能有用的素材（剪藏、书摘、教程）
├── 4-Archive/          # 存档：完成/失活内容的“时间胶囊”
│   └── 外脑MVP/         #   项目完成后整个子文件夹移入，内部结构不变
└── _index/             # 代理生成的索引页（MOC，地图式笔记，可选）
```

**为什么 PARA 用文件夹而不是纯标签**：文件夹给出唯一物理位置（代理归档 = 一次 `git mv`），Obsidian 文件树直观；标签负责文件夹之内的主题维度（如 `#威科夫` 可以同时贴在领域和资源笔记上）。文件夹是"放哪"，标签是"关于什么"，两者正交。

**存档怎么用**：归档 = 移动到 `4-Archive/`，**不删除、不改标签**。日常浏览永远看不到它，但语义检索（`search_knowledge` 工具）照常命中——这就是"时间胶囊靠检索而非分类唤醒"。

## 2. Frontmatter 字段表

每条笔记一个 .md 文件，头部 YAML 元数据，Obsidian 原生识别。

| 字段 | 必填 | 取值/格式 | 说明 |
| --- | --- | --- | --- |
| `id` | ✅ | `YYYYMMDDHHmm-xxxx`（时间戳+4位随机） | 稳定唯一标识；文件移动/改名不变；SQLite 索引靠它关联向量分块 |
| `title` | ✅ | 字符串 | 网页用文章标题，速记用首句或代理补题 |
| `type` | ✅ | `clip` / `note` / `weread` / `card` | clip=网页剪藏；note=速记/手写；weread=微信读书书摘；card=代理生成的知识卡片 |
| `source` | ✅ | `web` / `android` / `weread` / `manual` / `agent` | 捕获渠道 |
| `url` | 剪藏必填 | URL | 原始链接，回答引用出处用 |
| `author` | 可选 | 字符串 | 原文作者 |
| `created` | ✅ | ISO 8601 带时区 | 笔记创建时间（捕获时刻） |
| `status` | ✅ | `inbox` / `distilled` / `archived` | 处理状态，见状态机 |
| `tags` | 可选 | YAML 列表 | 主题标签，Obsidian 标签体系；提炼前为空，由代理补 |
| `summary` | 可选 | 一句话 | 代理提炼产出 |
| `related` | 可选 | `[[笔记标题]]` 列表 | 代理发现的相关笔记连接（Obsidian 双链） |
| `distilled_at` | 可选 | ISO 时间 | 提炼完成时间（溯源） |
| `distill_model` | 可选 | 字符串 | 提炼用的模型（如 `deepseek-v4-flash`） |
| `book` | weread 必填 | 字符串 | 书名（微信读书专用字段） |
| `chapter` | 可选 | 字符串 | 划线所在章节 |

## 3. 状态机

```
捕获落地                 代理提炼完成              项目结束/失活
0-Inbox/  ──────────►  1/2/3-PARA 文件夹  ──────►  4-Archive/
status: inbox          status: distilled          status: archived
   │                       ▲   │
   │ 提炼失败/代理挂了      │   └──────────────┐
   └─────► 留在收件箱，     │              需要时可“复活”
           任务表里重试     └──────────────┘
```

- **inbox → distilled**：代理完成提炼（写摘要/标签/要点、移动文件到 PARA 位置）后原子翻转；提炼失败文件**原样留在收件箱**，任务队列记录失败、稍后重试——收件箱是唯一的"未处理"真相源；
- **distilled → archived**：项目完成或内容失活时移动（代理周复盘可建议，本人确认）；
- **archived → distilled**：检索重新激活时移回（如旧项目重启）。
- "提炼中"这个瞬态不写进笔记状态，由 SQLite 任务表（jobs）记录。

## 4. 文件命名

`YYYYMMDDHHmm-<英文或拼音slug>.md`，如 `202609061032-build-exobrain.md`。

- 时间戳前缀即天然 id 前缀，Obsidian 文件列表按时间排序；
- slug 仅为可读性，**`id` 字段才是身份**——改名/移动不影响索引（索引定期扫描 vault 按 id 对账）。

## 5. SQLite 侧结构（data/index.db，票据 11 细化）

笔记是文件（真相源），SQLite 只是检索加速层，随时可从 vault 重建：

- `notes`：id、路径、标题、type、status、tags、文件哈希、mtime；
- `chunks`：分块 id、所属笔记 id、序号、文本、嵌入模型名、嵌入时间；
- `vec_chunks`：sqlite-vec 虚拟表（1024 维，bge-m3）；
- `jobs`：任务 id、笔记 id、类型（distill/sync）、状态（queued/running/done/failed）、重试次数、错误信息。

## 6. 正文结构约定（提炼后）

```markdown
（正文：摘要 + 要点卡片 + 个人批注，代理写）

## 相关
- [[另一篇笔记]]

---

## 原文
（剪藏/书摘的原始内容完整保留，永不删除）
```

原文与提炼同文件保留：单文件即一条知识的完整档案，Git 历史可回滚，Obsidian 里折叠"原文"区即可清爽阅读。
