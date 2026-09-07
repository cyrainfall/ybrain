# 03 调研：开源笔记底座与 RAG 实现方案

Type: research
Status: resolved
Blocked by: 无

## Question

在 2 核 4G 服务器、Docker 部署、混合建设（开源底座 + 自研关键环节）的约束下，调研外脑系统的**底座形态**候选，为架构决策（06）提供事实依据。

需要对比的两大层面：

**一、笔记/捕获底座候选：**

- Memos（轻量级速记，Go 语言，SQLite 存储，API 优先）；
- Trilium（层次化笔记，功能重）；
- Joplin（同步导向的笔记）；
- 纯 Markdown 文件库（按 PARA 组织文件夹，可用 Obsidian 打开，Git 或同步盘管理）。

**二、检索增强生成（RAG，Retrieval-Augmented Generation）能力的实现路径：**

- 自研轻量管线：向量库可选 SQLite 扩展（sqlite-vec）、Chroma 等，配合 Python 的 LangChain/LlamaIndex 类框架；
- 开源 RAG 平台：Dify、RAGFlow、FastGPT、AnythingLLM、MaxKB、网易有道 QAnything 等。

每个候选给出：内存/CPU 占用（是否能在 4G 内存上与底座共存）、Docker 部署复杂度、是否提供开放 API 供自研捕获入口写入、数据存储格式（Markdown 文件还是私有数据库，能否脱离该软件读取）、中文社区活跃度、维护状态。

产出：对比表 + 2~3 个推荐组合架构（例如"Memos + 自研向量管线"、"Markdown 文件库 + 自研管线"、"某 RAG 平台一体化"），列出各自的取舍。注意中文写作，技术缩写首次出现写全称。

## Answer

研究报告全文：[research/03-base-architecture.md](../research/03-base-architecture.md)

结论（供 06 决策使用）：

- **4G 内存是硬门槛**：RAGFlow（要求 16G）、QAnything（要求 20G 且已停更）直接排除；Dify/FastGPT/MaxKB 实际推荐 8G，高峰期有内存溢出风险；
- **笔记底座**：Memos 最轻（约 60MB，接口完善，适合速记，但数据在 SQLite 而非裸文件）；TriliumNext 为 Trilium 的活跃续接（150–300MB，正文为 HTML）；Joplin Server 程序写入体验差，不推荐；纯 Markdown 文件库（PARA + Obsidian + Syncthing/Git）零占用、零锁定；
- **自研轻量检索增强生成管线最契合**：sqlite-vec/Chroma 嵌入式向量库 + Python + 云端兼容 OpenAI 格式的接口，整条管线约 0.3–0.6GB；
- 平台型中唯一可同机共存的是 AnythingLLM（单容器约 0.5–1GB，LanceDB 内嵌），但有平台锁定；
- **三个推荐组合**：① Markdown 文件库 + 自研管线（首推，数据可迁移性最高）；② Memos 速记入口 + 自研管线 + Markdown 长期库（捕获体验最好）；③ 文件库捕获 + AnythingLLM 问答（自研量最小）；
- 通用建议：模型全走云端接口、加 2–4GB swap、统一反向代理分流。

## Comments

- **2026-09-06 约束修订**：服务器实际为 2 核 2G（非 4G）。影响：推荐组合①（Markdown 文件库 + 自研管线）与②（Memos + 自研管线）依然成立但余量变小，向量库明确优先 **sqlite-vec 进程内嵌入式**（不额外常驻服务、内存最省）；组合③中的 AnythingLLM（0.5–1GB 单容器）在 2G 下判定风险过高，**剔除推荐**；部署必须配 2–4GB swap 并给容器设内存上限。已同步至票据 06、09。
