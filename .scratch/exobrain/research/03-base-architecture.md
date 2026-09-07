# 外脑系统底座架构调研：笔记捕获层 + 检索增强生成（RAG）层选型

> 调研日期：2026-09-05
> 目标环境：阿里云中国大陆服务器，约 2 核中央处理器（CPU）、4 GB 内存（RAM），Docker 部署
> 建设方式：混合模式——存储/底座用成熟开源项目，捕获入口与人工智能（AI）工作流自研
> 核心约束：数据归属优先，笔记内容尽量保持为普通工具可读的文件（Markdown 优先），避免被单一软件锁死
>
> 术语约定：本文首次出现的技术缩写均写全称。RAG = Retrieval-Augmented Generation，检索增强生成；API = Application Programming Interface，应用程序接口；HTTP = HyperText Transfer Protocol，超文本传输协议；LLM = Large Language Model，大语言模型；SDK = Software Development Kit，软件开发工具包。

---

## 0. 结论速览（TL;DR）

- **4 GB 内存是硬约束**：RAGFlow（官方要求 16 GB）、网易有道 QAnything（官方要求 20 GB，且项目已停更）在这台服务器上**直接排除**；Dify（官方最低 4 GB、实际推荐 8 GB）、FastGPT / MaxKB（官方测试档 2c4g、推荐 2c8g/4c8g）属于"能装但勉强，索引时容易触发内存不足（OOM）"。
- **笔记底座三选一的本质**：Memos（轻量速记、API 友好、数据在 SQLite 数据库）、TriliumNext（层次化深度笔记、数据在 SQLite 数据库）、纯 Markdown 文件库（零服务、零锁定、需要自建写入入口）。Joplin Server 定位是"多端同步后端"，不适合做程序化捕获入口。
- **最契合"数据归属 + 4 GB 服务器"的方案是自研轻量 RAG 管线**：向量用 sqlite-vec 或 Chroma（嵌入式、无独立进程），嵌入（embedding）与大语言模型走云端 OpenAI 兼容 API（如阿里 DashScope、硅基流动），整条管线只占约 0.3–0.6 GB 内存。
- **推荐组合**：① Markdown 文件库 + 自研管线（首推，数据可迁移性最高）；② Memos 速记入口 + 自研管线 + Markdown 长期库（捕获体验最好）；③ AnythingLLM 一体化 + 文件库兜底（自研量最小，平台层有一定锁定）。

---

## 一、笔记 / 捕获底座候选

### 1.1 Memos（usememos/memos）

**定位**：类 flomo / 私有微博式的轻量速记服务，Go 语言后端 + React 前端，MIT 许可，GitHub 约 4.6 万星（2026 年数据）。

| 维度 | 情况 |
|---|---|
| 内存 / CPU | 空闲约 50–80 MB（镜像内单 Go 二进制，部分实测约 30 MB）；CPU 占用可忽略，树莓派可跑；官方最低建议 256 MB 内存 |
| Docker 部署 | **单容器**，默认端口 5230，数据卷挂 `/var/opt/memos`；默认嵌入式 SQLite 数据库（单文件 `memos_prod.db`），也可选 PostgreSQL / MySQL |
| 开放写入 API | **有，且完善**：REST 风格 API（`/api/v1/`，如 `POST /api/v1/memos` 写笔记）+ gRPC；支持个人访问令牌；自带 Telegram 机器人入口 |
| 数据存储格式 | 笔记正文是 Markdown 文本，但**存储在 SQLite 数据库内，不是一个个 .md 文件**；附件存于数据目录；需通过 API / JSON 导出才能拿到文件 |
| 脱离软件读取 | 可以间接读取：SQLite 是开放格式，任何 sqlite 工具可查；但正文混在数据库表中，不是"打开文件夹就是笔记" |
| 中文社区 | **非常活跃**：核心团队为华人，中文教程（掘金等）数量多， issue 响应快 |
| 维护状态 | **活跃**，2026 年仍在高频发布（v0.26.x），镜像下载量数百万级 |

