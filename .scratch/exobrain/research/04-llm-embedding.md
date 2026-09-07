# 外脑系统云端大模型选型调研：聊天 / 嵌入 / 重排

> 调研日期：2026-09-05
> 场景：个人"外脑"系统部署在阿里云中国大陆 2 核 4G 服务器（无法本地运行大语言模型），智能能力全部走云端 API（Application Programming Interface，应用程序接口）。
> 用途：(a) 新捕获网页/笔记自动提炼（摘要、标签、分类）；(b) 基于个人知识库的 RAG（Retrieval-Augmented Generation，检索增强生成）问答，需要嵌入模型（Embedding，把文本转为向量）做语义检索，可选重排模型（Rerank，对初步召回的候选段落做二次精排）。
> 聊天模型偏好：DeepSeek。
> 价格均为人民币（¥），除特别注明外单位为"元 / 百万 tokens"（Token，词元，模型处理文本的最小单位；中文约 1 个汉字 ≈ 0.6–1 个 token）。

---

## 0. 结论速览（推荐组合）

| 角色 | 首选 | 备选 | 月费（本场景） |
|---|---|---|---|
| 聊天 LLM（Large Language Model，大语言模型） | **DeepSeek 官方 API `deepseek-v4-flash`**（platform.deepseek.com） | 复杂推理任务临时切 `deepseek-v4-pro`；备用渠道：阿里云百炼 / SiliconFlow 托管的 DeepSeek | ¥3–6 |
| 嵌入 Embedding | **阿里云百炼 `text-embedding-v4` 或 `qwen3.7-text-embedding`**（与服务器同云、同地域，延迟低） | **SiliconFlow（硅基流动）`BAAI/bge-m3` 免费**；智谱 `embedding-3`；火山豆包 `doubao-embedding` | ¥0–1 |
| 重排 Rerank | **百炼 `qwen3.7-text-rerank`**（¥0.5/M） | **SiliconFlow `BAAI/bge-reranker-v2-m3` 免费**；百炼 `gte-rerank-v2`；智谱 `GLM-rerank` | ¥0–2.5 |

- **推荐方案 B（省心稳定）**：DeepSeek v4-flash 官方 + 百炼嵌入 + 百炼重排，**月度合计约 ¥7–8**。
- **极限省钱方案 A**：DeepSeek v4-flash 官方 + SiliconFlow 免费 bge-m3 / bge-reranker-v2-m3，**月度合计约 ¥5**（嵌入和重排为 ¥0）。
- **高配方案 C**：DeepSeek v4-pro + 百炼嵌入 + 百炼重排，**月度合计约 ¥19**。

关键判断：
1. **DeepSeek 官方 API 不提供嵌入/重排模型**，只有对话模型；向量能力必须选第二家。
2. **第三方平台托管的 DeepSeek V4 比官方贵 2–4 倍**（火山引擎 2026-08-28 上调至 flash ¥3/¥9、pro ¥9/¥27；SiliconFlow flash 白天 ¥3/¥9），聊天应直接走官方，第三方仅作容灾备用。
3. **2 核 4G 服务器不建议本地跑 bge-m3**（内存约需 4–6GB，有 OOM（Out of Memory，内存溢出）风险）；bge-small-zh 虽能跑但能力弱，且 SiliconFlow 上 bge-m3 API 永久免费，本地部署无成本优势。
4. 个人知识库规模（几千到几万条笔记块）下，**重排建议开启**：费用 ≈ 0（免费渠道）或 ≤¥2.5/月，对问答准确率提升明显。

---

## 1. DeepSeek 官方 API 调研

来源：DeepSeek 官方定价页（api-docs.deepseek.com，2026-09 现行）。

### 1.1 在售模型与价格

DeepSeek 于 2026 年 4 月发布 V4 系列，目前官方在售两个模型（旧模型名 `deepseek-chat` / `deepseek-reasoner` 将逐步弃用，分别对应 v4-flash 的**非思考模式**与**思考模式**）：

| 模型 | 上下文长度 | 最大输出 | 输入（缓存未命中） | 输入（缓存命中） | 输出 | 并发限制 |
|---|---|---|---|---|---|---|
| `deepseek-v4-flash` | 1M tokens | 384K tokens | **¥1/M** | **¥0.02/M** | **¥2/M** | 2500 |
| `deepseek-v4-pro`（旗舰） | 1M tokens | 384K tokens | **¥3/M** | **¥0.025/M** | **¥6/M** | 500 |

