# 05 调研：三条内容捕获渠道（浏览器剪藏 / Android 速记 / 微信生态）

Type: research
Status: done
Date: 2026-09-05

## Question

个人"外脑"系统（服务器在阿里云国内，2 核 4G，无域名、无微信公众号，服务通过公网 IP+端口或内网隧道访问）需要三条内容捕获渠道的实现方式调研：

1. 电脑浏览器（macOS）网页剪藏：浏览器扩展 vs 书签小工具（Bookmarklet）；正文提取库对比（Mozilla Readability、trafilatura、readability-lxml、go-readability）；微信公众号文章（mp.weixin.qq.com）的提取效果与反爬；正文提取放浏览器端还是服务器端。
2. Android 手机随手速记：接入系统分享菜单（Share Sheet）并通过 HTTP POST（超文本传输协议的 POST 方法）发到自托管服务器的成熟工具；纯文字速记与链接分享两种流程；可配置自定义应用程序接口（API，Application Programming Interface）端点的开源客户端。
3. 微信生态：公众号文章入站路径、微信内能否直接分享到第三方 App；微信读书书摘/划线导出的官方与非官方方式及封号风险；企业微信机器人 / Server 酱 / 文件传输助手等能否作为"微信→服务器"输入通道；哪些路径稳定、哪些是灰色 hack。

每条渠道给出：推荐实现 + 用户操作步数 + 自研开发工作量 + 风险点。

---

## 结论速览

| 渠道 | 推荐实现 | 用户步数 | 自研工作量 | 可靠性 |
|---|---|---|---|---|
| ① macOS 浏览器剪藏 | 自研浏览器扩展（Manifest V3），浏览器端用 Readability 提取正文后 POST 全文；书签小工具兜底发 URL | 1 步（点图标/快捷键） | 扩展 2–4 人日 + 接收接口 1 人日 | ★★★★★ |
| ② Android 速记 | HTTP Shortcuts 接入分享菜单 + 桌面速记小部件，POST 到服务器 | 链接 3 步 / 速记 3 步 | 仅服务器接口 ~1 人日，App 端零代码配置 | ★★★★★ |
| ③ 微信生态 | 公众号文章复用渠道①②（微信内无直出通道）；微信读书用**官方 API Key 定时同步**划线；可选企业微信自建应用回调做"微信内直发" | 文章 3–4 步；读书 0 步（自动）；企微直发 2 步 | 读书同步脚本 ~1 人日；企微回调 1–2 人日 | 官方路径 ★★★★☆；逆向路径 ★☆☆☆☆ |

核心判断：**正文提取放在浏览器端**（用户正在看的页面天然带真实渲染结果、Cookie、传输层安全（TLS）指纹，零反爬对抗）；服务器端只保留 trafilatura 作为"只收到 URL"时的兜底，且**不对公众号链接做服务器抓取**。微信生态一切基于个人号逆向/Cookie 模拟的方案均为灰色路径，2026 年封号风险已实质化，不押注。

---

## 渠道一：电脑浏览器（macOS）网页剪藏

### 1.1 浏览器扩展 vs 书签小工具（Bookmarklet）

| 维度 | 浏览器扩展（Manifest V3） | 书签小工具（Bookmarklet） |
|---|---|---|
| 本质 | 独立安装包，content script 注入页面、后台 Service Worker 发请求 | 一段 `javascript:` URL 存为书签，点击时在当前页上下文执行 |
| 跨域请求 | 申请 host 权限后，后台发请求不受跨域资源共享（CORS，Cross-Origin Resource Sharing）限制，可直接 POST 到 IP:端口 | 受页面同源策略约束，跨域 POST 需要服务器返回 CORS 头，或退化为弹窗/表单提交 |
| 触发方式 | 工具栏图标、**键盘快捷键**、右键菜单 | 仅书签栏点击（个别浏览器支持书签关键词） |
| 页面脚本限制 | content script 运行在隔离世界，不受页面脚本影响 | 受页面内容安全策略（CSP，Content Security Policy）影响：严格 CSP 站点在 Chrome 下可能拦截内联脚本执行（Firefox 对书签小工具豁免 CSP） |
| 能力 | 可打包正文、图片、选中文本；可做选项页存令牌、失败重试、通知 | 适合"取 URL/标题/选中文字发走"，复杂逻辑（如 HTML 转 Markdown）也能做但体积、调试体验差 |
| 安装/分发 | 可上架商店或开发者模式侧载（Chrome 侧载每次启动有提示，可用企业策略消除）；需适配 Chrome/Firefox 差异 | 零安装、跨浏览器、拖到书签栏即用；移动端浏览器基本不可用 |
| 开发量 | 中等（manifest、权限、后台脚本、选项页） | 极小（单文件 JS） |

