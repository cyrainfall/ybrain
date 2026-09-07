# 06 决策：外脑整体架构与底座形态

Type: grilling
Status: resolved
Blocked by: 01, 03

## Question

**硬约束更新（2026-09-06）：服务器确认为 2 核 2G 内存**。2G 下的内存预算需在架构中给出：操作系统约 300–400MB、Docker 守护进程约 200MB、Headscale 约 30MB、笔记底座（Memos 约 60–100MB 或文件库零占用）、自研 Python 服务（接口 + 提炼工作进程 + 进程内向量库 sqlite-vec）峰值约 400–700MB、反向代理约 30MB——常态应控制在约 1GB，靠 2–4GB swap 吸收批量嵌入/提炼的峰值。因此：进程内嵌入式向量库（sqlite-vec）优先于独立向量服务；调研（03）中的 AnythingLLM 选项（0.5–1GB 单容器）在 2G 下判定为风险过高、不再推荐；各容器须设内存上限。

基于服务器环境事实（01）与底座调研结论（03），与本人对话敲定外脑系统的整体架构，需要明确：

1. **底座形态**：笔记与捕获存储选什么——Memos 类速记服务、纯 Markdown 文件库（PARA 文件夹 + Obsidian 可打开）、还是其他；自研服务与开源底座之间如何分工；
2. **检索增强生成（RAG）路径**：自研轻量向量管线，还是部署 Dify/RAGFlow 类平台；向量数据与笔记原文如何对应、重建索引的代价；
3. **服务拆分**：捕获接收服务、提炼工作进程、问答服务、向量库各自以什么形态运行（几个容器、各自职责）；
4. **数据归属底线**：哪些数据必须是脱离系统可读的普通文件（Markdown、SQLite 可导出），哪些可以是内部格式；
5. **技术栈**：自研部分用什么语言/框架（与本人熟悉度匹配）。

产出：一张架构决策记录（组件清单 + 数据流 + 技术栈 + 取舍理由），后续数据模型（10）、管线设计（11、12）、部署（09）票据以此为准。

## Answer

2026-09-06 与本人对话定稿。术语表见仓库根目录 [CONTEXT.md](../../../CONTEXT.md)。

### 架构总览（已定稿）

服务器（深圳，2 核 1.8Gi）上三个容器 + 一组数据卷：

| 组件 | 形态 | 职责 | 内存上限 |
| --- | --- | --- | --- |
| **headscale** | 独立容器（约 30MB） | 自建 Tailscale 控制面，三端组网；业务端口只绑 Tailscale 虚拟网卡，不入安全组 | 128MB |
| **外脑服务 exobrain** | Python + FastAPI 单体容器 | ①捕获 REST 接口（浏览器扩展/HTTP Shortcuts/微信读书同步）；②MCP 工具端点（流式 HTTP，Bearer 令牌）：`search_knowledge`（向量检索）、`get_note`、`save_note`、`list_inbox`、`enqueue_job`；③后台调度与任务队列（SQLite 任务表，串行触发代理）；④嵌入与向量索引（百炼嵌入 + 进程内 sqlite-vec）；⑤笔记库变更后重建索引 + Git 自动提交 | 512–768MB |
| **常驻代理 opencode** | opencode serve 容器（Bun 运行时，无头模式 + 自带 Web 界面） | 工作区挂载笔记库；经容器内网调用 exobrain 的 MCP 工具；模型走 DeepSeek（OpenAI 兼容配置）；负责**知识处理**（提炼、标签、PARA 分类、跨笔记综合、周复盘）与**问答服务**（Web 界面为主入口） | 768MB–1GB（峰值靠 swap 兜底） |
| 数据卷 | vault/（Markdown 笔记库，PARA 结构 + frontmatter）、data/exobrain.db（SQLite + sqlite-vec 向量与任务队列） | — | — |

不引入反向代理（MVP）：两个应用容器直接绑 Tailscale 虚拟网卡 IP，隧道天然加密，省略 Caddy。

### 数据流

