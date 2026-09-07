# 无域名、无 ICP 备案场景下安全访问阿里云个人服务的方案调研

> 调研时间：2026-09。资料优先取自官方文档与 2025–2026 年的实践文章，链接见文末。

## 0. 背景与约束

- 服务器：阿里云中国大陆地域，约 2 核 CPU、4G 内存，有公网 IP，**无域名、不做 ICP（网络内容服务商）备案**。
- 服务：Docker 运行的个人"外脑"——笔记捕获 API（应用程序编程接口）、知识库问答 Web 界面。
- 客户端：Android 手机、macOS 电脑。
- 目标：服务**不裸露公网**，安全、稳定、日常使用省心。

### 理解这类方案的关键：三个平面

以 Tailscale/Headscale 为代表的组网工具把网络分成三层，评估任何方案都可以套这个模型：

| 平面 | 作用 | 是否承载业务数据 |
|---|---|---|
| 控制面（Control Plane） | 设备注册、密钥分发、下发"谁在网络里"的路由表 | 否，仅少量信令 |
| 数据面（Data Plane） | 设备间实际通信，WireGuard（一种现代虚拟专用网络协议）端到端加密 | 是，优先点对点直连 |
| 中继面（Relay Plane） | 点对点打洞失败时兜底转发**已加密**的密文，Tailscale 中称 DERP（Designated Encrypted Relay for Packets，指定加密包中继），配合 STUN（Session Traversal Utilities for NAT，NAT 穿透探测协议） | 仅兜底 |

**本场景的一个天然优势**：阿里云服务器本身有公网 IP、不处于 NAT（网络地址转换）之后。客户端（手机/电脑）主动向服务器的公网 IP 发起 WireGuard 握手即可直连，**客户端→服务器这条主链路几乎永远不需要中继**。中继质量只影响"手机↔电脑"这种两端都在 NAT 后的互访。

---

## 1. 方案一：裸公网 IP + 自定义端口 + 长随机令牌（HTTP 明文）

即把 Docker 服务直接映射到公网端口，靠一个长随机访问令牌（Token）鉴权，全程 HTTP 明文。

### 风险分析

1. **明文可被嗅探与篡改**。HTTP 下令牌（无论放在 URL、请求头还是消息体）在链路上全程明文：咖啡馆/机场公共 Wi-Fi、运营商链路、恶意代理出口都能直接看到令牌和知识库内容；TLS（传输层安全协议）的完整性保护也没有，内容可被中间人篡改。
2. **令牌的泄露渠道远比想象多**：浏览器历史记录、访问日志/反向代理日志、Web 页面加载外部资源时的 Referer 头、截图、URL 分享、手机笔记同步等。长随机令牌只防"猜"，防不了"漏"。
3. **扫描器是常态化的**。整个 IPv4 地址空间被 Shodan/Censys 及各类僵尸网络持续扫描，一个开放的公网端口通常数小时内就会被探测、指纹识别和漏洞试探。自定义高端口只能挡最懒的扫描，不能隐藏服务。
4. **知识库 Web 界面的账号密码同样明文传输**，等于把第二道防线也废掉。
5. **阿里云安全组的局限**：安全组默认拒绝入站、可按源 IP 白名单放行，但手机流量走运营商 CGNAT（运营商级 NAT，大量用户共享出口 IP），出口 IP 经常变化，白名单对手机场景基本不可维护；白名单配 0.0.0.0/0 等于完全敞开。

### 什么情况下勉强可接受

仅限**临时、数据不敏感**的场景，且同时做到：安全组只对少量固定办公/家庭宽带 IP 放行、令牌设置短有效期、服务本身无个人隐私数据、用完即关。即便如此，零成本的升级路径是 SSH 隧道（见方案五）或自签 HTTPS——所以该方案**不推荐用于长期运行的个人外脑**。

---

## 2. 方案二：Tailscale 官方托管控制平面

Tailscale 是基于 WireGuard 的零配置组网服务：客户端登录官方控制面（`controlplane.tailscale.com`）后自动组网，数据面 WireGuard 端到端加密，官方服务器看不到业务内容。

### 中国大陆连通性现状（2025–2026 实测反馈）