**优点**：捕获体验好（网页渐进式网页应用 PWA、手机浏览器加桌面、Telegram 机器人）；API 先行，自动化友好；资源占用极低。
**缺点**：短笔记流式组织（标签 + 时间线），不适合长文 / 层次化知识库；数据不是裸 Markdown 文件。

### 1.2 Trilium Notes（zadam/trilium → TriliumNext/Trilium）

**定位**：层次树形个人知识库，支持笔记克隆（一条笔记出现在多个位置）、关系图、内置脚本引擎。

**重要变更**：原作者 zadam 于 **2024 年 1 月将项目转入维护模式（maintenance mode）**；社区 fork 出 **TriliumNext** 继续开发，后经协商原仓库已移交 TriliumNext 团队。旧仓库 `TriliumNext/Notes` 在发布 v0.95.0（2025-06）后归档，开发迁移至单仓库（monorepo）**github.com/TriliumNext/Trilium**，2026 年仍在发布新版本（文档站 triliumnotes.org，已到 v0.104+）。**新部署应直接使用 TriliumNext 镜像**，与旧数据库完全兼容、无需迁移步骤。

| 维度 | 情况 |
|---|---|
| 内存 / CPU | Node.js 应用，空闲约 100 MB、日常 150–300 MB；官方最低 512 MB（建议 1 GB）；大库导入导出时内存可冲到约 2 GB |
| Docker 部署 | **单容器**（镜像 `triliumnext/notes`），端口 8080，单数据卷；内嵌 SQLite（`document.db`），无外部依赖；自带每日备份 |
| 开放写入 API | **有**：REST API + ETAPI（专用令牌的外部自动化 API），另有网页剪藏（Web Clipper）浏览器插件 |
| 数据存储格式 | SQLite 单库；**笔记内部主格式是 HTML（富文本）**，支持 Markdown / OPML / HTML 导入导出（Markdown 导出"大部分格式保留"） |
| 脱离软件读取 | SQLite 开放格式可查，但正文为 HTML；要拿 Markdown 需走导出；内置"受保护笔记"是加密的 |
| 中文社区 | 中等：有中文界面和教程，用户量少于 Memos / Joplin，fork 后社区以英文为主 |
| 维护状态 | TriliumNext **活跃**（2026 年持续发版），但属于小团队社区维护，节奏比商业 backing 的项目慢 |

**优点**：知识库表达能力最强（树形 + 克隆 + 属性 + 脚本），单容器自带同步服务端；新版本还实验性内置了向量搜索 / AI 助手。
**缺点**：Node.js 内存占用比 Memos 高一个量级；数据格式是 HTML 数据库，"纯文件可读"这一点不满足；大操作有内存尖峰。

### 1.3 Joplin Server（laurent22/joplin）

**定位**：Joplin 笔记客户端（桌面 / iOS / 安卓全平台）的**自托管同步后端**，替代 Dropbox / OneDrive 同步。

| 维度 | 情况 |
|---|---|
| 内存 / CPU | Node.js 应用，空闲约 150 MB、同步高峰 300–500 MB（不含数据库）；第三方实测最低 1 GB 内存可跑；官方商业版文档按多用户写 4 GB 最低 / 8 GB 推荐；镜像约 2 GB |
| Docker 部署 | 应用容器 + **PostgreSQL**（生产推荐；SQLite 仅供测试），Docker Compose 两容器；端口 22300 |
| 开放写入 API | 有 HTTP API，但它是**同步协议 API**（面向客户端同步的"数据项"接口），不是为"程序直接写一篇笔记"设计的，自动化写入体验差（更顺的路径是用桌面端的 Web Clipper 服务接口） |
| 数据存储格式 | 笔记以序列化数据项存于 PostgreSQL；可选端到端加密（E2EE），开启后服务端只存密文；**服务端上没有任何可读文件** |
| 脱离软件读取 | 不能直接读；需在客户端导出 Markdown |
| 中文社区 | Joplin 整体中文用户基数大、教程多；但**自托管 Server 的讨论较少**（多数人用对象存储 / WebDAV 同步） |
| 维护状态 | **非常活跃**，客户端 + 服务端持续发版（3.x） |