价格沿革：v4-pro 首发价为 ¥12/¥24（输入/输出），2026 年 4 月限时 2.5 折，5 月 31 日优惠结束后**永久调整为原价 1/4**（即 ¥3/¥6）；全系列缓存命中价于 2026-04-26 永久降至首发价 1/10。缓存（Context Caching，上下文缓存）指重复的请求前缀（如系统提示词、固定 RAG 模板）自动命中缓存，价格仅为正常输入的 2% 左右。

- **接口兼容**：完全兼容 OpenAI 格式，Base URL `https://api.deepseek.com`（同时提供 Anthropic 格式 `https://api.deepseek.com/anthropic`）；支持 JSON 输出、工具调用（Tool Calls）、流式输出。
- **嵌入/重排**：**官方不提供 embedding、rerank 模型**，也无多模态；仅对话/补全类模型。
- **国内调用稳定性**：API 服务器在国内，`api.deepseek.com` 直连无需翻墙；2025 年初高峰期曾出现"服务器繁忙"限流，V3.1/V4 时期容量大幅扩张，当前个人用量（日均十几次调用）远低于并发上限。风险点：官方英文定价页明示"计划在近期整体上调 API 价格，预计涨幅明显"，需关注公告。
- **第三方托管价格对比（均为 2026-09 现价，比官方贵）**：
  - 火山方舟：v4-flash ¥3/¥0.1/¥9（输入/缓存/输出，2026-08-28 上调）；v4-pro ¥9/¥0.3/¥27；
  - SiliconFlow：v4-flash 白天（0–2 点/8–24 点）¥3/¥0.3/¥9、凌晨 2–8 点 ¥1.5/¥0.15/¥4.5；v4-pro ¥12/¥1/¥24；
  - 阿里云百炼亦托管 DeepSeek 系列（PTU/按量多种计费）。
  - 结论：**日常走官方，把百炼或 SiliconFlow 的 key 配成故障转移（fallback）即可**。

---

## 2. 嵌入模型候选对比

> 维度（Dimensions）：向量长度，越长检索通常越准、存储越大；最大输入：单条文本上限。

| 平台 / 模型 | 维度 | 单条最大输入 | 价格（元/百万 tokens） | OpenAI 兼容 | 备注 |
|---|---|---|---|---|---|
| **阿里云百炼 `qwen3.7-text-embedding`** | 256–2560（默认 1024） | 128,000 tokens | **¥0.5**（Batch 批量 ¥0.25） | 是（`/compatible-mode/v1/embeddings`） | 201 种语言；新用户各 100 万 tokens 免费（90 天） |
| 百炼 `qwen3.7-text-embedding-flash` | 256–1024（默认 1024） | 128,000 tokens | **¥0.125**（Batch ¥0.063） | 是 | 极致低价，效果略低于标准版 |
| 百炼 `text-embedding-v4`（Qwen3-Embedding 系列） | 64–2048（默认 1024） | 8,192 tokens | **¥0.5**（Batch ¥0.25） | 是 | 100+ 语种+编程语言；新用户免费额度 |
| 百炼 `text-embedding-v3` | 64–1024（默认 1024） | 8,192 tokens | **约 ¥0.5**（文档列 ¥0.0005/千） | 是 | 成熟稳定；免费额度 50–100 万 tokens（90 天） |
| **智谱 AI `embedding-3`**（open.bigmodel.cn） | 256–2048 可自定义（默认 2048） | 上下文 8K（单条建议 ≤3072 tokens，批量 ≤64 条） | **¥0.5**（`embedding-3-pro` 同价） | 是（`/api/paas/v4/embeddings`） | 中文口碑好；另有 `embedding-2`（1024 维） |
| **火山引擎（豆包）`doubao-embedding`**（火山方舟） | 2048（large 版） | 4K–8K tokens | **¥0.5**（`doubao-embedding-large` ¥0.7；多模态 vision 版 ¥0.7 文本/¥1.8 图像） | 是（`/v3/embeddings`） | 字节生态，RPM/TPM 限额高 |
| **SiliconFlow `BAAI/bge-m3`** | 1024 | 8,192 tokens | **永久免费**（限速；Pro 专属版 ¥0.07） | 是（`api.siliconflow.cn/v1/embeddings`） | 智源 bge-m3，多语言/长文本，中文检索第一梯队 |
| SiliconFlow `BAAI/bge-large-zh-v1.5` | 1024 | 512 tokens | **免费** | 是 | 中文专用，输入长度短 |
| SiliconFlow `netease-youdao/bce-embedding-base_v1` | 768 | 512 tokens | 曾免费，**2026-06 已下线** | — | 注意选型避开 |