- **控制面**：`login.tailscale.com` / `controlplane.tailscale.com` 等域名在国内**可访问但不稳定**，国内实践文章普遍反映"握手慢、偶发失败"，注册/登录阶段体验取决于网络环境；2025 年 7 月起官方为这些域名分配了固定 IP 段（IPv4 `192.200.0.0/24`），但并未改善跨境链路质量。
- **登录方式**：支持 GitHub / Microsoft / Google / Apple 等第三方 SSO（单点登录）。国内网络下 Google 不可用，GitHub、Microsoft 账号通常可用。
- **官方 DERP 中继**：节点全部在境外，离大陆最近的是香港。实测中继延迟约 110–420ms（香港约 110ms，东京约 190ms，美西约 200ms+），打洞失败走中继时体感明显变慢。
- **直连成功率**：一旦打通点对点直连，延迟可低至 12–29ms，与裸链路无异。本场景中服务器有公网 IP，客户端→服务器直连几乎必然成功；且 Tailscale 1.86 起支持 Peer Relay（可指定自己 tailnet 内的节点做中继），进一步降低对境外 DERP 的依赖。
- **客户端**：macOS（App Store / Homebrew）、Android（Google Play / F-Droid / 官方直装 APK，对无 GMS 的国产手机友好）均为官方维护，成熟稳定。
- **免费额度**：2025 年改版后 Personal 免费档为**个人设备不限数量、最多 6 名用户**（旧版文档中的 100 台/3 人、更早的 20 台限制均已成为历史；旧套餐页显示 20 台设备的是 legacy 计划），个人使用完全够用。

### 五维评估

| 维度 | 评价 |
|---|---|
| 连通性 | 数据面直连优秀；控制面与境外 DERP 在国内不稳定，但本场景主链路（客户端↔公网服务器）不依赖中继 |
| 配置复杂度 | 极低，三端都是"安装→登录" |
| 日常体验 | Android/macOS 均可设为开机自启/始终开启的 VPN（虚拟专用网络），之后访问 `100.x` 地址无需任何手动操作 |
| 安全性 | WireGuard 端到端加密；默认 tailnet 内设备互通，可配 ACL（访问控制列表）收敛；需在后台对服务器节点勾选 Disable key expiry，否则约 180 天密钥过期需重新浏览器认证 |
| 维护成本 | 近乎为零；唯一隐忧是控制面在境外，未来若被封锁或服务变更策略，已有节点可能无法重新认证 |

---

## 3. 方案三：Headscale（Tailscale 控制平面开源自建）

Headscale 是 Tailscale 控制服务器的开源实现（BSD-3 许可），**客户端照用官方 Tailscale App**，无设备数限制，控制面完全掌握在自己手里。

### 在本台服务器上自建的可行性

- **可以只用公网 IP、不需要域名和备案**。Headscale 的 `server_url` 支持直接写 `http://<公网IP>:8080`，国内大量实践验证可行。
  - 原理上的安全边界：客户端与控制面之间运行 ts2021 Noise 协议，HTTP 之上还有一层端到端 Noise 加密与双向密钥认证；但**首次注册时缺少服务端身份校验，存在理论上的中间人劫持（MITM）风险**，嵌入式 DERP 的 WebSocket 也会退化为明文承载（内容仍是 WireGuard 密文）。在可信网络下完成首次注册即可规避大部分风险。
  - 更稳妥的做法是**自建 CA（证书颁发机构）签发 SAN 含 IP 的证书**（命令见第 7 节），控制面走 HTTPS。macOS/Linux 导入 CA 很简单；Android 早期版本不信任用户安装的 CA（Tailscale issue #8085），该问题已修复，新版 Android 客户端会读取用户凭据库中的 CA。
- **嵌入式 DERP + STUN**：Headscale 内置 DERP 中继与 STUN 服务，随容器一起启动，监听 TCP 8080（控制面+中继复用）与 UDP 3478（STUN）。可在配置里关掉官方 DERP map（`urls: []`、`paths: []`），彻底不依赖境外节点。
- **MagicDNS 不受影响**：`100.100.100.100` 本机解析器由 NetMap 直接下发主机名，不需要公网 DNS（域名系统），`base_domain` 随便取内部名即可。
- **资源占用**：Headscale 是 Go 单二进制 + SQLite，2C4G 机器上与 Docker 业务并存毫无压力。
- **客户端支持**：
  - **Android**：官方 Tailscale App（Play Store / F-Droid / 直装 APK）原生支持"Use an alternate server"（使用备用服务器）填入 Headscale 地址，也支持"Use an auth key"直接粘贴预认证密钥注册，无需浏览器。
  - **macOS**：GUI 在 Settings → Accounts 左下角下拉菜单添加自定义控制服务器；也可用命令行 `tailscale login --login-server=<URL>`。
  - 即官方客户端对自建控制面的支持是**一等公民**（官方文档 2026-01 仍在维护该页面），不需要第三方魔改客户端。
