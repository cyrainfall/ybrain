# 安卓捕获：HTTP Shortcuts 配置（票据 21）

用 [HTTP Shortcuts](https://http-shortcuts.rmy.ch/)（[Play 商店](https://play.google.com/store/apps/details?id=ch.rmy.android.http_shortcuts) / [F-Droid](https://f-droid.org/en/packages/ch.rmy.android.http_shortcuts/)）把安卓的**系统分享菜单**和**桌面速记小部件**接到 ybrain 的 `/capture`。除三段脚本要粘，其余全是点选；也可以直接导入本目录的 [`android-shortcuts.json`](android-shortcuts.json) 一步到位。

目标效果（对应验收 B3/B4）：

- 分享纯文字 → 落 `0-Inbox/`，`source: android`、`type: note`；
- 分享链接 → `type: clip`：服务器抓正文，抓不到就落"仅链接"笔记（`fetch_failed: true`）；
- 失败重试 2 次（共 3 次尝试），仍失败发系统通知。

接口契约见 [.scratch/exobrain/prototypes/capture-api.md](../../../.scratch/exobrain/prototypes/capture-api.md)，服务端实现见 [../src/capture.ts](../src/capture.ts)。

## 一、先在服务器上备好两个值

1. **tailnet 地址**（业务端口只绑 Tailscale 网卡，公网打不通）：

   ```bash
   sudo ip -4 addr show tailscale0 | grep inet     # 形如 inet 100.64.0.1/32
   ```

2. **android 渠道令牌**：

   ```bash
   sudo grep CAPTURE_TOKEN_ANDROID /opt/ybrain/.env
   ```

   没配过就先补一个（三渠道令牌各自独立、可单独吊销，别复用 web 的）：

   ```bash
   echo "CAPTURE_TOKEN_ANDROID=$(openssl rand -hex 24)" | sudo tee -a /opt/ybrain/.env
   cd /opt/ybrain && sudo docker compose up -d      # 改完 .env 必须重建容器才生效
   ```

3. 手机侧前置：已加入 tailnet（[README](README.md) 第四节第 8 步），并且 **Tailscale 常开**——安卓设置 → 网络和互联网 → VPN → Tailscale → 打开「始终开启的 VPN」（顺手勾上「阻止未使用 VPN 的连接」，免得切网时代理绕过）。安卓同时只能有一个 VPN，装了别的代理/加速应用时要先关掉。

4. 手机浏览器打开 `http://<tailnet-ip>:8787/capture`，看到 `{"error":"not found"}`（404）就说明链路通了；连不上先解决 Tailscale，后面的步骤不用试。

## 二、路线 A：导入现成配置（推荐）

配置已写好放在 [`android-shortcuts.json`](android-shortcuts.json)（单个快捷方式 + 三个变量，导入格式 version 92 / 兼容 90）。导入后只剩两个值要填。

1. 把 JSON 传到手机（任选其一）：`adb push`；微信/网盘/邮件传给自己；或 Mac 上 `cd packages/ybrain/deploy && python3 -m http.server 8000`，再用下面的 URL 导入（Mac 与手机在同一 Wi-Fi，或用 Mac 的 tailnet 地址）。
2. HTTP Shortcuts → 右上角 **⋮** → **导入/导出** → **从文件导入**（或 **从 URL 导入**，填 `http://<mac-ip>:8000/android-shortcuts.json`）。
3. 回到主界面 → **⋮** → **变量**，编辑两个值：
   - `ybrain_host`：改成 `http://<tailnet-ip>:8787`；
   - `ybrain_token`：填 `CAPTURE_TOKEN_ANDROID`（该变量标了"机密"且不随导出外带，导入后是空的）。
4. 主界面出现分类 **外脑** → 快捷方式 **发到外脑**。跳到 [第四节](#四接分享菜单与桌面小部件) 接分享菜单。

> 导入后 URL、令牌、请求体里看到的是 `{{变量id}}` 这种写法，这是应用自身导出的原生格式；手工按路线 B 填时用 `{ }` 按钮插入变量即可（界面显示为单花括号 + 变量名）。两种写法都有效，就是别手打。

## 三、路线 B：手工创建

界面文案取自应用简体中文（不同版本措辞可能略有差异）。先建三个**全局变量**（⋮ → 变量 → **+**）：

| 变量名         | 类型     | 关键设置                                                                                                                                                        |
| -------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ybrain_host`  | 常量     | 值 `http://<tailnet-ip>:8787`                                                                                                                                   |
| `ybrain_token` | 常量     | 值 = `CAPTURE_TOKEN_ANDROID`；勾选「将值视为机密」+「从导出中排除存储值」                                                                                       |
| `share_text`   | 文本输入 | 高级设置里勾选「允许"共享"」；勾「多行」；对话框标题填 `记录到外脑`，说明随便写一句（导入版填的是「从别的应用分享时会自动带入；直接点快捷方式则在这里输入。」） |

`share_text` 是分享入口的关键：勾了「允许共享」，系统分享文本时会临时把值灌进这个变量（不落库）；**至少要有一个快捷方式用到它**，否则分享面板里不会出现这个快捷方式。

再建快捷方式（**+ → 从头创建**，名称 `发到外脑`），逐块填：

| 区块            | 填写内容                                                                                                                                  |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| 基础请求        | 方法 `POST`；URL：点 `{ }` 插入变量 `ybrain_host`，写成 `{ybrain_host}/capture`                                                           |
| 认证            | 认证方式：**令牌认证**（Bearer）；令牌：插入变量 `ybrain_token`                                                                           |
| 请求体/请求参数 | 请求体类型：**自定义类型**；内容类型(Content-Type)：`application/json`；请求体：点 `{ }` 选「本地变量」新建 `payload`，写成 `{{payload}}` |
| 响应处理        | 显示类型：`Toast`；成功时、失败时都选「什么都不显示」（提示交给脚本）                                                                     |
| 脚本编写        | 三段都填，见下                                                                                                                            |
| 触发器&执行设置 | 勾上「离线时等待网络连接」；「允许通过第三方应用…或 Direct Share 使用快捷方式」默认已开，保持开启                                         |
| 高级设置        | 超时时间改成 `20000` 毫秒                                                                                                                 |

`payload` 是**本地变量**：不用预先在变量列表里创建，在请求体里插入占位符后由脚本 `setVariable` 赋值，只在本次执行内有效。占位符两种写法别混：全局变量（如 `ybrain_host`）用**单花括号** `{ybrain_host}`，本地变量用**双花括号** `{{payload}}`；拿不准就点 `{ }` 按钮插入，别手打。

**执行前（Run before execution）**——判断是链接还是文字，并拼出请求体（用 `JSON.stringify` 转义，避免笔记里有引号/换行时拼坏 JSON）。下面这段与 [`android-shortcuts.json`](android-shortcuts.json) 里的实现逐字一致，改的时候两边一起改（导入路线以 JSON 为准）：

```js
// 把分享进来的文本（或手动输入的速记）组装成 /capture 请求体
// 纯链接 → type: clip（服务器抓正文，失败落仅链接）；其余 → type: note
const text = getVariable("share_text").trim()
const isLink = /^https?:\/\/\S+$/.test(text)
const payload = {
  source: "android",
  type: isLink ? "clip" : "note",
  created: new Date().toISOString(),
  url: isLink ? text : undefined,
  body: isLink ? undefined : text,
}
setVariable("payload", text === "" ? "" : JSON.stringify(payload))
```

**成功时（Run on success）**：

```js
showToast("已发到外脑")
```

**失败时（Run on failure）**——HTTP Shortcuts 没有内置重试，用脚本补 2 次：

```js
// 重试 2 次（共 3 次尝试）；HTTP Shortcuts 没有内置重试，用脚本补
// 注意：代码块按"程序"执行而不是函数，顶层 return 会报 "return not in a function"，所以用 if/else + break
if (getVariable("payload") === "") {
  showToast("没有可发送的内容")
} else if (getVariable("ybrain_token") === "") {
  showToast("外脑未配置：请在变量里填 ybrain_token")
} else {
  const url = getVariable("ybrain_host") + "/capture"
  const headers = { Authorization: "Bearer " + getVariable("ybrain_token"), "Content-Type": "application/json" }
  let recovered = false
  for (let attempt = 1; attempt <= 2; attempt++) {
    wait(attempt * 2000)
    const result = sendHttpRequest(url, { method: "POST", headers: headers, body: getVariable("payload") })
    if (result.status === "success") {
      recovered = true
      showToast("已发到外脑（第 " + (attempt + 1) + " 次尝试成功）")
      break
    }
  }
  if (!recovered) {
    showNotification(
      "外脑：捕获失败",
      "重试 2 次仍未成功。检查 Tailscale 连接与 ybrain_token；内容仍在原来分享它的应用里。",
    )
  }
}
```

## 四、接分享菜单与桌面小部件

- **分享菜单**：任意应用 → 分享 → 在分享面板里找 **HTTP Shortcuts**。因为只有一个快捷方式用到 `share_text`，不会再弹"选哪个快捷方式"，直接执行。
- **桌面小部件**（速记入口）：长按桌面空白 → **小部件** → **HTTP Shortcuts** → 拖「可制定的小部件」到桌面并选中「发到外脑」。点它会弹出文本输入框（`share_text` 的文本输入类型），输入即发送。也可以用应用里的「创建小部件」。
- **通知权限**：第一次走到失败通知时会请求通知权限，允许。
- **微信里的内容**（MVP 降级方案）：会话里的文字灵感复制后用桌面小部件粘贴发送；公众号文章先在浏览器打开，再分享链接给快捷方式（服务器抓公开链接）。

## 五、验证（B3/B4）

1. B3：在备忘录里分享一段纯文字 → 10 秒内服务器出现新笔记：

   ```bash
   ls -lt /opt/ybrain/vault/0-Inbox/ | head -3
   head -20 /opt/ybrain/vault/0-Inbox/<最新文件>.md    # 期望 source: android、type: note
   ```

2. B4：在浏览器里分享一个链接 → 新笔记 `type: clip`：抓到正文则正文入档，抓不到则 `fetch_failed: true` + 仅链接（不丢内容）。

3. 不想掏手机时，先确认服务端契约本身是好的（同一条链路，只是没有安卓那一段）：

   ```bash
   curl -sS -H 'Authorization: Bearer <CAPTURE_TOKEN_ANDROID>' -H 'Content-Type: application/json' \
     -d '{"source":"android","type":"note","body":"来自 curl 的速记"}' \
     http://<tailnet-ip>:8787/capture      # 期望 {"ok":true,"note_id":"...","path":"0-Inbox/..."}
   ```

## 六、常见问题

- **分享面板里找不到 HTTP Shortcuts**：应用提示"没找到合适的快捷方式"时，检查 `share_text` 是否勾了「允许共享」，以及快捷方式里是否有 `getVariable("share_text")` 或 `{share_text}` 的引用。
- **401**：`ybrain_token` 与服务器 `.env` 里的 `CAPTURE_TOKEN_ANDROID` 不一致；或改了 `.env` 没执行 `docker compose up -d`。轮换令牌时两边一起改，改完手机端只需更新变量。
- **400**：请求体为空（`share_text` 没拿到值，例如手动点快捷方式后取消了输入框）。
- **报 `JavaScript错误… return not in a function`**：脚本代码块按"程序"执行而不是函数，顶层 `return` 非法；用 `if / else if / else` + 循环里 `break` 代替（本目录的脚本已经这么写）。
- **分享的链接没去抓正文**：只有"整段就是一个链接"才判 `clip`。有的应用会把标题和链接一起塞进分享文本，这种会按文字落 `note`（内容不丢，只是不抓正文）；想抓正文就分享纯链接。
- **总是失败但服务器日志里什么都没**：手机到服务器不通 —— Tailscale 掉线，或另一个 VPN/代理应用占着 VPN 通道。
- **看失败原因**：应用主菜单 → **故障排查** → **Event History**（列出每次触发、请求、响应与错误）。临时核对响应时，把「响应处理」的显示类型改成「全屏窗口」并勾「显示元数据信息」。
- **Mac 上遇到 502** 与本配置无关，是代理没绕过 `100.64.0.0/10`，见 [README 第六节第 7 条](README.md#7-剪藏--捕获返回-502本机代理没绕过-tailscale-网段)。

## 七、字段对照（这份配置到底发了什么）

| 快捷方式字段      | 值                            | 说明                                                                            |
| ----------------- | ----------------------------- | ------------------------------------------------------------------------------- |
| URL / 方法        | `{ybrain_host}/capture`、POST | 只在内网可达                                                                    |
| 认证              | Bearer `{ybrain_token}`       | 对应服务端 `CAPTURE_TOKEN_ANDROID`                                              |
| 请求体            | `{{payload}}`（脚本生成）     | `JSON.stringify` 保证转义正确                                                   |
| `created`         | `new Date().toISOString()`    | 捕获时刻由客户端给（与浏览器扩展同一约定）；脚本重发的 2 次沿用同一份 `payload` |
| 响应处理          | Toast + 成功/失败都不显示     | 成功/失败提示由脚本给，不把原始响应糊到脸上                                     |
| `waitForInternet` | 开                            | 断网时排队，联网后重跑                                                          |
| 失败脚本          | 重试 2 次 → 通知              | 应用没有内置重试                                                                |

服务端对未知字段不敏感，`type` 之外的归类、标签、摘要都交给提炼员（票据 24）。
