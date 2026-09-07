# 07 决策：聊天/嵌入/重排模型供应商

Type: grilling
Status: claimed
Blocked by: 04

## Question

基于模型供应商调研（04），与本人对话锁定：

1. **聊天模型**：确认 DeepSeek 作为主力（提炼、问答合成），是否需要第二个供应商做备用；
2. **嵌入模型**：选定供应商与模型版本（维度、中文效果、价格），明确密钥申请方式；
3. **重排模型**：MVP 阶段是否启用（个人知识库规模下的性价比判断）；
4. **成本与配额**：月度预算上限、用量监控方式（如何发现异常调用）；
5. **密钥管理**：API 密钥在服务器上的存放方式（环境变量/配置文件，不进 Git）；
6. **接口适配**：是否统一用 OpenAI 兼容接口封装，便于将来换供应商。

产出：模型组合决策记录 + 密钥申请清单（本人去各平台注册申请的步骤）。

## Answer

2026-09-06 与本人对话定稿。

### 模型组合（已定稿）

| 角色 | 选择 | 说明 |
| --- | --- | --- |
| 聊天主力 | **DeepSeek `deepseek-v4-flash`**（直连官方 API） | 约 ¥1/百万输入（缓存命中 ¥0.02）、¥2/百万输出；100 万 token 上下文；OpenAI 兼容；提炼与日常问答都用它 |
| 聊天备用 | **DeepSeek `deepseek-v4-pro`** | 3 倍价格、更强推理；复杂综合任务在 opencode 里手动切换使用 |
| 聊天应急 | **OpenCode Zen 免费档**（如 `deepseek-v4-flash-free`、`nemotron-3-super-free`） | 限时免费、随时可能下架（2026 年已下架 kimi/qwen 免费档），只作应急不可依赖；OpenAI 兼容端点 `opencode.ai/zen/v1` |
| 嵌入 | **SiliconFlow `bge-m3`**（免费，1024 维） | OpenAI 兼容 `/v1/embeddings`；中文语义检索质量好；备选：百炼 text-embedding-v4（同云低延迟） |
| 重排 | **SiliconFlow `bge-reranker-v2-m3`**（免费），MVP 即启用 | `/v1/rerank`；检索 top-N 精排，个人规模零成本 |

### 配套决策

- **预算**：不设上限，只监控——DeepSeek 与 SiliconFlow 平台用量页每月核对一次；嵌入/重排为零成本，实际开销集中在代理聊天（预估 ¥5–20/月）；
- **密钥管理**：全部走服务器上的环境变量/`.env`（Docker Compose 注入），`.env` 进 `.gitignore` 不入仓库、不进备份明文（细节归票据 13）；
- **接口统一**：三家（DeepSeek 官方、SiliconFlow、Zen）全部 OpenAI 兼容，ybrain 内一个客户端配置切换，换供应商只改 base_url + key。

### 需申请的密钥（本人操作清单）

1. **DeepSeek**：注册 [platform.deepseek.com](https://platform.deepseek.com) → 充值少量（如 ¥10）→ 创建 API Key（新用户约 500 万 token、30 天有效额度）；
2. **SiliconFlow**：注册 [siliconflow.cn](https://siliconflow.cn)（送 ¥14 体验金）→ 创建 API Key（bge-m3 与 bge-reranker-v2-m3 免费，不消耗额度）；
3. **（可选）OpenCode Zen**：[opencode.ai/auth](https://opencode.ai/auth) 获取 Zen Key，作为应急免费档；
4. 密钥交付方式：不贴聊天记录，部署时写入服务器 `.env`（或当面/私密渠道交接）。

**执行记录 2026-09-06**：DeepSeek 与 SiliconFlow 密钥已由本人交付，经工作台从服务器侧实测有效（DeepSeek 账户可用、余额 ¥48.6；bge-m3 嵌入与 bge-reranker-v2-m3 重排调用均成功），已写入服务器 `/opt/ybrain/.env`（root 所有、600 权限，含 base_url 与 Zen 占位）。注意：密钥曾在对话中明文出现，**MVP 跑通后需在两个平台各轮换一次**；轮换后用行级替换更新 `.env` 即可。密钥值不入任何仓库/票据/记忆。

### 架构连带（已同步票据 06 修订）

本人选定 **ybrain fork 二开路线**：外脑全部服务端能力（捕获接口、知识工具、任务队列、嵌入索引）直接开发在 opencode fork（cyrainfall/ybrain）内，TypeScript/Bun 单进程，取消独立 Python exobrain 容器。合并纪律与容器拓扑见票据 06 修订节。