**优点**：客户端生态最成熟（全平台、Web 剪藏、端到端加密、150+ 插件）。
**缺点**：对本项目目标错位——它是"同步盘"不是"捕获/写入后端"；程序写入别扭；数据锁在 PostgreSQL 同步项里；还要拖一个 PostgreSQL 容器。**不推荐作为外脑捕获底座**，除非你已经是 Joplin 重度用户。

### 1.4 基线选项：纯 Markdown 文件库（PARA 文件夹 + Obsidian + Git / Syncthing）

**形态**：不部署任何笔记服务。知识库就是一个文件夹，里面是 `.md` 文件（YAML frontmatter 写元数据），按 PARA 方法（Projects 项目 / Areas 领域 / Resources 资源 / Archives 归档）组织；Obsidian 直接打开该文件夹（Obsidian 不改造文件格式，文件永远是普通 Markdown）；多端同步用 Syncthing（点对点、免费、无服务器）或 Git（自带版本历史）。

| 维度 | 情况 |
|---|---|
| 内存 / CPU | **零**（没有服务进程；同步用 Syncthing 时约 30–80 MB） |
| Docker 部署 | 不需要；若要网页捕获入口，自研一个极小的 Webhook 写入服务（FastAPI，约 100–200 MB） |
| 开放写入 API | 无现成 API——**文件系统即接口**：任何程序能写文件就能入库（这也是优点：不依赖任何软件的 API 稳定性） |
| 数据存储格式 | **纯 .md 文件 + 附件文件夹**，人类可读、grep 可搜、任何编辑器可开 |
| 脱离软件读取 | **完全可以**，Obsidian 只是可选查看器；卸载所有软件数据照样可用 |
| 中文社区 | Obsidian 中文社区极大，PARA / Zettelkasten 方法论中文资料丰富 |
| 维护状态 | 无单一软件可"停更"；风险分散在工具链各环节 |

**优点**：数据归属的天花板形态；备份 = 复制文件夹；RAG 管线直接读文件，无需对接任何 API；Git 给全文版本历史；Syncthing 给多端实时同步。
**缺点**：没有现成的网页 / 微信 / 手机分享入口，**捕获入口必须自研**（Webhook、Telegram/微信机器人、iOS 快捷指令）；没有自带用户认证与多用户；全文检索靠 Obsidian / ripgrep，语义检索要靠后面自建的 RAG 层；需要一定的文件夹纪律。

### 1.5 笔记底座对比总表

| 项目 | 典型内存 | 容器数 | 写入 API | 数据形态 | 脱软件可读 | 中文社区 | 维护 |
|---|---|---|---|---|---|---|---|
| Memos | 50–80 MB | 1 | REST + gRPC，完善 | SQLite 库（Markdown 正文） | 间接（sqlite 可查） | 很活跃 | 活跃 |
| TriliumNext | 150–300 MB | 1 | REST + ETAPI | SQLite 库（HTML 正文） | 间接（导出为 MD） | 中等 | 活跃（社区 fork） |
| Joplin Server | 400–700 MB（含 PG） | 2 | 同步 API，不适合程序写入 | PostgreSQL 同步项 | 否 | 大（Server 讨论少） | 活跃 |
| Markdown 文件库 | 0（+同步工具几十 MB） | 0 | 文件系统即接口 | **纯 .md 文件** | **完全可读** | 很大 | 无单点 |

---

## 二、RAG 能力实现路径

> 共同前提：嵌入模型和大语言模型都走**云端 OpenAI 兼容 API**（阿里云 DashScope `text-embedding-v3`、硅基流动托管的 bge-m3 等中文嵌入模型；聊天 / 提炼用 DeepSeek、通义千问等），**不在 2c4g 服务器上跑本地模型**——这是内存能否够用的决定性因素。本地跑一个 7B 模型至少要 8 GB 内存 / 显存，本服务器不考虑。

### 2.1 自研轻量管线：sqlite-vec / Chroma + Python