- **注意事项**：Headscale 版本升级需跟随 Tailscale 客户端特性；若前面套 Nginx 反向代理必须开启 WebSocket 升级，且 UDP 3478 不能走 HTTP 反代、需在安全组直接放行。

### 五维评估

| 维度 | 评价 |
|---|---|
| 连通性 | 控制面、中继全在国内自己的服务器上，注册与组网稳定；客户端↔服务器 WireGuard 直连，手机↔电脑兜底中继也走国内链路 |
| 配置复杂度 | 中等：Docker Compose 起一个容器 + 改一份 YAML + 安全组放行 3 个端口，约 30–60 分钟 |
| 日常体验 | 与官方 Tailscale 完全一致：一次登录长期在线（Headscale 默认无密钥过期问题），手机设始终开启 VPN 后零操作 |
| 安全性 | 数据面 WireGuard 端到端加密；控制面自控，元数据不出境；服务端口不对公网开放 |
| 维护成本 | 低：偶尔升级容器镜像、备份 SQLite 数据目录即可 |

---

## 4. 方案四：ZeroTier（+ 自建 moon 节点）

ZeroTier 是另一个成熟的 P2P（点对点）虚拟局域网工具，使用自有协议（非 WireGuard），网络控制器为官方 SaaS（`my.zerotier.com` / `central.zerotier.com`，在境外）。

### 国内连通性与 moon 节点

- 官方根节点（Planet）在境外，国内直连/P2P 失败时中继延迟高。官方推荐自建 **moon 节点**（私有中继）：在有公网 IP 的云服务器上安装 ZeroTier，生成 moon 签名文件（`zerotier-idtool initmoon/genmoon`，`stableEndpoints` 填公网 IP/9993），放行 **UDP 9993**，客户端执行 `zerotier-cli orbit <moonID> <moonID>` 即可就近中继。
- **本场景同样可以在这台阿里云上自建 moon**，但控制器（成员授权、网络管理）仍在境外，注册授权依赖 `my.zerotier.com` 的可达性。
- **免费额度**：官方文档表述为免费档最多 25 台设备（2025 年新定价页显示 Personal 免费档约 10 台、1 个网络），个人够用。
- **Android 客户端**：有官方 App，但 App 只提供加入网络的入口，**没有 orbit moon 的命令行入口**，不 root 的情况下难以让手机使用自建 moon（需 root 后放置 `.moon` 文件）；手机↔公网服务器的 P2P 直连不依赖 moon，但手机↔电脑兜底中继会回落境外。
- 配置链路比 Headscale 长（建网→授权→建 moon→每台客户端 orbit），且 ZeroTier 协议为自有实现、审计透明度不如 WireGuard。

### 五维评估

| 维度 | 评价 |
|---|---|
| 连通性 | P2P 直连与 Tailscale 相当；控制器在境外、Android 用自建 moon 麻烦 |
| 配置复杂度 | 中偏高：moon 生成/签名/分发步骤繁琐，每台客户端都要 orbit |
| 日常体验 | 桌面端与 Tailscale 接近；Android 端 moon 配置是硬伤 |
| 安全性 | 默认加密（AES-256/ECC-256），但自有协议、控制器在境外 |
| 维护成本 | 中等：moon 文件、客户端 orbit 状态都要维护 |

---

## 5. 方案五：备选——SSH 隧道与 frp

### 5.1 SSH 隧道（零新增基础设施）

SSH 本身就是加密隧道，且 SSH 服务对公网开放（密钥认证 + fail2ban）是业界成熟做法：

- **macOS**：系统原生 `ssh`，开箱即用：
  ```bash
  # 本地端口转发：把服务器上的 Web/API 端口映射到本机
  ssh -N -L 8000:127.0.0.1:8000 -L 3000:127.0.0.1:3000 user@<服务器公网IP>
  # 或动态转发（SOCKS 代理，浏览器配 127.0.0.1:1080）
  ssh -N -D 1080 user@<服务器公网IP>
  ```
  可用 `autossh` 保活、launchd 自启。
- **Android**：Termux 中 `pkg install openssh` 后命令同上；或用 JuiceSSH / OpenJuiceSSH 等图形客户端，界面里可配置本地/远程/动态（SOCKS）端口转发。
- **体验**：每次访问前要先建立隧道（手机上要打开 App 连一下，后台还可能被系统杀掉），适合**应急运维**，不适合日常高频打开知识库。
- **安全性**：高。密钥认证、禁用密码登录后，SSH 是少数可以放心暴露公网的服务；业务端口本身完全不对公网开放。