参考：Firefox 扩展商店中大量剪藏类扩展（Synapse Web Clipper、Cloud Clipper 等）均采用"Mozilla Readability 提取正文 + Turndown 转 Markdown + 后台 POST"的同一架构，说明该模式已是社区标准做法。

### 1.2 正文提取库对比

| 库 | 语言/运行位置 | 特点 | 效果数据 |
|---|---|---|---|
| **Mozilla Readability** | JavaScript，浏览器端或 Node.js | Firefox 阅读模式、Pocket 同款算法；遍历段落按文本密度/类名评分，选出正文子树；毫秒级、确定性、无网络依赖；Mozilla 持续维护 | 2025 年 SIGIR 多语言正文提取基准中：英文表现最好之一，**中文 F1 约 0.672**（各启发式库中文均明显低于英文，因中文无空格分词、段落特征不同） |
| **trafilatura** | Python，服务器端 | 新闻/博客类正文提取的事实标准；多策略回退链；输出纯文本/Markdown/XML/JSON 七种格式；元数据（标题/作者/日期）提取强；测试集含中文文档 | ScrapingHub 文章提取基准：F1 0.958、精度 0.938、召回 0.978（2.0.0 版本）；readability-lxml 同基准 F1 约 0.826 |
| **readability-lxml** | Python，服务器端 | Readability 算法的 Python 移植；返回的是**清洗后的 HTML 片段**而非纯文本，适合做"阅读器模式"，不直接适合喂给大模型 | F1 约 0.826；维护节奏一般 |
| **go-readability** | Go，服务器端 | Readability.js 的 Go 逐行移植；**原主仓库 go-shiori/go-readability 已于 2025 年 12 月归档（Public archive）**，社区分叉 jobindex-open/go-readability 仍在维护（2026-03 有发布） | 与 Readability.js 行为对齐；后端非 Go 则不必引入 |

共性结论：所有库都只处理"拿到手的 HTML"，不做 JavaScript 渲染（单页应用盲区）；对中文效果都打折扣，但**微信公众号文章正文结构规整**（正文集中在 `div#js_content`），真正的难点不在提取算法而在抓取环节（见 1.3）。

### 1.3 微信公众号文章专题：服务器端抓取的反爬现状

公众号文章正文 HTML 本身是公开的（浏览器中打开 `mp.weixin.qq.com/s/...` 链接无需登录即可阅读），但服务器端用 requests/curl 等普通 HTTP 客户端批量抓取有明确障碍：

- **TLS 指纹（JA3）检测**：非浏览器客户端的 TLS 握手指纹与真实浏览器不同，可能直接返回"环境异常"验证页；Playwright 等无头浏览器也带 `webdriver` 等可检测特征。
- **数据中心 IP 风控更严**：阿里云等机房 IP 段比家庭宽带 IP 更容易触发验证码/拦截。
- **图片链路特殊**：图片在 `mmbiz.qpic.cn`，正文里用 `data-src` 懒加载（不执行 JS 拿不到真实地址）、部分有 Referer 校验、图链会随文章删除/时间推移失效——只存 HTML 则图片迟早挂掉。
- **隐藏元素干扰**：正文夹杂 `visibility:hidden; opacity:0` 的诱饵节点，朴素提取器容易混入噪声。
- **Cookie/Token 的边界**：抓**正文不需要登录 Cookie**；但抓阅读量/点赞/评论需要 `appmsg_token` + 完整 Cookie，且这类凭证约 4 小时失效、绑定会话，高频请求触发 IP 封禁（社区爬虫项目 wechat_articles_spider 等的文档明确记录了参数 4 小时过期、需代理池+随机延时的维护现状）。
- 社区"稳定方案"的本质：如 chrome-crawl 项目通过 Chrome  DevTools 协议（CDP）复用**本机真实 Chrome**（真实 TLS、真实 Cookie、真实会话），宣称 1100 篇公众号文章 0 触发反爬——但这只能在个人电脑上跑，**无法搬到无头服务器**。