**架构**：捕获 → 清洗 / 切片（chunking）→ 调用嵌入 API 向量化 → 存入嵌入式向量库 → 查询时结构化查询语言（SQL）全文检索（SQLite FTS5，BM25 关键词算法）+ 向量语义检索混合召回 → （可选）重排（rerank）API → 拼上下文调大语言模型生成答案。提炼工作流（自动摘要 / 自动标签）是同一套管线的离线任务。

- **sqlite-vec**（asg017/sqlite-vec，sqlite-vss 的继任者）：SQLite 的向量搜索扩展，纯 C 无依赖，**零独立进程**，向量和业务数据在同一个 .db 文件；暴力扫描式 k 近邻（KNN），个人知识库（几千到几万切片）完全够用（万级向量查询毫秒级）；目前版本号未到 1.0，接口可能微调。
- **Chroma**：Python 优先的嵌入式向量库，进程内运行、无需起服务（也可选服务端模式），API 体验最好、元数据过滤方便；内存索引型，约百万向量以内且内存放得下时表现好；再大可选 LanceDB（AnythingLLM 默认向量库，基于磁盘列式格式）。
- **编排层**：直接用 OpenAI 兼容 SDK（最省依赖、最稳），或用 LangChain / LlamaIndex 做脚手架（功能全但版本迭代快、抽象层厚，个人项目建议轻用或不用）。

| 维度 | 情况 |
|---|---|
| 最低内存 | **约 0.3–0.6 GB**（Python 进程 150–400 MB + 向量库内嵌几乎无额外开销）；若改跑本地嵌入模型再加 0.5–1 GB |
| Compose 复杂度 | **1 个自研容器**，无其他组件（向量库是库不是服务） |
| 80/443 端口 | 不占用，内部端口即可 |
| API | 自己定义，天然为"捕获→提炼→问答"量身定做 |
| 数据存储 | Markdown 文件仍是事实来源（source of truth）；向量索引是可随时重建的派生 .db 文件 |
| 中文检索口碑 | 取决于嵌入模型选型；bge-m3 / text-embedding-v3 中文效果公认好；混合检索 + 重排可进一步兜底 |
| 维护状态 | sqlite-vec / Chroma / LangChain / LlamaIndex 均活跃；自有代码自主可控 |

### 2.2 Dify（langgenius/dify）

可视化 AI 应用 / 智能体（Agent）编排平台，中国团队（LangGenius），GitHub 超 13 万星，Apache-2.0（附加少量商业限制条款）。

| 维度 | 情况 |
|---|---|
| 最低内存 | 官方文档：**2 核 / 4 GiB 为最低线，实际推荐 8 GB**；2026 年版 Compose 启动 7 个核心服务 + 8 个依赖组件（api、worker、web、plugin_daemon、PostgreSQL、Redis、Weaviate、Nginx、沙箱 sandbox、SSRF 代理等共约 15 个容器） |
| 内存实测 | 空闲基线约 1.5–2.5 GB（Weaviate 向量库是最大头）；文档索引 / 多并发时明显上涨，4 GB 机器上易发生容器反复重启 |
| Compose 复杂度 | 高（官方 Compose 一把拉起，但组件多、升级要跟数据库迁移） |
| 80/443 | **默认 Nginx 占用 80/443** |
| API | 强：每个应用自动暴露 REST API，还提供 OpenAI 兼容端点 |
| 数据存储 | PostgreSQL + 向量库（默认 Weaviate，可换 pgvector / Qdrant / Milvus / Chroma）；文档入库后归平台管 |
| 中文检索 | 中文界面 / 文档一流，支持混合检索、重排、可调切片；效果靠调参 |
| 维护 | 非常活跃（2026 年 v1.14.x） |

**4 GB 判定**：勉强能装（换 pgvector、砍沙箱可省一些），但和笔记服务同机共存后基本没有余量，索引任务一跑就可能 OOM。**建议等服务器升到 8 GB 再考虑。**

### 2.3 RAGFlow（infiniflow/ragflow）