要点：
- **百炼与服务器同属阿里云**：北京地域同可用区内网/同网调用延迟最低、稳定性最好，且支持业务空间专属域名；这是把百炼列为嵌入首选的主要原因。
- **bge-m3 是开源嵌入模型的中文检索标杆**（多语言、最长 8192 tokens、同时支持稠密/稀疏向量），SiliconFlow 免费提供，个人用量（2M tokens/月，平均每分钟不到 3000 tokens）远低于其免费档限速（Embedding 类 RPM（Requests Per Minute，每分钟请求数）2000 起、TPM（Tokens Per Minute，每分钟 token 数）50 万起）。
- 百炼 Batch 接口半价：首次全量建库（几十万到上百万 tokens 的一次性导入）建议走 Batch，成本再减半。

---

## 3. 本地部署嵌入模型的可行性（2 核 4G 云服务器）

| 模型 | 参数量 / 权重大小 | 维度 / 最大输入 | 内存占用（CPU 推理） | 2 核 4G 可行性 |
|---|---|---|---|---|
| `bge-small-zh-v1.5` | 24M 参数，权重约 95MB | 512 维 / 512 tokens | 约 0.2–0.4GB | **能跑**，但单条上限 512 tokens 对长笔记块不够，检索质量明显弱于 bge-m3 |
| `bge-base-zh` / `m3e-base` | 约 110–130MB | 768 维 / 512 tokens | 约 0.5–1GB | 勉强可跑，仍受 512 tokens 输入限制 |
| **`bge-m3`（完整版）** | 约 1.2B 参数（XLM-RoBERTa-large 架构）；FP32 权重约 2.2GB，FP16/ONNX 约 1.1–1.3GB | 1024 维 / 8192 tokens | 加载即需 **4GB 以上**可用内存；社区 Docker 实践建议 `--memory=6g`、系统 ≥8GB RAM；优化后（仅 dense 头）实测常驻约 1.3GB，但强 Xeon CPU 单条（512 tokens）仍需约 300ms，2 vCPU 弱机型更慢 | **不现实**：4GB 总内存还要分给操作系统、向量数据库、外脑应用与数据库，批量导入时极易 OOM 被 kill；且 CPU 批量编码 2M tokens 耗时以小时计 |

结论：**嵌入全部走云端 API**。bge-m3 在 SiliconFlow 上免费、在百炼上 ¥1/月，本地部署既不省钱也不省麻烦。

---

## 4. 重排（Rerank）模型

RAG 流程：嵌入向量检索先召回 top-20~50 个候选块（追求"召得全"），重排模型用交叉编码器（Cross-Encoder）对"问题+每个候选块"逐对精打分（追求"排得准"），取 top-3~5 喂给聊天模型。

| 平台 / 模型 | 最大输入 | 价格（元/百万 tokens） | OpenAI 兼容 | 备注 |
|---|---|---|---|---|
| **SiliconFlow `BAAI/bge-reranker-v2-m3`** | 8,192 tokens | **永久免费**（限速 RPM 2000 / TPM 50 万；Pro 版 ¥0.07） | 是（`/v1/rerank`） | bge-m3 同源重排器，中文效果好 |
| **百炼 `qwen3.7-text-rerank`** | 32,768 tokens | **¥0.5** | 是（rerank 接口） | 2026 年新款，Web 检索评测提升明显 |
| 百炼 `gte-rerank-v2` | 30,000 tokens | ¥0.8 | 是 | 通义多语言排序模型，成熟 |
| 智谱 `GLM-rerank` / `GLM-rerank-pro` | — | ¥0.8（智谱知识库内 `bge-reranker-large` 免费） | 是 | 与 embedding-3 同平台 |
| 火山方舟 | 知识库内置重排能力 | 随方舟计费 | — | 一般随豆包知识库套餐使用 |

**个人规模是否值得启用：值得。**
- 费用测算：每天 15 次问答 × 30 天 = 450 次/月；每次重排 ≈ 问题 200 tokens + 20 个候选块 × 约 400 tokens ≈ 8K tokens（区间 5K–10K），月耗约 2.3M–4.5M tokens。
  - SiliconFlow 免费档：**¥0**；
  - 百炼 qwen3.7-text-rerank：约 **¥1.1–2.3/月**；gte-rerank-v2 约 ¥1.8–3.6/月。
