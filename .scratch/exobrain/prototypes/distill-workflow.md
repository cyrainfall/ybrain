# 自动提炼工作流规范（v0 草案，票据 12 工件）

2026-09-06。前置：数据模型（票据 10）、检索工具与代理指令（票据 11 工件 [rag-tools-and-prompt.md](rag-tools-and-prompt.md)）。

## 1. 派活方式（fork 路线的红利）

ybrain 是 opencode fork，提炼**不需要跨进程调用**：调度器在进程内以编程方式创建一个代理会话（opencode 内部 session 机制），注入提炼指令与目标笔记 id。该会话与本人在 Web 界面的对话会话隔离（系统身份 `ybrain-distiller`），共享同一套原生工具（search_knowledge / get_note / save_note / list_inbox）。

## 2. 任务队列状态机（SQLite jobs 表）

```
捕获落盘 0-Inbox ──enqueue──► queued
                                │ 调度器单并发领取（2 核约束，绝不并行）
                                ▼
                             running ──成功──► done（笔记已落 PARA，索引重建，Git 提交）
                                │
                                ├──超时(10min)/模型报错──► failed
                                │        │ 自动重试 ≤2 次，指数退避（1min/10min）
                                │        └──3 次仍失败──► dead（留在收件箱，等本人处理）
                                │
                                └──进程重启──► 启动时把 running 重置为 queued（会话幂等：
                                              提炼前先查笔记 status，已是 distilled 则直接 done）
```

- **队列只记状态，笔记文件是真相源**：任何时候笔记还在 `0-Inbox/` 就意味着"未提炼"，jobs 表丢了也能扫描收件箱重建队列；
- **幂等关键**：提炼会话第一步检查目标笔记 status——已 distilled 说明上次实际成功了（只是 job 状态没翻转），直接收尾；
- dead 任务不自动打扰：在 Web 界面收件箱视图里标红，等本人下次打开看到（是否推送通知归票据 08 的渠道决策）。

## 3. 单次提炼会话流程（代理执行步骤）

```
1. get_note(note_id) 读原文
2. search_knowledge(主题, k=5) 找相关旧笔记（建立连接的素材）
3. 生成：一句话摘要 / 3–5 个标签 / 要点卡片 / related 双链 / PARA 归类判断
4. save_note：
   - clip/note：frontmatter_patch（summary/tags/related/status: distilled/distilled_at/distill_model）
     + para_folder 移动 + body 写提炼区（原文区系统保留）
   - weread：原书摘归入 3-Resources 并 distilled；把值得沉淀的划线逐条 save_note 新建
     type: card 笔记（related 双链回书摘）
5. 会话结束。ybrain 监测到文件变更 → 按 note_id 重建该笔记向量分块 → git add/commit
```

提炼指令全文已在 [rag-tools-and-prompt.md](rag-tools-and-prompt.md) 第 2 节（【提炼规则】），本规范不重复；补充两条队列相关指令：

- 归类不确定时放 `3-Resources` 并在要点区顶部写 `> 归类存疑：建议 2-Areas/xxx，待确认`——不阻塞流程，把判断权留给本人；
- 单篇处理超过约 3000 字原文时，要点控制在 7 条以内，宁可粗不要漏。

## 4. 触发节奏（候选方案，待本人拍板）

| 方案 | 行为 | 适合 |
| --- | --- | --- |
| A. 随捕获随处理 | 落盘即入队，队列串行消化，通常几分钟内出提炼结果 | 想随时打开外脑都看到整理好的内容 |
| B. 每日定时批处理 | 如每天 20:00 一次性处理当天收件箱 | 集中感受"外脑一天的收获"，token 消耗集中 |
| C. 混合 | distill 随到随做；另加每周日晚"周复盘"会话（代理扫描本周新增、产出周报、建议归档） | 两者都要 |

## 5. 人机分工（候选方案，待本人拍板）

| 方案 | 行为 | 回滚成本 |
| --- | --- | --- |
| X. 直接落盘 | 提炼结果直接 save_note 生效；Git 历史可回滚；个人批注区永远留白 | 不满意就在 Obsidian/Web 里改，或 git revert |
| Y. 待确认 | 提炼结果先写为草稿（status: drafted，不移动文件夹），本人在 Web 界面逐条确认后才生效 | 多一步每日过目动作，但完全掌控 |

## 6. 索引与提交（系统侧，代理不感知）

- 提炼落盘触发：删该 note_id 旧 chunks → 重新分块（提炼区）→ bge-m3 嵌入 → 写 vec_chunks；
- Git 自动提交：每次提炼闭环一次 commit，message 格式 `distill: <笔记标题>`；失败不阻塞提炼（提交失败只告警）；
- 书摘拆出的 card 笔记同批提交。