以"深度文档理解"见长的 RAG 引擎（强 OCR 光学字符识别、PDF 版面 / 表格解析、切片可视化），中国团队，Apache-2.0。

| 维度 | 情况 |
|---|---|
| 最低内存 | 官方硬性前提：**CPU ≥ 4 核、内存 ≥ 16 GB、磁盘 ≥ 50 GB**，还需调 `vm.max_map_count`（Elasticsearch 要求） |
| 组件 | RAGFlow 服务 + Elasticsearch（或自研 Infinity）+ MySQL + MinIO 对象存储 + Redis；slim 镜像约 2 GB（不含嵌入模型）、full 镜像约 9 GB（内置 OCR / 嵌入模型） |
| 80/443 | 默认 Nginx 占 80 |
| API | 有 HTTP API（数据集管理、对话） |
| 数据存储 | Elasticsearch / Infinity + MySQL + MinIO，平台私有结构 |
| 中文检索 | **复杂中文文档（扫描件、表格、PDF）解析能力是开源第一梯队**；但对纯 Markdown 笔记属于杀鸡用牛刀 |
| 维护 | 非常活跃（2026 年 v0.26） |

**4 GB 判定**：**不可行**。仅 Elasticsearch 堆内存就要 1–2 GB 以上，slim 版现实也需 8 GB 起步。直接排除。

### 2.4 FastGPT（labring/FastGPT）

知识库 + 可视化工作流（Flow）平台，中国团队，OpenAPI 完整。

| 维度 | 情况 |
|---|---|
| 最低内存 | 官方部署文档：**PgVector 版测试最低 2c4g、推荐 2c8g**；Milvus 版测试最低 2c8g |
| 组件 | FastGPT 应用 + MongoDB（存非向量数据）+ PostgreSQL/pgvector（向量）+ AIProxy（模型聚合）；空闲实测约 1.2–2 GB，批量索引时更高 |
| 80/443 | 不占（默认端口 3000） |
| API | 完整 OpenAPI，可程序化建知识库 / 传文档 / 对话 |
| 数据存储 | MongoDB + pgvector，非文件 |
| 中文检索 | 中文原生项目，中文文档 / 社区好，原生适配 bge-zh 等中文嵌入模型 |
| 维护 | 活跃，2026 年持续发版 |

**4 GB 判定**：官方把 2c4g 列为"测试档（可把计算进程调小）"——个人小规模知识库**能跑但偏紧**，与笔记服务同机需精打细算（调小 worker 并发、加交换分区 swap）。

### 2.5 AnythingLLM（Mintplex-Labs/anything-llm）

"单容器私有 ChatGPT + 文档问答"应用，MIT 许可，定位个人 / 小团队开箱即用。

| 维度 | 情况 |
|---|---|
| 最低内存 | 官方：**2 GB 内存 / 2 核 CPU / 5 GB 磁盘**（前提是大语言模型与嵌入均走外部 API）；容器自身空闲约 0.3–0.7 GB |
| 组件 | **单容器**；默认向量库 LanceDB（嵌入式文件，无独立进程），也可换 Chroma / pgvector / Qdrant 等 |
| 80/443 | 不占（默认端口 3001） |
| API | 有开发者 API（文档上传、工作区对话均可程序化调用） |
| 数据存储 | 容器存储目录内：文档副本 + LanceDB 索引；可挂载卷持久化 |
| 中文检索 | 项目以英文社区为主；**默认内置嵌入模型是英文取向且 CPU 跑、较吃内存**，中文场景应配置外部中文嵌入 API（配置后中文问答可用）；2025 年曾披露提示词注入相关安全公告（CVE-2025-44822），对公网暴露需谨慎 |
| 维护 | 非常活跃，发版频繁 |

**4 GB 判定**：**可行且宽裕**，是平台型方案里唯一能与笔记服务轻松同机共存的。代价是检索 / 编排能力比 Dify / FastGPT 简单，中文效果靠自己配模型。

### 2.6 MaxKB（1Panel-dev/MaxKB）

飞致云（1Panel 团队）出品的开源企业级智能体 / 知识库问答平台，GPLv3 协议，中文原生。

