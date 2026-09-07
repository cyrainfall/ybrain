# 09 决策：部署形态与安全访问

Type: grilling
Status: claimed
Blocked by: 01, 02

## Question

基于服务器环境（01）与访问方案调研（02），与本人对话确定：

1. **访问方案**：Tailscale / Headscale 自建 / 裸 IP 加令牌 / 其他——选定一个主方案，给出三端（服务器、Android、macOS）的配置清单；
2. **容器编排**：Docker Compose 两个服务——headscale；ybrain（由 fork cyrainfall/ybrain 构建镜像：opencode serve + Web 界面 + 内嵌捕获接口/任务队列/嵌入索引；DeepSeek 直连为主力 provider、Zen 免费档应急；SiliconFlow 嵌入/重排走环境变量密钥；关闭 LSP；基本认证）；数据卷（vault/、data/）挂载、重启策略、mem_limit 与 2–4G swap 配置；
3. **端口与安全组**：哪些端口对公网开放、哪些只走内网/隧道；阿里云安全组与服务器防火墙的具体配置；
4. **HTTPS 与鉴权**：无域名条件下传输加密怎么处理（隧道天然加密还是自签证书），各服务的访问令牌如何发放；
5. **开机自启与日志**：服务自启动、日志查看方式、磁盘占满的防护；
6. **2G 内存专项（2026-09-06 确认配置后新增）**：必须配置 2–4GB swap（含阿里云磁盘空间核实与 swappiness 设置）；每个容器在 Docker Compose 中设置内存上限（mem_limit），防止任一服务吃满内存导致整机被杀；给出各容器的内存配额表。

产出：部署决策记录 + 一份可照做的部署步骤清单（后续构建票据直接执行）。

## Answer

2026-09-06 与本人对话定稿（结合 01 盘点、02 调研、06 修订版架构）。

### 总览

两容器（headscale + ybrain）+ 宿主机 tailscale 客户端；公网只暴露 SSH(22) 与 Headscale 三端口，业务端口全部只绑 Tailscale 虚拟网卡；目录 `/opt/ybrain/`（`compose.yaml`、`.env`（600 权限）、`vault/`、`data/`）。

### 端口与安全组（本人需在阿里云控制台操作）

实例 i-wz93frlza7g5nz9ft5dc（深圳）安全组入方向规则：

| 协议/端口 | 授权对象 | 用途 |
| --- | --- | --- |
| TCP 22 | 0.0.0.0/0（现状保留） | SSH，仅密钥登录 + 装 fail2ban 防爆破 |
| TCP 8080 | 0.0.0.0/0 | Headscale 控制面（明文 HTTP，先行的既定取舍） |
| UDP 3478 | 0.0.0.0/0 | STUN 打洞 |
| UDP 41641 | 0.0.0.0/0 | WireGuard 数据面直连 |
| TCP 4096 / 8787 | **不加规则** | ybrain Web 界面 / 捕获接口，仅绑 Tailscale 网卡，公网不可达 |

### 容器编排（compose 草案要点）

- **headscale**：容器，发布 8080/tcp + 3478/udp + 41641/udp 到公网网卡；数据卷 `/opt/ybrain/headscale/`；`mem_limit: 128m`；服务端地址 `http://120.25.146.106:8080`；
- **ybrain**：由 fork 仓库构建的镜像（构建发布见下），发布 `127.0.0.1` 之外仅绑宿主机 Tailscale IP 的 `4096`（Web 界面）与 `8787`（捕获 REST 接口）；挂载 `/opt/ybrain/vault`（笔记库）与 `/opt/ybrain/data`（SQLite + 向量）；`mem_limit: 1.2g`；环境变量注入 DeepSeek/SiliconFlow/Zen 密钥；关闭 LSP；Web 界面加基本认证（隧道加密之外的纵深防御）；
- **宿主机 tailscaled**（非容器）：加入自有 headscale，业务端口依赖其虚拟网卡 IP 才能发布；
- 全部 `restart: unless-stopped` + Docker 开机自启（`systemctl enable docker`）。

### 镜像构建发布（已定）

fork 仓库配 **GitHub Actions**：push 到 main → 构建 `linux/amd64` 镜像 → 推送**阿里云 ACR 个人版**（免费、国内拉取快）→ 服务器 `docker pull` + `docker compose up -d` 完成升级。**服务器不做构建**（2 核 2G 构建 opencode 级 monorepo 有溢出风险）。

### 2G 内存专项（已定）

- 4G swap 文件（`/swapfile`，磁盘余 33G）+ `vm.swappiness=15`，写入 fstab 持久化；
- 内存配额表：headscale 128M / ybrain 1.2G；系统+Docker 常态约 0.55G；峰值靠 swap；
- ybrain 容器内不跑语言服务器、不开并行提炼（票据 12 遵守）。

### 三端配置清单（执行归构建票据）

1. **服务器**（workbench 可代跑）：装 Docker CE（阿里云镜像源）+ compose 插件；建 swap；装宿主 tailscale 并加入 headscale；fail2ban；拉起 compose；
2. **macOS**：安装 Tailscale 客户端 → 登录服务器指向 `http://120.25.146.106:8080`（预认证密钥）→ 之后浏览器访问 `http://<tailnet-ip>:4096`；Obsidian 经 tailnet SSH 拉取 vault（归票据 13 细化）；
3. **Android**：Tailscale APK（F-Droid/官网，避免依赖 Google 框架）→ 同上入网 → HTTP Shortcuts 指向 `http://<tailnet-ip>:8787`（票据 08 定协议）。

### 运维

日志：`docker logs` + 日志轮转（json-file max-size 10M×3）；磁盘防护：轮转 + 备份票据 13 的保留策略；救急通道：workbench 云助手（不依赖 SSH/tailnet）。

### 已接受的取舍

- 控制面明文 HTTP：风险为"可干扰节点协调"级别，数据面始终 WireGuard 加密；日后可用自签证书加固；
- SSH 公网：fail2ban + 仅密钥；如需收紧为 tailnet-only 随时可改安全组；
- tailnet 单点：headscale 挂了新连接无法建立，已建连接的 WireGuard 直连不受影响；云助手兜底。
