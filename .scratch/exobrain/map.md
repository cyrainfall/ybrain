# 地图：个人外脑（ExoBrain）系统

## Destination

在阿里云国内服务器（**2 核 2G**、无域名）上建成一个**单人自托管的外脑系统**并跑通最小可用版本（MVP）：能从**电脑浏览器、安卓手机、微信生态**三条渠道快速捕获内容；全部资料经向量化后支持**基于个人知识库的自然语言问答**（检索增强生成，RAG）；新捕获内容由大语言模型（LLM）**自动提炼**（摘要、标签、分类建议）。

本地图走完时：架构、模型供应商、捕获方案、部署访问、数据模型、备份策略等关键决策全部锁定，且最小可用版本已在服务器上真实运行、可日常使用。

## Notes

- **领域**：个人知识管理 + 自托管服务。方法论参考 CODE（捕获 Capture → 组织 Organize → 提炼 Distill → 表达 Express）与 PARA 组织法（项目 Projects / 领域 Areas / 资源 Resources / 存档 Archive），灵感来源：<https://www.indigox.me/build-exobrain/>
- **固定约束**：
  - 服务器：阿里云国内机器，约 2 核 CPU、4G 内存，**无域名**（不做 ICP 备案，不依赖 80/443 端口的公开网站）；
  - 手机：Android；电脑：macOS；
  - 不具备本地运行大模型的硬件条件，智能能力全部走云端 API；聊天模型偏好 DeepSeek；
  - 建设方式：**混合模式**——存储/底座尽量用成熟开源项目，捕获入口与 AI 工作流等关键环节自研；
  - 数据归属优先：笔记内容尽量保持为普通工具可读的文件（Markdown 优先），避免被单一软件锁死。
- **票据工作方式**：研究票据（research）由代理调用 research 技能完成；决策票据（grilling）必须与本人对话确认，代理不得代答；设计票据（prototype）产出粗糙可反应的具体工件；任务票据（task）给出精确操作清单。
- **文档偏好**：全程中文；技术缩写在每份文档首次出现时写全称并简述（例如 RAG 要写"检索增强生成"），不堆缩写。
- **本图携带执行**：决策票据全部关闭后，构建/部署类任务票据从"尚未明确"毕业进入地图，直到最小可用版本跑通为止。

## Decisions so far

<!-- 每张票据关闭后在此追加一行：[票据标题](链接)：一句话结论；研究详情见 research/ 目录 -->