| 维度 | 情况 |
|---|---|
| 最低内存 | 官方 v1 文档：**4C / 8 GB / 100 GB**；社区实践多写 2 核 4 GB 可跑小规模；一体化容器内捆绑 PostgreSQL（pgvector）+ Redis |
| 组件 | 单容器（all-in-one，内含数据库与 Redis）；默认下载 / 内置本地嵌入模型，索引阶段内存与 CPU 压力明显（也可改外部模型 API） |
| 80/443 | 不占（默认 8080） |
| API | 有，产品卖点之一就是"快速嵌入第三方业务系统" |
| 数据存储 | PostgreSQL（pgvector），非文件 |
| 中文检索 | 中文原生，文档与社区支持好 |
| 维护 | 非常活跃（2026 年 v2 系列） |

**4 GB 判定**：能跑（一键 `docker run` 是官方支持路径），但内置嵌入模型做向量计算时 2c4g 比较吃力，建议改外部嵌入 API 以降低内存压力；与笔记服务同机余量不大。

### 2.7 网易有道 QAnything（netease-youdao/QAnything）

- 官方前提：**内存 ≥ 20 GB**；GPU 版需 16 GB 显存（本地跑嵌入 / 重排 / 7B 大模型），即使用云端大语言模型 API，本地嵌入与重排模型仍需约 4 GB 显存。
- 组件重：Milvus + etcd + MinIO + MySQL + Elasticsearch（带 IK 中文分词插件）+ 前后端 + 本地模型。
- **维护状态：已实质停更**——最后一个版本 v2.0.0 发布于 **2024-08-23**，此后近两年无发版，399 个开放问题无人处理。
- **判定：双重排除**（4 GB 跑不动 + 项目停更）。仅作背景了解。

### 2.8 RAG 路径对比总表

| 方案 | 典型内存占用 | 组件数 | 默认占用 80/443 | 开放 API | 数据形态 | 中文口碑 | 维护 | 2c4g 可行性 |
|---|---|---|---|---|---|---|---|---|
| 自研管线（sqlite-vec/Chroma + Python，模型走 API） | 0.3–0.6 GB | 1 容器 | 否 | 自有 | .md 文件 + 可重建索引 | 靠模型选型，可控 | 自主 | ✅ 宽裕 |
| AnythingLLM | 0.5–1 GB | 1 容器 | 否（3001） | 有 | LanceDB 文件 + 文档副本 | 需自配中文嵌入 | 活跃 | ✅ 可行 |
| FastGPT（PgVector 版） | 1.2–2 GB | 4 个左右 | 否（3000） | 完整 OpenAPI | MongoDB + pgvector | 好（中文原生） | 活跃 | ⚠️ 勉强（官方测试档） |
| MaxKB | 2–3 GB（内置模型时） | 1 容器（内含 PG+Redis） | 否（8080） | 有 | pgvector | 好（中文原生） | 活跃 | ⚠️ 勉强 |
| Dify | 1.5–2.5 GB 空闲，峰值更高 | ~15 容器 | **是（80/443）** | 强 | PG + 向量库 | 好（中文原生） | 活跃 | ⚠️ 官方最低线，推荐 8 GB |
| RAGFlow | 8 GB+（官方 16 GB） | 5+ | 是（80） | 有 | ES/Infinity + MySQL + MinIO | 复杂文档最强 | 活跃 | ❌ 不可行 |
| QAnything | 官方 20 GB | 6+ + 本地模型 | 否（5052/8777） | 有 | Milvus + MySQL + ES | 好但已停更 | **停更（2024-08）** | ❌ 不可行 |

**与笔记底座的共存性**：Memos（~60 MB）、TriliumNext（~200 MB）、Markdown 文件库（~0）与自研管线 / AnythingLLM 同机完全无压力；FastGPT / MaxKB / Dify 上了之后，4 GB 机器基本被平台占满，笔记层只能选最轻的 Memos 或文件库，且索引高峰期仍有 OOM 风险；RAGFlow / QAnything 无共存可能。

---