1. **捕获**：客户端 → exobrain 的 REST 接口 → 原文落地为 `vault/0-Inbox/` 下带 frontmatter 的 .md 文件（status: inbox）→ 代理任务入队。**捕获路径完全不依赖 opencode 可用性**——代理挂了内容照样进收件箱，恢复后补处理。
2. **提炼（代理驱动）**：exobrain 串行调用 opencode 无头接口（`/prompt` 类）创建会话，代理读原文、经 MCP 工具检索相关笔记后写回摘要/标签/知识卡片，并把文件移动到 PARA 对应目录；exobrain 监测文件变更 → 调百炼嵌入 → 写入 sqlite-vec → Git 自动提交。
3. **问答**：本人通过 Tailscale 内网地址打开 opencode Web 界面 → 代理自主调用 MCP 检索工具（向量检索在 exobrain 侧，答案合成在代理侧）→ 读原文 → 带出处回答。
4. **Mac 浏览**：笔记库是 Git 仓库，服务器定时提交；Mac 上 Obsidian 打开并拉取（备份由票据 13 细化）。

### 工程护栏（已接受的取舍）

- **资源**：常态内存约 1.2–1.5Gi；配 2–4GB swap；各容器设 mem_limit；opencode 关闭 LSP（`OPENCODE_DISABLE_LSP_DOWNLOAD=true`，服务器上无代码工程，语言服务器白耗内存）；代理任务**串行**执行（2 核不并行）。
- **安全**：opencode 容器非 root 运行；仅挂载笔记库卷（不挂 Docker socket、不放 SSH 密钥）；接口设基本认证 + 只绑 Tailscale 网卡；exobrain 的 MCP/REST 端点带 Bearer 令牌。
- **代理结果不完全可预测**：用后台队列（非请求路径内）、捕获与代理解耦、任务可重试、代理写文件后由固定管线嵌入归档来兜底；提炼结果默认写入笔记但保留 Git 历史可回滚。
- **成本**：代理多步处理比固定直调模型贵，个人规模预估月费 ¥10–30（高于纯管线 ¥8 的估算），预算上限在票据 07 定。

### 对后续票据的约束

- 票据 11（问答管线）：检索实现（分块/嵌入/重排）留在 Python 侧并**以 MCP 工具形式暴露**；答案合成由 opencode 代理完成，原型工件改为"MCP 检索工具 + 代理带引用回答"。
- 票据 12（提炼工作流）：改为**代理驱动**——定义代理提示词、任务队列契约、代理写回笔记的格式约定、Web 界面里过目/修改的体验。
- 票据 09（部署）：容器编排含 opencode serve（Bun 镜像、工作区挂载、DeepSeek 配置、LSP 关闭、基本认证、绑 Tailscale 网卡）。

### 修订（2026-09-06，本人复议后改定）

本人经评估后选定 **ybrain fork 二开路线**，架构由"三容器"修订为"两容器"：

- **代码形态**：外脑服务端能力全部开发进 opencode fork（[cyrainfall/ybrain](https://github.com/cyrainfall/ybrain)，TypeScript/Bun）：捕获 REST 接口、知识原生工具（检索/读写笔记/收件箱）、任务队列、嵌入索引、Git 自动提交。**取消独立 Python exobrain 容器与 MCP 跨容器端点**——工具成为 opencode 原生工具，正合"知识连接工具"的目标。
- **容器拓扑**：①headscale（不变）；②ybrain（fork 构建镜像：opencode serve + Web 界面 + 内嵌捕获接口/队列/索引），工作区挂载 vault/。部署细节归票据 09。
- **内存**：单 Bun 进程约 0.8–1.2G + 系统约 0.35G + Docker 约 0.2G + headscale 约 0.03G，常态约 1.4–1.8G——**2–4G swap 为必选项**，容器设 mem_limit。
- **降级的护栏（本人知情接受）**：捕获可用性与 ybrain 进程绑定，代理重启窗口内捕获靠客户端重试（HTTP Shortcuts 可配重试）+ 落盘队列补偿；原"捕获与代理解耦"改为"捕获与提炼解耦"（捕获先落盘收件箱，提炼失败可重放）。
- **合并纪律（fork 路线的存活条件）**：改动尽量隔离在新增目录/包（如 `packages/ybrain/`），不改核心文件时绝不顺手改；跟随上游 release tag 定期（约每 1–2 周）合并 dev 分支，冲突早解；上游大版本重构时允许暂时落后。