- [盘点阿里云服务器现状](issues/01-server-inventory.md)：深圳地域 ecs.e-c1m1.large（2 vCPU/1.8Gi 可用），公网 IP 120.25.146.106，Alibaba Cloud Linux 3，系统盘 40G 余 33G；Docker 未装、Swap 为 0、仅 22 端口在听；DeepSeek 与百炼 API 均低时延可达。部署首批任务：装 Docker、配 2–4G swap、安全组放行 Headscale 端口（TCP 8080、UDP 3478/41641）。
- [调研：无域名条件下的安全访问方案](issues/02-research-access-no-domain.md)：首选在服务器自建 Headscale + 各端官方 Tailscale 客户端组网，无需域名备案、直连低延迟，业务端口只绑虚拟网卡；裸公网 HTTP 加令牌仅限临时测试。
- [调研：开源笔记底座与检索增强生成实现方案](issues/03-research-base-architecture.md)：内存约束排除 RAGFlow/Dify 等平台；推荐 Markdown 文件库（或 Memos 速记）做底座 + Python 自研轻量向量管线（约 0.3–0.6GB），数据保持文件可读。2026-09-06 服务器确认为 2 核 2G 后：sqlite-vec 进程内向量库优先，AnythingLLM 选项剔除，swap 与容器内存上限成为部署必选项。
- [调研：聊天模型与嵌入模型供应商选型](issues/04-research-llm-embedding.md)：聊天直连 DeepSeek 官方（兼容 OpenAI 格式、无嵌入模型）；嵌入首选阿里云百炼 text-embedding-v4，重排可用 SiliconFlow 免费 bge-reranker；推荐组合个人规模约 ¥8/月。
- [调研：三条捕获渠道的实现方式](issues/05-research-capture-channels.md)：网页剪藏用自研浏览器扩展在端内提取正文后发送；Android 用 HTTP Shortcuts 接分享菜单（零代码）；公众号文章走"在浏览器打开"；微信读书官方已开放接口可同步划线（毕业为票据 15）；企业微信自建应用是唯一官方双向微信通道，待 08 决策。
- [决策：外脑整体架构与底座形态](issues/06-decision-architecture.md)：定稿并经 2026-09-06 修订——**两容器架构**：headscale 组网 + **ybrain（opencode fork 二开，TypeScript/Bun 单进程）**承载捕获接口、知识原生工具、任务队列、嵌入索引与问答界面；数据为 Markdown 笔记库（PARA）+ SQLite；Mac 用 Obsidian + Git 浏览；护栏：捕获先落盘收件箱、与提炼解耦、容器限额、swap 兜底；fork 合并纪律（隔离改动、定期跟上游）。术语表见仓库根 CONTEXT.md。
- [决策：聊天/嵌入/重排模型供应商](issues/07-decision-model-providers.md)：聊天 DeepSeek flash 主力（直连官方）+ pro 备用 + Zen 免费档应急；嵌入 SiliconFlow 免费 bge-m3、重排免费 bge-reranker-v2-m3（一个账号全免）；预算不设限只监控；三家全 OpenAI 兼容可切换；密钥走服务器 .env 不入 Git。
- [决策：部署形态与安全访问](issues/09-decision-deployment-access.md)：公网仅暴露 SSH(22) + Headscale 三端口（TCP 8080、UDP 3478/41641）；ybrain 的 Web(4096)/捕获(8787) 只绑 Tailscale 网卡；镜像走 GitHub Actions 构建→阿里云 ACR→服务器拉取（服务器不构建）；4G swap + swappiness=15 + 容器限额（headscale 128M / ybrain 1.2G）；目录 /opt/ybrain/；日志轮转、fail2ban、云助手救急。
- [设计：笔记数据模型与 PARA 落地](issues/10-design-data-model-para.md)：单 Markdown 文件 = YAML frontmatter + 正文；PARA 用五文件夹（0-Inbox/1-Projects/2-Areas/3-Resources/4-Archive）+ 标签管主题；原文同文件底部保留；状态机 inbox→distilled→archived（失败留收件箱重试）；书摘按"书+日期"聚合成篇、代理拆知识卡片；SQLite（notes/chunks/vec_chunks/jobs）为可重建的检索加速层。规范与四篇示例见 prototypes/。
- [设计：检索增强问答管线](issues/11-design-rag-pipeline.md)：原型真实跑通——bge-m3（1024 维）嵌入 + sqlite-vec 粗取 top8 + bge-reranker-v2-m3 精排；重排纠偏有效（噪声 0.49→0.05）；rerank<0.1 判定资料不足、代理明说"不知道"；索引按 note_id 对账、只索引提炼区；四个原生工具（search_knowledge/get_note/list_inbox/save_note）契约与代理指令草稿见 prototypes/rag-tools-and-prompt.md。
- [设计：AI 自动提炼工作流](issues/12-design-distill-workflow.md)：fork 内进程内代理会话（身份 ybrain-distiller）跑提炼；jobs 状态机 queued→running→done/failed（重试≤2）→dead，单并发、10min 超时、幂等靠查 status、队列可从收件箱重建；落盘后重建向量索引并自动 Git 提交；节奏=随到随做+周日晚周复盘；结果直接落盘 Git 兜底，归类存疑标注不阻塞，批注区留白。见 prototypes/distill-workflow.md。
- [决策：MVP 捕获入口范围与协议](issues/08-decision-capture-mvp.md)：POST /capture（8787 端口仅 Tailscale），Bearer 渠道独立令牌；正文双路（扩展端内提取为主、服务器抓 URL 兜底，失败落"仅链接"笔记）；永远先落盘收件箱再返回；浏览器扩展（MV3，本地队列重发）+ HTTP Shortcuts（安卓分享菜单）；企业微信、微信读书均不进 MVP。约定见 prototypes/capture-api.md。
- [决策：微信读书划线同步](issues/15-decision-weread-sync.md)：**不进 MVP**，定为 MVP 后第一个增量；官方 wrk- API Key（扫码获取，存 .env）每天凌晨增量拉取划线/想法，按"书+日期"聚合成 weread 笔记走标准提炼；只拉笔记不拉书籍全文，不做书架/进度。
- [决策：备份与数据安全](issues/13-decision-backup.md)：只备份 vault——Gitee 私有仓库（提炼后自动 push、Mac Obsidian 定时 pull，三份副本）；SQLite/headscale 不备份（reindex 免费重建 / 控制面 15 分钟重建）；.env 不进 Git 不进备份、密钥存密码管理器；七步恢复演练清单见 prototypes/backup-plan.md。
- [决策：MVP 验收标准与构建顺序](issues/14-decision-mvp-acceptance.md)：六组 20 条实测验收项（组网/捕获/提炼/问答/备份/资源）；构建拆为 11 张任务票据（16–26）；设计阶段结束，地图进入执行阶段。清单见 prototypes/mvp-acceptance.md。

## Not yet specified

<!-- 雾区：能感觉到要来、但还无法精确表述的问题；前沿推进后逐片毕业为票据 -->

- **每日/每周知识简报**：周复盘已定（票据 12）；本人速记还想要"每日昨日新增速览，3 条以内、地铁上可看完"。推送渠道（Web 界面/企业微信/Telegram）与票据 08 捕获渠道决策相关，构建阶段评估。

- **存量资料迁移**：现有笔记分散在本地 Markdown、云端笔记、微信收藏等处；MVP 跑通后评估迁移范围（MVP 不做）。
- **PDF / 电子书 / 长文档处理**：解析与分块策略和普通网页不同，MVP 之后细化。
- **播客与音视频转写**：涉及语音识别（ASR）成本与转写流程，MVP 之后评估。
- [决策：自我改进循环机制](issues/27-decision-self-improvement-loop.md)：**采用 OpenSpec（git submodule）**不自建——delta-spec 模型提供提案→规范 delta→归档合并完整演进链；tasks 内建验证 + 黄金查询集回归；与 opencode fork 原生兼容；六环回路（反馈→propose→审阅→分层实施→verify→回访）；参数类全自动、功能类毕业为构建票据。MVP 预留 openspec/ 空目录 + feedback 识别指令，MVP 后第二个增量启用。
- **知识卡片与间隔复习**：提炼产物是否对接间隔重复（如 Anki 类）机制。
- **邮件捕获渠道**：本轮未选为 MVP 渠道；若后续微信渠道受阻，邮件收取（IMAP）可作为备选补位。

## Out of scope

<!-- 已明确超出终点、本地图不做的事；除非重画终点，否则不毕业 -->

- **写作与公开发布（Express 环节）**：博客发布、数字花园、公开分享页——MVP 不含，未来另起地图。
- **多用户与协作**：纯单人系统，不做账号体系与权限。
- **服务器本地运行大模型**：2 核 4G 硬件不支持，智能能力一律走云端 API。
- **域名注册与 ICP 备案**：MVP 期不依赖域名公开访问。