### 5.2 frp 反向代理

frp 的架构是 `frpc`（内网客户端）把内网服务反向映射到跑在公网机器上的 `frps`。**它解决的是"服务藏在 NAT 后面、没有公网 IP"的问题**；而本场景的服务就跑在那台公网服务器上，frp 属于多此一举——用了 frp 反而要在公网机器上再开一组 frps 端口。

- frps **需要一台有公网 IP 的机器**（这台阿里云本身即可，不需要第二台）；TCP 类型隧道**不需要域名**（域名仅在按 HTTP 虚拟主机路由时才需要）。
- 结论：本场景不采用；若未来要把家里/办公室内网的机器也接入，可在阿里云上跑 frps 作为补充手段。

---

## 6. 综合对比与推荐

| 方案 | 国内连通性 | 配置复杂度 | 手机日常体验 | 安全性 | 维护成本 |
|---|---|---|---|---|---|
| 裸公网 HTTP + 令牌 | 最好（但裸奔） | 极低 | 打开网址即用 | ✗ 明文+令牌易泄露+扫描 | 低 |
| Tailscale 官方 | 直连好；控制面/中继境外不稳 | 极低 | 始终在线，零操作 | 高（WireGuard） | 近零，受境外政策影响 |
| **Headscale 自建** | **全链路国内自控，稳定** | **中等** | **始终在线，零操作** | **高（WireGuard+控制面自控）** | **低** |
| ZeroTier + moon | 控制器境外；Android moon 难配 | 中偏高 | 桌面好，手机一般 | 较高（自有协议） | 中 |
| SSH 隧道 | 好（SSH 端口稳定可达） | 低 | 每次先连隧道，适合应急 | 高 | 低 |
| frp | 好 | 中 | 服务已在公网机上，不适用 | 中（仍暴露 frps 端口） | 中 |

### 首选推荐：Headscale 自建（Docker 部署在阿里云本机）+ 官方 Tailscale 客户端

理由：

1. **无域名、无备案即可落地**（`server_url` 直接用公网 IP），完全满足约束；
2. **控制面和中继都在国内自己的机器上**，不依赖任何境外服务的可达性，不存在"哪天官方控制面被墙就全网掉线"的尾部风险；
3. **客户端全是官方 Tailscale App**（Android 支持备用服务器与预认证密钥、macOS 原生支持），无需魔改客户端，长期维护有保障；
4. 服务器有公网 IP，客户端→服务器**天然 WireGuard 直连**，速度等于裸链路；手机↔电脑兜底也走自建国内 DERP；
5. 业务端口（API、Web）**只监听 Tailscale 虚拟网卡**，公网安全组里彻底不开，实现"服务不裸露公网"的目标；
6. Headscale 资源占用极小，2C4G 机器毫无压力，数据面端到端加密、元数据不出境。

**备选 A（想先零成本验证）**：直接用 Tailscale 官方免费版。注册时选 GitHub/Microsoft 账号，服务器节点在后台关闭密钥过期；数据面直连不受影响，仅注册/换设备时看境外控制面脸色。若用一段时间稳定可继续白嫖，若注册认证受阻再迁移到 Headscale（客户端只需换登录服务器）。

**备选 B（应急通道）**：SSH 密钥隧道。macOS 原生、Android 用 Termux/JuiceSSH，作为 Headscale 出问题时的救命通道保留（SSH 密钥登录本来也建议一直开着）。

ZeroTier 不推荐：控制器在境外、Android 自建 moon 体验差，相对 Headscale 无优势。裸公网 HTTP 方案不推荐用于长期服务。

---

## 7. 首选方案三端配置步骤概要（命令级）

> 以下 `<SERVER_IP>` 替换为阿里云公网 IP。配置字段名以所用 Headscale 版本的官方 `config-example.yaml` 为准（小版本间字段偶有调整）。

### 7.1 服务器端（阿里云，Docker 环境）

**第一步：阿里云控制台安全组入方向放行**

| 端口 | 协议 | 用途 |
|---|---|---|
| 8080 | TCP | Headscale 控制面 + 嵌入式 DERP |
| 3478 | UDP | STUN（NAT 探测） |
| 41641 | UDP | WireGuard 数据面 |
| 22 | TCP | SSH（建议仅对自己的管理 IP 放行） |