**结论**：对公众号文章，浏览器端提取是在"用户已经合法打开页面"的前提下处理渲染后的 DOM，天然绕过上述全部问题；服务器端抓取公众号是一场持续的猫鼠游戏，2 核 4G 服务器上跑无头浏览器也不划算。

### 1.4 渠道一推荐方案

- **推荐实现**：自研 Manifest V3 扩展（Chrome/Edge 优先，Firefox 兼容）。content script 中用 `@mozilla/readability` 提取正文、Turndown 转 Markdown，后台 Service Worker 携带 `Authorization: Bearer <令牌>` 请求头 POST 到服务器 `/clip` 接口；正文图片在扩展端把 `data-src` 替换为真实 `src`，服务器收到后异步转存图片（带 Referer 下载 mmbiz 图链通常可行）。另备一个 Bookmarklet：一键把 `{url, title, 选中文字}` POST 到服务器，服务器用 trafilatura 兜底提取。
- **用户操作步数**：扩展 1 步（点工具栏图标或按快捷键）；书签小工具 1 步。
- **自研开发工作量**：扩展约 2–4 人日（manifest + 提取 + 请求 + 选项页存令牌 + 成败提示）；服务器接收接口 + trafilatura 兜底约 1 人日。
- **风险点**：① 开发者模式侧载扩展在 Chrome 重启时有警告提示（可接受或用企业策略）；② 严格 CSP 站点上书签小工具可能失效（有扩展兜底，影响小）；③ 服务器兜底抓取公众号链接会间歇失败——架构上明确：对 mp.weixin.qq.com 链接不做服务器抓取，标记为"待浏览器端补抓"。

---

## 渠道二：Android 手机随手速记

### 2.1 候选工具对比

**HTTP Shortcuts（Waboodoo/HTTP-Shortcuts，MIT 许可证，Google Play / F-Droid / GitHub Releases 均有）——首选**

- 成熟的"发任意 HTTP 请求"工具，支持 GET/POST/PUT 等全部方法、自定义请求头、自定义请求体、Basic/Digest 认证、静默执行（不弹响应）、桌面快捷方式与小部件、JSON/cURL 导入导出、与 Tasker 互调。
- **可作为系统分享目标**：创建一个全局变量并勾选"Allow 'Share...'（允许从分享对话框接收值）"，选择接收分享内容的文本、标题或两者；然后在快捷方式的 URL/请求头/请求体中用 `{}` 占位符插入该变量。分享文本/链接到 HTTP Shortcuts 后选择对应快捷方式即发送。这是官方 FAQ 明确支持的用法，linkding（知名自托管书签项目）的官方文档也提供了"Android 上用 HTTP Shortcuts 分享 URL"的配置教程，属于社区验证过的成熟组合。
- 变量类型含"文本输入（text input）"：桌面小部件点击后弹出输入框，确定后即发请求——天然支持纯文字速记。
- 鉴权：请求头加 `Authorization: Bearer <令牌>`，令牌建议存为"密码变量"。

**Tasker（付费闭源）**：自动化神器，可接收系统分享（分享到 Tasker 后选择任务，共享文本进入 `%astext` 等变量），HTTP 请求动作可完全自定义头/体。能力最强但配置复杂、需付费，适合已是 Tasker 用户的人。

**Termux:Widget + Termux（开源，极客向）**：桌面小部件执行 shell 脚本，可配合 `termux-clipboard-get` + curl 实现"复制→点小部件发送"。但 Termux 不直接注册为文本分享目标，且 Android 12+ 前台读剪贴板会弹系统提示，体验不如 HTTP Shortcuts。

**可直接用的开源速记客户端**：

| 项目 | 说明 | 评价 |
|---|---|---|
| **Moe Memos**（mudkipme/MoeMemosAndroid，GPL-3.0，Kotlin/Compose，F-Droid 可装） | 自托管 Memos 服务（usememos/memos，Go + SQLite）的安卓客户端；**分享菜单可保存文本、图片、网页**；支持离线写入、联网同步；Material You 设计 | 体验最完整的现成方案，但只说 Memos API，且 Memos 版本破坏性更新频繁（客户端标注支持 0.21 与 0.26–0.29，更新版本需 mortis 适配层）。用法：把 Memos 当"收件箱"部署，外脑再从 Memos 的 REST API 拉取 |
| **Markor**（gsantner/markor，开源） | 本地 Markdown/纯文本编辑器，支持"分享进入"新建笔记 | 配合 Syncthing 把笔记文件夹同步到服务器，可形成零 HTTP 开发的备选通道；无直接 POST 能力 |
| **JotDrop**（Diexar-Labs/jotdrop，MIT） | Obsidian 插件 + Android App + Chrome 扩展三件套，Android 端支持分享文本/链接/图片/语音 | 2026 年新项目，思路好（走 Syncthing 而非云 API），但成熟度待观察 |