- 收益：几千到几万条笔记块的知识库中，向量检索对短查询、口语化提问、跨主题近似段落的召回噪声较大，重排通常可把 top-3 命中率显著提升（业界实测普遍有 10–30% 的相对提升），而成本与延迟代价（每次多一次约几百毫秒的 API 调用）都极小。
- 建议：**问答链路默认开启重排（top-20 召回 → 重排取 top-5）**；文章自动提炼等离线任务不需要重排。

---

## 5. 月度成本估算（人民币）

### 5.1 用量假设

| 项目 | 次数 | 每次输入 | 每次输出 | 月输入量 | 月输出量 |
|---|---|---|---|---|---|
| 文章提炼 | 400 篇/月（300–500） | 4,000 tokens | 800 tokens | 1.6M（1.2M–2.0M） | 0.32M（0.24M–0.40M） |
| RAG 问答 | 15 次/天 × 30 天 = 450 次/月 | 6,000 tokens | 500 tokens | 2.7M | 0.225M |
| **聊天合计** | — | — | — | **约 4.3M（3.9M–4.7M）** | **约 0.545M（0.465M–0.625M）** |
| 嵌入（全量文本） | — | — | — | **约 2.0M** | — |
| 重排（450 次 × 约 8K tokens） | — | — | — | **约 2.3M–4.5M**（取 3.5M 中值） | — |

### 5.2 聊天费用（DeepSeek 官方价）

| 模型 | 输入费 | 输出费 | 月合计（无缓存，保守） | 考虑 50% 缓存命中 |
|---|---|---|---|---|
| `deepseek-v4-flash` | 4.3M × ¥1 = ¥4.3 | 0.545M × ¥2 = ¥1.09 | **约 ¥5.4**（区间 ¥4.8–6.0） | **约 ¥3.3** |
| `deepseek-v4-pro` | 4.3M × ¥3 = ¥12.9 | 0.545M × ¥6 = ¥3.27 | **约 ¥16.2**（区间 ¥14–18） | 约 ¥10–13 |

提炼摘要/标签与日常 RAG 问答用 v4-flash 完全够用；仅在复杂推理（多步分析、长文档综合）时临时切 v4-pro。

### 5.3 嵌入与重排费用

| 选型 | 嵌入费（2M tokens） | 重排费（约 3.5M tokens） |
|---|---|---|
| SiliconFlow（bge-m3 + bge-reranker-v2-m3，免费档） | **¥0** | **¥0** |
| 百炼（text-embedding-v4 ¥0.5/M + qwen3.7-text-rerank ¥0.5/M） | **¥1**（Batch 半价 ¥0.5） | **约 ¥1.8** |
| 智谱（embedding-3 ¥0.5/M + GLM-rerank ¥0.8/M） | ¥1 | 约 ¥2.8 |
| 火山（doubao-embedding ¥0.5/M） | ¥1（large ¥1.4） | 随方舟套餐 |

### 5.4 月度总额汇总

| 方案 | 聊天 | 嵌入 | 重排 | **月总计** |
|---|---|---|---|---|
| A. 极限省钱（DeepSeek 官方 flash + SiliconFlow 免费向量全家桶） | ¥5.4 | ¥0 | ¥0 | **约 ¥5/月** |
| B. **推荐**（DeepSeek 官方 flash + 百炼嵌入 + 百炼重排，同云稳定） | ¥5.4 | ¥1 | ¥1.8 | **约 ¥8/月**（合理利用缓存约 ¥6） |
| C. 高配（DeepSeek 官方 pro + 百炼嵌入 + 百炼重排） | ¥16.2 | ¥1 | ¥1.8 | **约 ¥19/月** |

> 一次性建库成本提示：若首次导入 10 万条笔记块（约 20M–50M tokens），用百炼 Batch 嵌入（¥0.25/M）也仅 ¥5–13；SiliconFlow 免费档则为 ¥0（受限速影响需跑几天，可接受）。

---

## 6. 新用户免费额度与密钥注册入口