业务端口（如 8000/3000）**不要在安全组放行**。

**第二步：docker-compose 起 Headscale**

```bash
mkdir -p /opt/headscale/config /opt/headscale/data && cd /opt/headscale
# 下载对应版本的 config-example.yaml 到 ./config/config.yaml（见官方文档）
```

`/opt/headscale/docker-compose.yml`：

```yaml
services:
  headscale:
    image: headscale/headscale:0.26   # 用最新稳定版
    restart: unless-stopped
    container_name: headscale
    command: serve
    ports:
      - "0.0.0.0:8080:8080"
      - "0.0.0.0:3478:3478/udp"
    volumes:
      - ./config:/etc/headscale
      - ./data:/var/lib/headscale
```

修改 `./config/config.yaml` 关键字段（无域名方案）：

```yaml
server_url: http://<SERVER_IP>:8080
listen_addr: 0.0.0.0:8080
metrics_listen_addr: 127.0.0.1:9090
prefixes:
  v4: 100.64.0.0/10
derp:
  server:
    enabled: true
    region_id: 999
    region_code: "cn"
    region_name: "Self-hosted CN"
    stun_listen_addr: "0.0.0.0:3478"
    ipv4: <SERVER_IP>
    automatically_add_embedded_derp_region: true
  urls: []      # 关闭官方 DERP，不依赖境外
  paths: []
dns:
  magic_dns: true
  base_domain: exobrain.local
```

启动并创建用户、预认证密钥：

```bash
docker compose up -d
docker exec -it headscale headscale users create exobrain
# 生成可复用预认证密钥（手机端粘贴即用，免浏览器注册）
docker exec -it headscale headscale preauthkeys create --user exobrain --reusable --expiration 87600h
```

**第三步：服务器本机加入 tailnet（让 Docker 服务能通过虚拟网卡访问）**

```bash
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up --login-server http://<SERVER_IP>:8080 --authkey <上一步的preauthkey> --accept-routes
tailscale ip -4    # 记下服务器的 100.x 虚拟 IP，例如 100.64.0.1
```

**第四步：让业务服务只监听虚拟网卡**

在业务的 `docker-compose.yml` 中把端口绑定到 Tailscale 虚拟 IP（而不是 0.0.0.0）：

```yaml
ports:
  - "100.64.0.1:3000:3000"   # Web 界面
  - "100.64.0.1:8000:8000"   # 捕获 API
```

这样公网完全摸不到服务，只有 tailnet 内设备可达。

**（可选）控制面升级为 HTTPS——自建 CA 签 IP 证书**

```bash
# 生成 CA
openssl req -x509 -newkey rsa:4096 -sha256 -days 3650 -nodes \
  -keyout ca.key -out ca.crt -subj "/CN=Exobrain Internal CA"
# 签发 SAN 含 IP 的服务证书
cat > san.cnf <<'EOF'
[req] distinguished_name=dn
req_extensions=ext
[dn] CN=<SERVER_IP>
[ext] subjectAltName=IP:<SERVER_IP>
extendedKeyUsage=serverAuth
EOF
openssl req -newkey rsa:2048 -nodes -keyout hs.key -out hs.csr -config san.cnf
openssl x509 -req -in hs.csr -CA ca.crt -CAkey ca.key -CAcreateserial \
  -out hs.crt -days 3650 -sha256 -extfile san.cnf -extensions ext
```

把 `hs.crt/hs.key` 挂进容器，配置 `tls_cert_path/tls_key_path`，`server_url` 改为 `https://<SERVER_IP>:443`；`ca.crt` 导入 macOS 钥匙串并设为信任、Android 通过"设置 → 安全 → 加密与凭据 → 安装证书 → CA 证书"安装。

### 7.2 macOS 客户端

```bash
brew install --cask tailscale        # 或 Mac App Store 安装
# 方式一（GUI）：菜单栏 Tailscale 图标 → Settings → Accounts → 左下角下拉箭头
#          → Add account → 输入 http://<SERVER_IP>:8080
# 方式二（CLI）：
/Applications/Tailscale.app/Contents/MacOS/Tailscale login \
  --login-server http://<SERVER_IP>:8080
```

若未用预认证密钥，浏览器会提示在服务器上执行注册命令：

```bash
docker exec -it headscale headscale nodes register --user exobrain --key <页面给出的nodekey>
```

验证与日常使用：