备注：任务中提到的 Easydict 是 macOS 划词翻译工具，与 Android 无关；未发现"易笺"名下可配置自定义 API 端点的成熟安卓产品。flomo 有官方 API 但为商业云服务、不可自托管。

### 2.2 两种场景的具体操作流程

- **链接/文本分享**（在浏览器、知乎、微信读书等任意 App 中看到内容）：点系统"分享" → 选 **HTTP Shortcuts** → 选"发到外脑"快捷方式。从分享按钮算起共 3 步（分享→App→快捷方式），可配置为静默执行 + 一条 toast 确认。
- **纯文字速记**（脑中想法，无来源 App）：桌面放 HTTP Shortcuts 的速记小部件 → 点击弹出输入框 → 输入后确定即 POST。共 3 步；用 Moe Memos 则是点小部件→输入→保存，2–3 步。
- 重要平台限制：Android 10+ 后台读取剪贴板受限，**不要设计"复制链接后自动发送"的流程**，必须走分享菜单或前台输入小部件。

### 2.3 渠道二推荐方案

- **推荐实现**：HTTP Shortcuts 配置两个快捷方式——①"剪藏链接"（分享目标，POST JSON `{type:"link", text, title}`）；②"速记"（桌面小部件 + 文本输入变量，POST `{type:"note", text}`）；统一带 Bearer 令牌请求头。愿意多部署一个服务时，加 Moe Memos + 自托管 Memos 获得图片/网页分享能力，外脑从 Memos API 二次拉取。
- **用户操作步数**：链接分享 3 步；纯速记 3 步。
- **自研开发工作量**：服务器端一个带令牌校验的 `/capture` 接口约 1 人日；HTTP Shortcuts 端配置约 30 分钟，**无需写任何 Android 代码**；Memos 路线另加 Docker 部署 0.5 人日 + 拉取同步脚本 1–2 人日。
- **风险点**：① HTTP Shortcuts 为第三方 App（MIT 开源、审计友好，但令牌存于本机，丢手机需能吊销令牌）；② 国产 ROM 可能折叠分享菜单条目或杀后台，需允许自启动/电池白名单；③ Moe Memos 绑定 Memos API 版本，Memos 升级需联动测试。

---

## 渠道三：微信生态内容

### 3.1 公众号文章：微信内能直接分享到第三方 App 吗？

**不能。** 微信内文章页右上角"…"菜单只有发送给朋友、分享到朋友圈、收藏、复制链接、在浏览器打开等条目，**不弹出系统分享面板，第三方 App 无法作为分享目标**。这是微信一贯的封闭策略；open2share 等开源工具解决的是"微信里的文件分享不出去"，对文本/链接无效。微信内嵌浏览器对非白名单 URL Scheme/DeepLink 的拉起也做了拦截。

可行路径（本质都是复用渠道①②）：

1. **Android**：微信内"…"→"在浏览器打开" → 浏览器分享 → HTTP Shortcuts/外脑网页（约 4 步）；
2. **macOS**：微信里"复制链接"（经文件传输助手或手机分享到 Mac）→ 浏览器打开 → 扩展一键剪藏（约 3 步，最常用）；
3. 不推荐：复制链接后靠 App 后台读剪贴板自动发送（Android 限制，见 2.2）。

### 3.2 微信读书：书摘/划线导出

**官方通道（2026 年新增，推荐）**：2026 年 5 月微信读书官方发布 Skill（Tencent/WeChatReading）。在 `weread.qq.com/r/weread-skills` 微信扫码获取官方 API Key（`wrk-` 开头，环境变量 `WEREAD_API_KEY`），即可查询书架、阅读统计、**导出个人划线与想法**、章节进度、公开书评等。能力为**只读**：不能写笔记、不能导出书签正文（仅统计书签数量）。它本质是官方开放 API，除 AI 助手外也可被命令行/自研脚本直接调用，适合在服务器上跑定时同步。

