# 27 决策：自我改进循环机制

Type: grilling
Status: resolved
Blocked by: 12

## Question

外脑跑通后如何"越用越好用、功能越来越丰富"？需要一个友好的迭代验证机制，最好支持程序自己提案迭代：

1. **反馈捕获**：用户在日常使用中说"这个不好用"/"想要 X 功能"/"答案不够好"时，如何零摩擦地把这些声音收集进系统；
2. **提案生成**：谁把散落的反馈归类、去重、排优先级，形成可操作的改进提案；
3. **提案看板**：用户在哪里审阅提案（接受/拒绝/搁置），界面是什么；
4. **分层实施**：
   - 参数/指令类改动（分块大小、检索数量、提炼规则措辞、回答风格）：能否让程序自己改、自己验证、自己上线/回滚？
   - 功能类改动（新工具、新渠道、新界面）：如何不让"自动改进"失控，走正常构建流程；
5. **验证回归**：怎么知道一个改动真的让体验变好了，而不是变差了；
6. **效果追踪**：改动上线一段时间后是否回访确认效果。

## Answer

2026-09-07 定稿。采用 **OpenSpec（git submodule）** 作为自我改进的规范驱动框架，不自建提案/验证/归档逻辑。

### 决策：用 OpenSpec 不自建

调研结论：OpenSpec 与外脑架构天然契合——ybrain 是 opencode fork、OpenSpec 原生支持 opencode（slash commands / skills）；delta-spec 模型提供"提案→规范 delta→归档合并"完整演进链（自建方案缺这一层）；tasks 内建验证要求 + `/opsx:verify` 命令解决"怎么知道改好了"；社区维护、MIT 协议、模型无关、brownfield 友好。自建方案的 feedback 目录和周复盘调度仍沿用，OpenSpec 接在其后做提案生成与实施。

### 机制六环

1. **反馈捕获**（沿用原设计）：日常对话中代理识别不满/愿望 → 写 `0-Inbox/feedback/`（kind: feedback）；也可显式 `!wish <描述>` 或手机发 `#wish` 标签速记；零摩擦，不打断对话。

2. **提案生成**：周复盘会话（票据 12）扫描 feedback 目录 → 调 `/opsx:propose <change-name>` → 自动生成四工件到 `openspec/changes/<change-name>/`：
   - `proposal.md`（为什么改、改什么、范围）
   - `design.md`（技术方案）
   - `tasks.md`（每条带验证方式）
   - `specs/` delta（ADDED/MODIFIED/REMOVED 相对主规范的变更）

3. **提案看板**：Web 界面列 `openspec/changes/` 下活跃提案，显示 proposal 摘要；你勾选 `accepted` 才往下走，代理不擅自实施未审阅提案。驳回的标 `rejected` 留痕。

4. **分层实施**：
   - **参数/指令类**（分块大小、检索数量、提炼规则、回答风格、配置参数）：accepted 后 distiller 会话直接 `/opsx:apply` 改配置/AGENTS.md/代码 → `/opsx:verify` → `/opsx:archive`，全自动、Git 可回滚；
   - **功能类**（新工具、新渠道、新界面）：propose 生成的 tasks.md 直接毕业为构建票据挂地图（票据 16–26 流程），走正常构建 + 验收清单，不经 distiller 自动 apply。

5. **验证回归**：`/opsx:verify` 跑 tasks 内联验证（每条任务自带 test/command/observable behavior）+ **黄金查询集**（你确认过答案满意的问答对，存 `openspec/specs/quality/baseline.md`）回归对比。验证失败 → Git 回滚 + 提案标 `failed` 回到看板。

6. **效果回访**：归档时在 proposal.md frontmatter 记 `implemented_at`；两周后代理在对话中回访"改了 X，变好了吗？"→ 你确认 `verified: true` 或回滚。防止"改了觉得好但其实没用"。

### 集成方式

- **OpenSpec 作为 git submodule** 引入 ybrain fork：`packages/ybrain/openspec/`（OpenSpec init 在项目内创建目录结构）；
- 服务器装 Node.js 20.19+（OpenSpec 运行依赖；ybrain 是 Bun/TS，JS 运行时本就需要）；
- OpenSpec slash commands / skills 注入 opencode（ybrain fork 原生支持）；
- submodule 跟 OpenSpec release tag，定期升级。

### 目录结构（MVP 后启用）

```
packages/ybrain/
├── openspec/
│   ├── specs/                    # 主规范（系统行为权威基准）
│   │   ├── capture/spec.md      # 捕获接口能力规范
│   │   ├── distill/spec.md       # 提炼工作流能力规范
│   │   ├── rag/spec.md           # 检索问答能力规范
│   │   └── quality/baseline.md   # 黄金查询集
│   ├── changes/                  # 活跃改进提案
│   │   └── <change-name>/
│   │       ├── proposal.md
│   │       ├── design.md
│   │       ├── tasks.md
│   │       └── specs/            # delta specs
│   └── changes/archive/          # 已归档（delta 已合并）
└── ...
```

### MVP 预留

不阻塞 MVP（票据 16–26 先跑通核心闭环），但：
- `openspec/` 目录在票据 17（fork 骨架）时 init 建好（空结构）；
- 反馈入口在票据 24（提炼队列）的系统指令里加一句"识别抱怨/愿望→入 feedback"；
- 完整自我改进回路作为 **MVP 后第二个增量**（微信读书同步是第一个增量，票据 15）。

### 与自建方案的差异（为什么选 OpenSpec）

| 维度 | 自建 | OpenSpec submodule |
| --- | --- | --- |
| 提案格式 | 自定义 Markdown | 成熟四工件（proposal/design/tasks/delta specs） |
| 验证 | 自建黄金查询集 | tasks 内联验证要求 + verify 命令 + 黄金查询集扩展 |
| 规范演进 | 只有 proposals 目录 | delta-spec 合并到主规范，完整行为演进史 |
| 与 opencode 集成 | 自建调度 | 原生支持 |
| 审计 | Git 历史 | archive + 主规范 + Git，三层可追溯 |
| 维护 | 自建全套 | 社区维护 + submodule 跟 release |