```bash
tailscale status                       # 看到服务器节点 active; direct
tailscale ping 100.64.0.1              # 应显示直连（via <IP>:41641）
# 浏览器直接访问 http://100.64.0.1:3000 ，或用 MagicDNS 名 http://<主机名>.exobrain.local:3000
```

### 7.3 Android 客户端

1. 安装 Tailscale：Google Play、F-Droid（包名 `com.tailscale.ipn`）或官方直装 APK（`https://pkgs.tailscale.com/stable/tailscale-android-universal-latest.apk`，适合无 GMS 手机）。
2. 打开 App → 右上角设置 → **Accounts** → 右上角三点菜单 → **Use an alternate server** → 输入 `http://<SERVER_IP>:8080`。
3. 再进三点菜单 → **Use an auth key** → 粘贴服务器上生成的预认证密钥 → 主界面点连接即入网（无需浏览器）。
4. 系统设置 → 网络 → VPN → Tailscale → 开启"始终开启的 VPN"，之后长期在线、切 Wi-Fi/流量自动重连。
5. 浏览器访问 `http://100.64.0.1:3000` 即可；建议同时关闭 Android"私人 DNS"再测试（个别机型私人 DNS 会干扰首次引导）。

### 7.4 日常运维要点

- 备份 `/opt/headscale/data`（SQLite 数据库）与 `config` 目录；
- Headscale 升级：`docker compose pull && docker compose up -d`，升级前看 release notes；
- 服务器节点在 Headscale 中默认无 180 天密钥过期问题，省心；
- 保留 SSH 密钥登录作为应急通道（禁用密码登录、装 fail2ban）。

---

## 参考资料

1. Tailscale 官方定价页（Personal 免费档：个人设备不限量、6 用户）— https://tailscale.com/pricing
2. Tailscale 旧套餐说明页（legacy plans，20 台设备等历史额度）— https://tailscale.com/legacy-plans/
3. Tailscale 官方文档：防火墙端口与控制面/DERP 域名清单（2026-02 校验）— https://tailscale.com/docs/reference/faq/firewall-ports.md
4. Tailscale 官方文档：客户端配置自定义控制服务器（Android/macOS 步骤，2026-01 校验）— https://tailscale.com/docs/how-to/set-up-custom-control-server.md
5. Tailscale Homelab 介绍（免费额度与 WireGuard 说明）— https://tailscale.com/use-cases/homelab
6. Headscale 官方文档：容器方式运行 Headscale — https://headscale.net/stable/setup/install/container/
7. Headscale 官方文档：连接 Android 客户端 — https://headscale.net/stable/usage/connect/android/
8. Tailscale GitHub issue #8085：Android 客户端不信任用户自签 CA 的问题（已修复关闭）— https://github.com/tailscale/tailscale/issues/8085
9. 实践长文：Headscale + Tailscale 自建虚拟组网（无域名/无 DNS 落地、自建 CA、嵌入式 DERP 配置），CSDN，2026-09 — https://damodev.csdn.net/6a96208b3bda720d4b387289.html
10. 实测：从 frp 中转迁移到 Tailscale 直连（DERP 延迟 410ms→直连 29ms、Peer Relay），CSDN，2026-08 — https://blog.csdn.net/HICKER_BOY/article/details/164008851
11. Headscale 部署中文教程（server_url 直用公网 IP、无需备案），掘金，2024-01 — https://juejin.cn/post/7321779275697668105
12. Headscale 自签名 TLS 证书配置攻略，CSDN，2025-09 — https://blog.csdn.net/gitblog_00392/article/details/151436458
13. Self-hosted Tailscale 系列（Headscale Docker Compose、Android 坑点），Fidel Ramos，2026-05 — https://blog.fidelramos.net/software/tailscale-1-headscale-and-clients
14. ZeroTier 官方定价页 — https://www.zerotier.com/pricing/
15. ZeroTier 官方文档：创建网络（免费档 25 台设备说明）— https://docs.zerotier.com/start/
16. 自建 ZeroTier Moon 服务器教程（moon.json、orbit、UDP 9993），掘金，2026-03 — https://juejin.cn/post/7621878684524380223
17. ZeroTier Moon 节点部署（Linux 服务端全流程），RandomEnch 博客，2025-06 — https://blog.randench.cn/posts/53922/
18. frp 项目（frps/frpc 架构，TCP 隧道无需域名）— https://github.com/fatedier/frp
19. OpenJuiceSSH：支持本地/远程/SOCKS 端口转发的开源 Android SSH 客户端 — https://github.com/0xrushi/OpenJuiceSSH/