**非官方通道（灰色，不建议作为依赖）**：

- arry-lee/wereader（Python，该类项目起源）；
- Higurashi-kagome/wereader（Chrome/Firefox 扩展，功能全：一键导出标注/想法/目录、自定义模板），其 README 明确警告"有用户反馈获取标注有封号风险（issue #121），请酌情使用"；
- mcp-server-weread、weread-mcp 等模型上下文协议（MCP，Model Context Protocol）服务：用 Cookie 模拟登录网页版接口；
- KOReader/Kobo"微读插件"：导出书籍到本地，插件作者自己提示"用多了可能封号"。

**风险现状**：2026 年 7–8 月出现微信读书封号潮（大量用户被强制登出、笔记资产无法访问、申诉无人工渠道）。官方唯一公开口径是：封号针对**"违规爬取书籍并传播"的数据获取行为**，而非阅读行为本身；社区排查中第三方插件、浏览器挂网页版接口被列为高危因素。

结论：用官方 API Key 在服务器做**低频、只拉自己笔记数据**的定时同步（如每周一次），稳定合规；Cookie 模拟类插件停止作为常规通道，尤其不要碰书籍全文批量下载。官方 Skill 与"爬书传播"性质不同，但仍应控制频率。

### 3.3 "微信→服务器"输入通道方向辨析（关键：多数只能推不能收）

| 通道 | 方向 | 能否作为输入通道 | 说明 |
|---|---|---|---|
| 企业微信群机器人 webhook | 服务器 → 微信群 | ❌ 不能 | 你向 webhook 地址 POST，机器人往群里发消息；没有任何接收消息的能力 |
| Server 酱（ServerChan）/ PushPlus / WxPusher | 服务器 → 微信个人号 | ❌ 不能 | 均为单向推送（经官方公众号/服务号下发模板消息），**不提供用户消息回传** |
| **企业微信自建应用"接收消息"** | 微信 ↔ 服务器 | ✅ **可以（官方双向能力）** | 用户在企业微信 App 里给自建应用发文本/链接/图片，腾讯以 HTTP POST 回调到你配置的服务器 URL；需通过 GET 验证（echostr 解密、1 秒内响应），消息体用 Token/EncodingAESKey 加解密，官方提供各语言加解密库；外发 API 需把服务器公网 IP 加入"企业可信 IP"白名单（阿里云 IP 加入即可）。个人可免费注册企业微信（未认证功能受限，但自建应用收发消息可用）。回调 URL 支持 http/https（官方建议 https、示例均为默认 80/443 端口，无域名用 IP+非标端口需实测）；另有"企业微信智能机器人"**长连接模式**（WebSocket 连 `wss://openws.work.weixin.qq.com`），无需公网回调 URL，适合无域名场景（开放资格需实测） |
| 微信个人号 / 文件传输助手 | — | ❌ 不可行 | 无任何官方 API；wechaty/itchat 等基于网页微信/Pad 协议的方案随微信收紧已大面积失效，封号风险高 |
| 个人订阅号开发者模式 | 微信 → 服务器 | △ 理论可行不推荐 | 粉丝发消息可回调服务器，但个人主体接口权限少、需默认端口与 URL 校验，相比企业微信自建应用无优势 |

### 3.4 渠道三推荐方案

- **推荐实现**：
  - 公众号文章：不做任何微信内通道，复用渠道①（Mac 扩展剪藏）和渠道②（Android"在浏览器打开"后分享）；
  - 微信读书笔记：官方 API Key + 服务器定时任务（每周拉取全部划线/想法入库），0 用户操作；
  - 可选增强：若需要"微信里发一句话/一个链接就入库"，注册企业微信 → 创建自建应用 → 配置"接收消息"回调（或长连接模式），在企业微信 App 里给该应用发消息即入库，公众号链接也可转发给它。
- **用户操作步数**：公众号文章 3–4 步；微信读书 0 步（自动同步）；企业微信直发 2 步（打开应用→发消息）。
- **自研开发工作量**：微信读书官方 API 同步脚本约 0.5–1 人日（可直接参考官方 Skill 包的接口封装）；企业微信回调接收端约 1–2 人日（官方有 Python 等加解密库）。
- **风险点**：① 企业微信回调依赖腾讯平台规则，未认证个人企业的功能边界可能变化；② 微信读书官方 API 的条款与频率限制可能调整，但稳定性比 Cookie 方案高一个数量级；③ 切勿把群机器人/Server 酱误当输入通道做架构设计——它们永远是单向推送；④ 个人号逆向（wechaty 类、文件传输助手 hook）是已被证伪的路径，明确排除。