## 三、推荐组合架构

### 组合 A（首推）：Markdown 文件库 + 自研轻量管线

```
[微信/Telegram 机器人、浏览器剪藏、iOS 快捷指令]
        │  HTTP Webhook（自研 FastAPI 服务）
        ▼
[Inbox/ 目录：纯 .md 文件] ──Syncthing──► 手机/电脑（Obsidian 直接打开）
        │                              └─ Git 版本备份
        ▼
[提炼 Worker：LLM API 生成摘要/标签 → 归入 PARA 目录]
        ▼
[索引：sqlite-vec 向量 + SQLite FTS5 全文（混合检索）]
        ▼
[问答 API / 简易网页：检索→重排(可选)→LLM 生成，附引用来源]
```

- **总内存估算**：Webhook + Worker + 问答服务约 0.4–0.7 GB；加系统与 Docker 开销后整机占用约 1.2–1.8 GB / 4 GB，余量充足。
- **自研工作量**：中高。需要写：① 捕获 Webhook 与各入口机器人（微信个人号机器人有封号风险，建议企业微信 / 公众号 / Telegram / iOS 快捷指令中转）；② 提炼与索引管线；③ 简单问答界面（或直接用 Open WebUI 之类接自己的 API）。
- **数据可迁移性**：**最高**。.md 文件是唯一事实来源，向量索引随时可删库重建；任何笔记软件（Obsidian / Logseq / VS Code）都能直接打开。
- **主要风险**：自研初期功能简陋；手机端微信捕获链路要打磨；需要自己维护切片 / 检索质量（好处是完全可控）。

### 组合 B：Memos 速记入口 + 自研管线 + Markdown 长期库

```
[手机 PWA / Telegram / 浏览器] ──► Memos 容器（5230，~60MB）
                                        │ 轮询 Memos REST API（或 webhook）
                                        ▼
                        [自研提炼 Worker：LLM 摘要/标签/去重]
                                        ▼
              长文/沉淀内容 ──► Markdown 文件库（PARA，Obsidian/Syncthing/Git）
                                        ▼
                        sqlite-vec + FTS5 混合索引 ──► 问答服务
```

- **总内存估算**：Memos 约 0.06 GB + 自研管线约 0.5 GB，整机约 1.2–1.7 GB，同样宽裕。
- **自研工作量**：中等。Memos 已经提供了成熟的多端捕获界面、Telegram 机器人和写入 API，省去入口开发；自研聚焦"Memos → 提炼 → 落盘成 .md → 索引"的同步管线。
- **数据可迁移性**：高。长期知识仍是 .md 文件；Memos 内的原始速记在 SQLite 库中（开放格式 + API 可全量导出 JSON，备份简单）。
- **主要风险**：两个存储层需要定义清楚分工（速记在 Memos、沉淀在文件库），同步管线要处理好幂等与重复；Memos 数据不是裸文件（但导出成本极低）。

### 组合 C（低代码兜底）：Markdown/Memos 捕获 + AnythingLLM 一体化问答

```
[捕获入口自研或 Memos] ──► 原始 .md 文件库（事实来源，Obsidian 可读）
                                │ 通过 AnythingLLM API 批量上传/同步文档
                                ▼
        AnythingLLM 单容器（3001，LanceDB 内嵌，模型全走外部 API）
                                ▼
                    内置聊天界面 + 开发者 API（问答/引用）
```

- **总内存估算**：AnythingLLM 约 0.5–1 GB + Memos 约 0.06 GB，整机约 1.8–2.5 GB，可行。
- **自研工作量**：**最低**。只需写捕获入口和"文件库 → AnythingLLM 文档同步"的薄适配；问答 UI、文档管理、引用展示全由平台提供。
- **数据可迁移性**：中。原始 .md 文件库仍是事实来源（务必保留），AnythingLLM 内的文档副本与 LanceDB 索引是派生物，平台更换时重新导入即可；但问答工作流、工作区配置不可迁移。
- **主要风险**：① 平台层锁定（缓解：文件库兜底）；② 中文检索质量必须显式配置中文嵌入 API，默认内置嵌入英文取向；③ 平台升级与安全公告需跟进（公网暴露要加访问控制）；④ 检索调优能力弱于自研 / Dify。若日后需求升级到复杂工作流，再迁 Dify（建议 8 GB 服务器）。