| 平台 | 注册入口 / 获取 API Key | 新用户免费额度（2026-09，以控制台实际到账为准） |
|---|---|---|
| DeepSeek 开放平台 | https://platform.deepseek.com （手机号注册 → API Keys 创建）；文档 https://api-docs.deepseek.com | 新开发者账号送 **约 500 万 tokens**（有效期约 30 天）；网页版/App 对话对个人免费 |
| 阿里云百炼（DashScope） | https://bailian.console.aliyun.com （阿里云账号 → 模型广场/API Key 管理） | 开通后 90 天内：`qwen3.7-text-embedding`/`flash`、`text-embedding-v4` 等**各 100 万 tokens**，v3/v1/v2 等 50 万 tokens；对话新模型另有免费 token 包 |
| 智谱 AI 开放平台（BigModel） | https://open.bigmodel.cn （手机号注册 → API Keys） | 注册即送免费 tokens 额度；`GLM-4.5-Flash`/`GLM-4.7-Flash` 等对话模型**长期免费**；知识库内 bge-reranker-large 免费 |
| 火山引擎方舟（豆包） | https://console.volcengine.com/ark （实名认证 → API Key） | 新用户每款模型约 **50 万 tokens** 免费推理额度；"协作奖励计划"授权后每日可领最高 500 万 tokens 资源包（次日返、30 天有效） |
| SiliconFlow 硅基流动 | https://cloud.siliconflow.cn （注册 → 账户 → API 密钥） | 注册送 **¥14 付费额度**（约 2000 万 tokens 量级）；**bge-m3、bge-reranker-v2-m3、bge-large-zh 及 9B 以下小参数对话模型永久免费**（限速） |

所有平台均为国内直连、OpenAI 格式兼容，代码中通常只需改 `base_url` 和 `api_key` 即可切换。

---

## 7. 风险与备注

1. **价格变动风险**：大模型 API 处于持续价格战中，DeepSeek 官方英文页已预告"近期整体涨价、涨幅可能明显"；第三方平台（火山、SiliconFlow）2026 年下半年已多次上调 DeepSeek 托管价。落地时建议把模型供应商做成可配置项，定期（如每季度）核对官方定价页。
2. **免费档限速**：SiliconFlow 免费模型按账户级别限速（Embedding TPM 50 万、Rerank TPM 50 万），个人实时问答够用；大批量建库建议放到夜间或走百炼 Batch。
3. **数据敏感性**：个人笔记全文会发送到 API 厂商；DeepSeek、百炼、智谱、火山均为国内备案服务，数据不出境，但仍建议避免把密码、密钥等敏感原文入库。
4. **缓存命中率**：RAG 问答保持系统提示词与检索模板前缀固定、会话内连续提问，可显著提高 DeepSeek 缓存命中率（缓存输入价仅为正常价的 2–2.5%），实际账单可能比本报告的无缓存估算再低 20–40%。
5. **向量维度选择**：个人几万条块量级，1024 维足够（存储与检索更轻）；百炼 qwen3.7 系列默认 1024 维，bge-m3 固定 1024 维，二者不可混用——**全库必须用同一个嵌入模型**，切换模型需要全量重新嵌入。

---

## 8. 参考链接

- DeepSeek 官方模型与价格（中文）：https://api-docs.deepseek.com/zh-cn/quick_start/pricing
- DeepSeek 开放平台（注册/API Key）：https://platform.deepseek.com
- 阿里云百炼 · 通用文本向量同步接口（模型与价格）：https://help.aliyun.com/zh/model-studio/text-embedding-synchronous-api
- 阿里云百炼 · OpenAI 兼容 Embedding 接口：https://help.aliyun.com/zh/model-studio/embedding-interfaces-compatible-with-openai
- 阿里云百炼 · gte-rerank-v2 模型页：https://help.aliyun.com/zh/model-studio/gte-rerank-v2
- 阿里云百炼 · qwen3.7-text-rerank 模型页：https://help.aliyun.com/zh/model-studio/qwen3-7-text-rerank
- 智谱 AI · Embedding-3 模型文档：https://docs.bigmodel.cn/cn/guide/models/embedding/embedding-3
- 智谱 AI · 知识库服务计费（含 GLM-rerank 价格）：https://docs.bigmodel.cn/cn/guide/tools/knowledge/price
- 智谱开放平台定价页：https://open.bigmodel.cn/pricing
- 火山引擎 · 方舟模型计费说明：https://www.volcengine.com/docs/82379/1544106
- 火山引擎 · 免费推理额度说明：https://docs.volcengine.com/docs/82379/1399514
- 火山方舟控制台：https://console.volcengine.com/ark
- SiliconFlow · 模型价格总览：https://siliconflow.cn/pricing
- SiliconFlow · 限速说明（Rate Limits）：https://docs.siliconflow.com/cn/userguide/rate-limits/rate-limit-and-upgradation
- SiliconFlow 控制台（注册/API 密钥）：https://cloud.siliconflow.cn
