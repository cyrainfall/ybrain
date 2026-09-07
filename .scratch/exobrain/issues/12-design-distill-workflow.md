# 12 设计：AI 自动提炼工作流

Type: prototype
Status: resolved
Blocked by: 06, 07, 10

## Question

**按票据 06 修订（fork 二开）调整（2026-09-06）：提炼由 ybrain 内的代理本体驱动，任务队列内嵌在 fork 代码中，知识工具为原生工具。** 设计"捕获后代理提炼"的工作流，并产出示例反应工件：

1. **任务队列契约**：内容进入收件箱后，ybrain 如何串行派发提炼会话（单并发、超时、失败重试、代理不可用时内容留在收件箱待补处理）；
2. **代理提炼动作**：代理对每篇内容产出——一句话摘要、3~5 个关键词标签、PARA 分类并移动文件、核心要点/知识卡片（含金句摘录）；写回笔记的 frontmatter 与正文格式约定（与票据 10 数据模型对齐）；
3. **代理可用的工具**：`search_knowledge`（找相关旧笔记做连接）、`get_note`、`save_note`、`list_inbox` 等原生工具的使用指令；
4. **人机分工**：代理处理完默认直接落盘（Git 历史可回滚），还是标记"待确认"在 Web 界面里过目；批量处理节奏（随捕获随处理 vs 每日定时批处理）；
5. **产出工件**：提炼前后的笔记对比示例、提炼指令（系统提示/AGENTS.md 类规则文件）草稿、任务队列状态机说明。

## Answer

2026-09-06 产出工件并经本人确认两项关键抉择。

**工件**：[prototypes/distill-workflow.md](../prototypes/distill-workflow.md)（队列状态机、会话流程、派活方式）+ [prototypes/vault/2-Areas/202609060947-card-spring-effort-result.md](../prototypes/vault/2-Areas/202609060947-card-spring-effort-result.md)（书摘拆出的知识卡片示例）。提炼指令本身在票据 11 工件 [rag-tools-and-prompt.md](../prototypes/rag-tools-and-prompt.md) 第 2 节。

**已定稿的工作流**：

1. **派活方式**：fork 红利——调度器在 ybrain 进程内创建隔离的代理会话（身份 `ybrain-distiller`）跑提炼，不跨进程；与本人的 Web 对话会话共享原生工具；
2. **队列状态机**：queued → running → done / failed（自动重试 ≤2 次，退避 1min/10min）→ dead（留收件箱、界面标红）；进程重启把 running 重置为 queued；**幂等**靠提炼前先查笔记 status；jobs 表可从收件箱扫描重建，文件是真相源；单并发（2 核约束）；单任务超时 10 分钟；
3. **会话流程**：读原文 → search_knowledge 找 5 条相关 → 生成摘要/标签/要点/双链/归类 → save_note 落盘（weread 额外拆 type: card 卡片并双链回书摘）→ 系统侧按 note_id 重建向量分块 → Git 提交（message `distill: <标题>`）；
4. **节奏（本人选定：混合）**：提炼随捕获随处理（落盘即入队、串行消化）；**每周日晚自动跑周复盘会话**——扫描本周新增、产出周报、提出归档建议；
5. **人机分工（本人选定：直接落盘 + Git 兜底）**：提炼结果直接生效，每次提炼自动 Git 提交可回滚；归类存疑时代理在笔记顶部标注"待确认"但不阻塞；个人批注区永远留白；dead 任务不主动推送（通知渠道归票据 08）。

**衍生雾区**：本人速记中的"每日昨日新增速览（3 条以内、地铁上看）"与周复盘同族，记入地图雾区，构建阶段作为周复盘的轻量变体评估。