---

## 四、补充建议

1. **端口规划**：Dify / RAGFlow 默认抢占 80/443，其余项目均用自定义端口；建议统一用 Caddy / Nginx 反向代理按域名分流，自动申请 HTTPS 证书，避免端口冲突。
2. **嵌入模型选型**：中文场景优先 bge-m3（多语言、长文本）或阿里 `text-embedding-v3`；注意切片后向量维度与索引绑定，换模型需全量重建索引（自研管线重建成本低，这也是文件库方案的优势）。
3. **交换分区（swap）**：2c4g 机器建议加 2–4 GB swap，可显著降低索引批次任务的 OOM 概率。
4. **微信捕获合规性**：个人微信自动化机器人有封号风险，优先走 Telegram 机器人、企业微信应用消息、公众号或 iOS 快捷指令 + 自建 Webhook。
5. **后续升级路径**：数据层保持 Markdown 文件不动，未来服务器升到 8 GB 后可平滑引入 Dify / FastGPT 做更强的工作流，历史数据零迁移成本。

---

## 参考资料

**笔记 / 捕获底座**
- Memos 官方仓库与文档：https://github.com/usememos/memos ；https://www.usememos.com/docs
- Memos 自托管指南（资源占用、API、Docker Compose）：https://selfhosting.sh/apps/memos/
- TriliumNext 官方仓库与文档：https://github.com/TriliumNext/Trilium ；https://docs.triliumnotes.org/
- Trilium  fork 历史（原项目维护模式、仓库移交）：https://dosu.dev/customers/how-triliumnext-revitalized-an-abandoned-open-source-project-with-dosus-help
- Trilium 自托管指南（资源占用、ETAPI）：https://selfhosting.sh/apps/trilium/
- Joplin Server 官方说明（硬件要求、数据库）：https://joplinapp.org/help/apps/joplin_server_business/
- Joplin Server 仓库 README：https://github.com/laurent22/joplin/blob/dev/packages/server/README.md
- Joplin Server 自托管指南：https://selfhosting.sh/apps/joplin-server/
- PARA 方法论：https://fortelabs.com/blog/para/ ；Obsidian：https://obsidian.md/ ；Syncthing：https://syncthing.net/

**RAG 平台与向量库**
- 自研管线：sqlite-vec https://github.com/asg017/sqlite-vec ；Chroma https://docs.trychroma.com ；嵌入式向量库对比 https://dreaming.press/posts/sqlite-vec-vs-lancedb-vs-chroma-embedded-vector-store-solo-builder.html
- Dify 官方 Docker Compose 部署（硬件要求、容器清单）：https://docs.dify.ai/en/self-host/deploy/quick-start/docker-compose
- Dify 资源实测与避坑：https://bbs.csdn.net/weixin_28683689/article/details/100198865 ；https://joshuaopolko.com/dify-self-hosted-guide/
- RAGFlow 官方仓库（前提条件 CPU≥4 核 / RAM≥16 GB）：https://github.com/infiniflow/ragflow/blob/main/README_zh.md ；中文文档 https://ragflow.com.cn/docs
- FastGPT 官方部署文档（PgVector 版 2c4g 测试档）：https://doc.fastgpt.cn/zh-CN/self-host/deploy/docker
- AnythingLLM 官方系统要求（2 GB / 2 核）：https://docs.anythingllm.com/installation-docker/system-requirements ；仓库 https://github.com/Mintplex-Labs/anything-llm
- MaxKB 官方安装文档（4C/8GB）：https://maxkb.cn/docs/v1/installation/online_installtion/ ；仓库 https://github.com/1Panel-dev/MaxKB
- QAnything 官方仓库（RAM≥20 GB，最后版本 v2.0.0 / 2024-08-23）：https://github.com/netease-youdao/QAnything