---

## 总体推荐架构

三条渠道统一收敛到服务器的 `/capture` 接口（Bearer 令牌鉴权，JSON 入参）：

1. **macOS**：浏览器扩展（Readability + Turndown 浏览器端提取 Markdown 全文）为主力，书签小工具兜底发 URL，服务器 trafilatura 仅对普通站点兜底（公众号链接不做服务器抓取）；
2. **Android**：HTTP Shortcuts 分享菜单快捷方式 + 桌面速记小部件，零 Android 开发；
3. **微信生态**：不做任何逆向——公众号文章复用渠道 1/2；微信读书走官方 API Key 定时同步；可选企业微信自建应用回调作为"微信内直发"入口。

---

## 参考链接

**正文提取与浏览器剪藏**
- Mozilla Readability（GitHub）：https://github.com/mozilla/readability
- trafilatura 官方文档（含基准评估页）：https://trafilatura.readthedocs.io/en/latest/evaluation.html
- trafilatura（GitHub）：https://github.com/adbar/trafilatura
- ScrapingHub 文章提取基准：https://github.com/scrapinghub/article-extraction-benchmark
- readability-lxml / python-readability（GitHub）：https://github.com/buriy/python-readability
- go-readability（原仓库，2025-12 已归档）：https://github.com/go-shiori/go-readability ；维护中的分叉：https://github.com/jobindex-open/go-readability
- SIGIR 2025《Multilingual Benchmarking of Main Content Extractors》（含中文 F1 数据）：https://maurelf.users.greyc.fr/docs/conferences/SIGIR_2025_paper_1968.pdf
- chrome-crawl（复用真实 Chrome 经 CDP 抓公众号文章的思路与反爬分析）：https://github.com/evan966890/chrome-crawl
- 公众号爬虫反爬与凭证时效分析（CSDN 问答）：https://ask.csdn.net/questions/9465588 、https://blog.csdn.net/gitblog_00424/article/details/155954032

**Android 速记**
- HTTP Shortcuts（GitHub）：https://github.com/Waboodoo/HTTP-Shortcuts
- HTTP Shortcuts 官方 FAQ（分享文本配置）：https://http-shortcuts.rmy.ch/faq#share-text
- HTTP Shortcuts 分享用法讨论（#526）：https://github.com/Waboodoo/HTTP-Shortcuts/discussions/526
- linkding 官方文档"在 Android 上用 HTTP Shortcuts"：https://github.com/sissbruecker/linkding/blob/master/docs/src/content/docs/how-to.md#using-http-shortcuts-app-on-android
- Moe Memos 安卓客户端（GitHub）：https://github.com/mudkipme/MoeMemosAndroid ；F-Droid 页：https://f-droid.org/packages/me.mudkip.moememos/
- Memos 自托管服务（GitHub）：https://github.com/usememos/memos
- Markor（GitHub）：https://github.com/gsantner/markor
- JotDrop（GitHub）：https://github.com/Diexar-Labs/jotdrop
- open2share（微信文件分享出站工具，F-Droid）：https://f-droid.org/en/packages/top.linesoft.open2share/

**微信生态**
- 微信读书官方 Skill 配置入口（扫码获取 API Key）：https://weread.qq.com/r/weread-skills
- 微信读书官方 Skill 体验报道（InfoQ）：https://xie.infoq.cn/article/d5ba35f9f7c883fdb8c5c7ddf
- wereader 浏览器扩展（含封号风险提示）：https://github.com/Higurashi-kagome/wereader
- wereader Python 起源项目：https://github.com/arry-lee/wereader
- 微信读书 2026 封号潮与官方口径报道（什么值得买）：https://post.m.smzdm.com/p/awwk492m/
- 企业微信"接收消息"官方文档：https://developer.work.weixin.qq.com/document/path/90238
- 企业微信自建应用回调配置实操教程：https://blog.csdn.net/m0_37888039/article/details/159613713
- 企业微信长连接/回调模式接入参考（blockcell 文档）：https://github.com/sky6776/blockcell/blob/main/docs/channels/zh/06_wecom.md
