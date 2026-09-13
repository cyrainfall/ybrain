| col1 | col2 | col3 |
| ---- | ---- | ---- |
|      |      |      |
|      |      |      |

# ybrain 构建、打包与部署

本文档说明 ybrain 从**代码提交**到**服务器容器运行**的完整链路，以及每一步为什么这样设计。

## 一、整体链路

```
开发者提交代码
    │
    ▼
GitHub Actions（ybrain-image 工作流）
    │  1. 装依赖
    │  2. 编译 opencode 单文件二进制（linux-x64）
    │  3. 把 ybrain 插件打包成单文件 ybrain.js
    │  4. 校验插件可加载
    │  5. 用 Dockerfile 构建镜像
    │  6. 推送到阿里云 ACR
    │  7. 构建 spike 阶段并在镜像内验证 sqlite-vec
    ▼
阿里云 ACR（镜像仓库）
    │  镜像标签：<sha>、<branch>，main 分支额外打 latest
    ▼
服务器（ECS）
    │  docker compose pull 拉取镜像
    │  docker compose up -d 启动
    ▼
ybrain 容器（opencode serve + ybrain 插件）
```

设计原则：**服务器不构建，只拉取运行**。所有编译/打包在 CI 完成，服务器只需 Docker。

---

## 二、CI 构建流程（.github/workflows/ybrain-image.yml）

### 触发条件

- 向 `dev` 或 `main` 分支 push，且改动涉及以下路径：
  - `packages/ybrain/**`
  - `packages/opencode/**`
  - `.github/workflows/ybrain-image.yml`
  - `package.json`
- 也可手动触发（`workflow_dispatch`）。

> 说明：仓库默认分支是 `dev`，所以日常开发推送到 `dev` 就会自动构建镜像。

### 各步骤详解

#### 1. 检出代码 & 安装 Bun

```yaml
- uses: actions/checkout@...
- uses: ./.github/actions/setup-bun
- run: bun install
```

安装仓库依赖。

#### 2. 编译 opencode 单文件二进制

```bash
bun run --cwd packages/opencode build --single
```

opencode 是一个基于 Bun 的项目，`build --single` 会用 `Bun.build({ compile: true })` 把整个 opencode 编译成**单个可执行文件**（目标平台为当前 CI 的 linux-x64），输出到：

```
packages/opencode/dist/opencode-linux-x64/bin/opencode
```

这个二进制本身就是一个 Bun 运行时 + opencode 全部代码，不依赖系统里的 node/bun。

#### 3. 打包 ybrain 插件为单文件

```bash
bun build packages/ybrain/src/index.ts \
  --bundle \
  --target=bun \
  --outfile=packages/ybrain/deploy/context/plugin/ybrain.js
```

**为什么要打包，而不是直接复制源文件？**

容器镜像里没有 `node_modules`。如果插件是多文件、或 import 了第三方依赖，直接复制 `index.ts` 进去会因为找不到依赖而加载失败。

`bun build --bundle` 把插件及其所有依赖**内联**成一个 `ybrain.js` 文件。Bun 内置模块（`bun:sqlite`、`Bun.serve`、`fetch` 等）自动保持 external（运行时由 opencode 二进制提供），不需要也不应该被打进去。

这样无论插件将来拆成多少模块、引入多少依赖，容器里只要这一个 `ybrain.js` 就能跑。

#### 4. 校验插件可加载

```bash
bun -e '
  const m = await import("./packages/ybrain/deploy/context/plugin/ybrain.js")
  if (typeof m.server !== "function") {
    console.error("FAIL: plugin bundle does not export a `server` function")
    process.exit(1)
  }
  console.log("PASS: plugin bundle exports server()")
'
```

用 Bun 直接 import 打包产物，断言导出了 `server` 函数。

**为什么这能等价于"容器内可加载"？** opencode 二进制本身是 Bun 编译的，它的插件加载器就是 `await import(插件入口)`。所以 CI 里用 Bun import 验证通过，基本等于容器内也能加载。

#### 5. 登录阿里云 ACR

```yaml
- uses: docker/login-action
  with:
    registry: ${{ secrets.ACR_REGISTRY }}
    username: ${{ secrets.ACR_USERNAME }}
    password: ${{ secrets.ACR_PASSWORD }}
```

需要在仓库 Settings → Secrets and variables → Actions 配置 4 个 secret：

| Secret         | 说明                       | 示例                                            |
| -------------- | -------------------------- | ----------------------------------------------- |
| `ACR_REGISTRY` | ACR 个人版访问域名         | `crpi-xxx.cn-hangzhou.personal.cr.aliyuncs.com` |
| `ACR_IMAGE`    | 命名空间/镜像名            | `ybrain/ybrain`                                 |
| `ACR_USERNAME` | ACR 用户名（阿里云账号名） | —                                               |
| `ACR_PASSWORD` | ACR 固定密码               | —                                               |

#### 6. 构建并推送镜像

```bash
IMAGE=${ACR_REGISTRY}/${ACR_IMAGE}
BRANCH=${GITHUB_REF_NAME}
TAGS="-t $IMAGE:${{ github.sha }} -t $IMAGE:$BRANCH"
if [ "$BRANCH" = "main" ]; then
  TAGS="$TAGS -t $IMAGE:latest"
fi

docker buildx build \
  --platform linux/amd64 \
  --provenance=false \
  --cache-from type=gha \
  --cache-to type=gha,mode=max \
  $TAGS \
  --push \
  packages/ybrain/deploy
```

**镜像标签策略：**

- 每次构建都打两个标签：`<commit-sha>` 和 `<branch-name>`（如 `dev`）
- 只有 `main` 分支才打 `latest`，dev 构建不会覆盖生产标签

**关键参数：**

- `--platform linux/amd64`：服务器是 x86_64
- `--provenance=false`：**禁用 provenance 证明**。阿里云 ACR 个人版不支持 OCI 空清单（`application/vnd.oci.empty.v1+json`），不加这个会推送失败
- `--cache-from/--cache-to type=gha`：用 GitHub Actions 缓存共享基础层，加速重复构建

#### 7. 镜像内验证 sqlite-vec（spike 阶段）

```bash
docker buildx build --target spike --load -t ybrain:spike packages/ybrain/deploy
docker run --rm ybrain:spike
```

构建 Dockerfile 的 `spike` 阶段（含 bun 1.3.14，与仓库 `packageManager` 锁定一致），在容器内运行 [spike/sqlite-vec.ts](file:///Users/cyx/repo/ybrain/packages/ybrain/deploy/spike/sqlite-vec.ts)：加载 vec0 扩展 → 建 1024 维 vec0 虚拟表（与生产嵌入维度一致）→ 写入向量 → KNN 查询断言命中。

**为什么需要这一步**：macOS 上 Bun 默认链接苹果系统的 SQLite（未开启扩展加载），本地直接跑会失败；Linux 容器是生产目标，必须在真实镜像里验证 `bun:sqlite` 能加载 sqlite-vec。

---

## 三、Docker 镜像构建（Dockerfile）

Dockerfile 分三个阶段：

- **base**：debian-slim + 运行时系统包，并下载 sqlite-vec 扩展
- **spike**：base + bun 二进制 + spike 脚本，仅 CI 验证用，**不进入生产镜像**
- **runtime**（默认阶段）：base + opencode 二进制 + ybrain 插件

### base 阶段做了什么

```dockerfile
FROM debian:bookworm-slim AS base

ARG SQLITE_VEC_VERSION=0.1.9
ARG SQLITE_VEC_SHA256=b959baa1...   # 官方 checksums.txt 里的 sha256

RUN apt-get install -y --no-install-recommends \
      ca-certificates curl ripgrep libstdc++6 git \
    && git config --system --add safe.directory '*' \
    && curl -fsSL "https://github.com/.../sqlite-vec-0.1.9-loadable-linux-x86_64.tar.gz" -o /tmp/vec.tar.gz \
    && echo "${SQLITE_VEC_SHA256}  /tmp/vec.tar.gz" | sha256sum -c - \
    && tar -xzf /tmp/vec.tar.gz -C /tmp \
    && install -D -m 0755 /tmp/vec0.so /opt/ybrain/extensions/vec0.so

ENV SQLITE_VEC_PATH=/opt/ybrain/extensions/vec0.so
```

要点：

- **git**：票据 25 在容器内向 Gitee 备份 vault 时使用；`safe.directory '*'` 是因为挂载进来的 vault 目录 owner 与容器内用户不同，不配置会被 git 以 "dubious ownership" 拒绝。部署密钥的挂载见 [第四节](#gitee-备份与-mac-端票据-25)
- **sqlite-vec 0.1.9**：从 GitHub 官方 release 下载 linux-x86_64 可加载扩展，**用官方 checksums.txt 的 sha256 锁定**，安装到 `/opt/ybrain/extensions/vec0.so`
- `SQLITE_VEC_PATH` 环境变量是票据 22 数据层加载扩展的约定路径

### runtime 阶段（生产镜像）

```dockerfile
FROM base AS runtime

ENV BUN_RUNTIME_TRANSPILER_CACHE_PATH=0

COPY context/opencode /usr/local/bin/opencode
RUN opencode --version

COPY context/plugin /opt/ybrain/plugin
COPY opencode.json /opt/ybrain/opencode.json

WORKDIR /opt/ybrain
ENTRYPOINT ["opencode", "serve", "--port=4096", "--hostname=0.0.0.0"]
```

构建上下文（由 CI 组装到 `packages/ybrain/deploy/context/`）：

- `context/opencode` — opencode 单文件二进制
- `context/plugin/ybrain.js` — 打包后的 ybrain 插件
- `opencode.json` — opencode 配置（指定加载哪个插件）

镜像内最终结构：

```
/opt/ybrain/
├── opencode.json          # 配置：加载 ./plugin/ybrain.js
├── plugin/
│   └── ybrain.js          # 插件（单文件）
└── extensions/
    └── vec0.so            # sqlite-vec 可加载扩展
```

容器启动命令：`opencode serve --port=4096 --hostname=0.0.0.0`。

`opencode.json` 内容：

```json
{
  "plugin": ["./plugin/ybrain.js"],
  "lsp": false
}
```

---

## 四、服务器部署（compose.yaml）

### 服务器目录结构

```
/opt/ybrain/
├── compose.yaml
├── .env                 # 密钥，权限 600，不入 Git
├── vault/               # 笔记库（真相源，Git 备份到 Gitee）
├── data/                # SQLite 索引/jobs（可重建，不备份）
├── caddy/               # Caddyfile + data/（证书，务必保留）
└── headscale/           # headscale 配置与 db（可重建，不备份）
```

### 容器编排

三个服务：

**caddy**（控制面 TLS 终止，票据 18）

- 镜像：`caddy:2`
- 暴露端口：443（TCP）公网入口；80（TCP）留给 ACME http-01 兜底
- 数据卷：`/opt/ybrain/caddy`（`data/` 存证书与 ACME 账户，**必须保留**，删掉会重新签发）
- 内存限额：128MB

**headscale**（Tailscale 控制面）

- 镜像：`headscale/headscale:0.26`
- 暴露端口：`127.0.0.1:8080`（只绑回环，供宿主 curl 调试；公网入口是 caddy:443）
- 内存限额：128MB
- 数据卷：`/opt/ybrain/headscale`

**ybrain**（业务容器）

- 镜像：`${YBRAIN_IMAGE}`（从 .env 读取，即 ACR 上的镜像地址）
- 端口映射：
  - `${YBRAIN_TAILSCALE_IP}:4096:4096` — Web 界面，**只绑 Tailscale 网卡**
  - `${YBRAIN_TAILSCALE_IP}:8787:8787` — 捕获接口，**只绑 Tailscale 网卡**
- 数据卷：`vault/` 和 `data/`
- 环境变量：从 `.env` 加载，额外注入 `OPENCODE_SERVER_PASSWORD`
- 内存限额：1.2GB

> 注意：业务端口（4096、8787）通过 `${YBRAIN_TAILSCALE_IP}` 绑定到 Tailscale 虚拟网卡，公网不可达。公网只暴露 SSH(22)、caddy(443/80) 与 WireGuard 数据面(41641/udp)。

### .env 配置项

```bash
YBRAIN_IMAGE=                   # ACR 镜像地址，如 crpi-xxx.cn-hangzhou.personal.cr.aliyuncs.com/ybrain/ybrain:dev
YBRAIN_TAILSCALE_IP=            # 服务器 Tailscale 网卡 IP（ip -4 addr show tailscale0）
OPENCODE_SERVER_PASSWORD=       # Web 界面基本认证密码
DEEPSEEK_API_KEY=               # 聊天模型密钥
SILICONFLOW_API_KEY=            # 嵌入/重排模型密钥
ZEN_API_KEY=                    # 备用模型密钥
YBRAIN_VAULT_REMOTE=            # 票据 25：Gitee 私有仓库 SSH 地址；留空则只本地提交不推送
```

### 部署命令

```bash
sudo mkdir -p /opt/ybrain/{caddy/data,caddy/config} && cd /opt/ybrain
# 从仓库拷贝 compose.yaml、Caddyfile 和 .env.example
sudo cp <repo>/packages/ybrain/deploy/{compose.yaml,.env.example} .
sudo cp <repo>/packages/ybrain/deploy/caddy/Caddyfile caddy/Caddyfile
sudo cp .env.example .env && sudo chmod 600 .env
# 编辑 .env 填入上述配置项
sudo docker compose pull
sudo docker compose up -d
sudo docker logs ybrain --tail 20   # 应看到 "ybrain plugin loaded (configured=true)"
```

### 访问

- Web 界面：`http://<tailnet-ip>:4096`（密码 = `OPENCODE_SERVER_PASSWORD`）
- 捕获接口：`http://<tailnet-ip>:8787`（POST `/capture`，Bearer 渠道令牌）

### headscale 组网（票据 18）

1. 域名与 DNS：把一个（子）域名的 A 记录指向服务器公网 IP。本部署用 DuckDNS 免费子域名：
   `cyx-ybrain.duckdns.org` → `120.25.146.106`。若域名挂在 Cloudflare 且开了橙云代理，必须先关掉，否则 ACME 校验被挡。
2. 上传 [compose.yaml](compose.yaml)、[headscale/config.yaml](headscale/config.yaml) 与 [caddy/Caddyfile](caddy/Caddyfile)（后者需改域名与 ACME 邮箱），把 `config.yaml` 里的 `server_url` 改成 `https://<域名>`，然后启动：
   ```bash
   cd /opt/ybrain && docker compose up -d headscale caddy
   curl -s http://127.0.0.1:8080/health     # 期望 {"status":"pass"}
   curl -s https://<域名>/health            # 期望 {"status":"pass"}，证书由 Caddy 自动签发
   ```
3. 建用户与预认证密钥（0.26 的 `--user` 收数字 ID，不是用户名）：
   ```bash
   docker exec ybrain-headscale-1 headscale users create ybrain
   docker exec ybrain-headscale-1 headscale preauthkeys create --user 1 --reusable --expiration 24h
   ```
4. 宿主机入网（`--accept-dns=false` 避免 tailscale 改宿主机 DNS）：
   ```bash
   curl -fsSL https://pkgs.tailscale.com/stable/rhel/8/tailscale.repo -o /etc/yum.repos.d/tailscale.repo
   dnf -y install tailscale && systemctl enable --now tailscaled
   tailscale up --login-server https://<域名> --authkey <key> --hostname ybrain-server --accept-dns=false
   ```
5. **必须关闭 tailscale 的 netfilter 管理**：
   ```bash
   tailscale set --netfilter-mode=off
   ```

#### 为什么控制面必须走 HTTPS（重要，别跳过）

Tailscale 客户端首次登录成功后，重建控制通道时会强制改拨 443 并改用 TLS（客户端日志：`controlhttp: forcing port 443 dial due to recent noise dial`）。所以明文 `http://<ip>:8080` **只能撑过第一次连接**：headscale 一重启，客户端就再也连不回来，表现为 `Logged out` 并每 5～12 秒拉一次 `/key` 后放弃；Android 端直接报 `HTTP: TLS forced: no port 80 dialed`。

证书由 Caddy 自动申请（Let's Encrypt），默认同时尝试 http-01 与 tls-alpn-01；实测本环境走的是 **tls-alpn-01**，80 端口没用上。`/opt/ybrain/caddy/data` 存证书与 ACME 账户，别删。

#### 为什么必须关掉 netfilter（重要，别跳过）

tailscaled 默认安装反欺骗规则：

```
-A ts-input -s 100.64.0.0/10 ! -i tailscale0 -j DROP
```

而阿里云的内网服务地址——云助手/元数据 `100.100.100.10`、`100.100.100.200`，内网 OSS `100.118.78.x`——都落在 `100.64.0.0/10` 内、从 eth0 进来，于是被整段丢弃。症状：云助手命令永远 `Pending`、workbench 与控制台远程连接超时、内网 OSS 下载报 `context deadline exceeded`。

`netfilter-mode=off` 让 tailscaled 不再碰 iptables（该设置持久化在 tailscaled 状态里，重启后保留）。纯客户端节点上关闭它是安全的：tailscale0 的入站仍由 INPUT 默认策略（ACCEPT）放行，本机也不做 subnet router 转发。

6. 安全组放行 TCP 443（控制面）与 UDP 41641（WireGuard 数据面）；80 仅在证书回退 http-01 时需要。业务端口（4096/8787）不加规则，只绑 tailnet。
7. Mac 入网：

   ```bash
   brew install --cask tailscale-app
   # 首次打开 App 并在「系统设置 → 隐私与安全性」放行系统扩展，然后：
   /Applications/Tailscale.app/Contents/MacOS/Tailscale up \
     --login-server=https://<域名> \
     --authkey <key> --hostname mac-cyx --accept-dns=false --force-reauth
   ```

   > 这条命令必须在登录用户自己的终端里执行。macOS 版 CLI 通过 GUI 进程取凭据，在 root 会话或受限沙箱里跑会报 `CLI credentials are not available`。切换控制面地址后加 `--force-reauth` 才会重新注册。

8. Android 入网（入口在账户页里，与官方文档同一路径）：右上角头像 → Settings → 点顶部已登录账号那一行进入 **Accounts** → 右上角 **⋮** → **Use an alternate server**，填 `https://<域名>`（弹出的浏览器登录页可关掉）→ 再次进 **Accounts** → **⋮** → **Use an auth key**，粘贴预认证密钥 → 回主页点 Connect。

   > 设备名带空格/中文时 headscale 会改成 `invalid-xxxxxx` 之类的占位名（实测「Xiaomi 14」被规范成 `xiaomi14`），需要时用 `headscale nodes rename -i <id> <name>` 修。

9. 验收互通（`tailscale ping` 先报 DERP 中转、随后升级直连属正常）：
   ```bash
   docker exec ybrain-headscale-1 headscale nodes list        # 三端都 online
   tailscale ping -c 3 mac-cyx                                # pong ... via <公网 ip:port>
   ```

### Gitee 备份与 Mac 端（票据 25）

vault 是唯一不可重建的数据，靠 Git 三副本（服务器 / Mac / Gitee）兜底。SQLite 索引与 jobs 不备份，恢复时 reindex 重建。

**服务器侧（一次性）**

1. 在 Gitee 建私有仓库 `ybrain-vault`（本人操作）；
2. 生成部署密钥（服务器上，不设 passphrase）：
   ```bash
   sudo ssh-keygen -t ed25519 -f /opt/ybrain/gitee_deploy_key -N '' -C 'ybrain-deploy'
   sudo chmod 600 /opt/ybrain/gitee_deploy_key
   sudo cat /opt/ybrain/gitee_deploy_key.pub
   ```
3. 把公钥内容配到 Gitee 仓库的「部署公钥」，勾选**允许写入**（仅该仓库权限）；
4. `.env` 填 `YBRAIN_VAULT_REMOTE=git@gitee.com:<账号>/ybrain-vault.git`（compose 已把密钥只读挂进容器并设好 `GIT_SSH_COMMAND`）。

**运行行为**

- 容器启动时自动 `git init` 并把分支统一到 `main`（已 init 则跳过）；
- 每次提炼闭环：先 `git pull`（把 Mac 手写改动拉回来，冲突留给本人用 Git 合并）→ 成功后 `git add -A && git commit -m 'distill: <标题>'` → `git push`；
- 书摘拆出的 card 笔记同批提交（`add -A`）；
- **提交/推送失败只告警，不阻塞提炼**（job 照常算成功）；失败时提交已留在本地，下次闭环的 push 会把领先的提交一并补上。

**Mac 端（Obsidian Git 插件）**

先在 Mac 上 clone Gitee 的 `ybrain-vault` 仓库，再用 Obsidian 打开该目录，启用社区插件 **Obsidian Git**，设置：

- `Pull updates on startup`：开（打开 vault 先拉一次）；
- `Auto pull interval (minutes)`：`10`；
- `Auto backup interval (minutes)`：`10`（到点自动 commit + push 本地改动）；
- `Disable push`：关（要推到 Gitee）。

冲突：Obsidian Git 与服务器端都可能改同一文件，冲突以 Git 合并解决（服务器侧 pull 冲突同样需要本人人工处理一次）。

> 未配置 `YBRAIN_VAULT_REMOTE` 时，服务器只做本地提交、不推送，提炼流程完全不受影响——适合先本地演练。

---

## 五、更新流程

1. 修改代码后 `git push origin dev`
2. GitHub Actions 自动构建并推送新镜像到 ACR（标签 `dev` 和 `<sha>`）
3. 服务器上执行：
   ```bash
   cd /opt/ybrain
   sudo docker compose pull
   sudo docker compose up -d
   ```
4. 验证：`sudo docker logs ybrain --tail 20`

### 端到端验收（票据 26）

部署完成后按 [mvp-acceptance.md](../../../.scratch/exobrain/prototypes/mvp-acceptance.md) 逐条勾验。其中 B/C/D/E2 可自动化的部分由脚本实测，A/E1/F 等需人工的项在报告里列成待勾清单：

```bash
YBRAIN_WEB_URL=http://<tailnet-ip>:4096 \
YBRAIN_CAPTURE_URL=http://<tailnet-ip>:8787 \
OPENCODE_SERVER_PASSWORD=... CAPTURE_TOKEN_ANDROID=... CAPTURE_TOKEN_WEB=... \
YBRAIN_VAULT_DIR=/opt/ybrain/vault \
YBRAIN_E2E_CONFIRM=yes \
  bun run packages/ybrain/script/e2e-acceptance.ts

# 不带 YBRAIN_E2E_CONFIRM 时只跑只读检查与问答，不往 vault 写测试笔记；
# 脚本会捕获→等提炼→查 distill 提交→API 提问→触发 reindex，报告写到 ./e2e-acceptance-report.md
```

`bun` 仅在跑验收脚本时需要（服务器上可用 `docker run --rm -v ...` 或在 Mac 上经 tailnet 执行）。

---

## 六、常见问题排查

### 1. CI 报错 `bun: command not found`

pre-push hook 或本地环境问题。确保 `~/.bun/bin` 在 PATH 中：

```bash
export PATH="$HOME/.bun/bin:$PATH"
```

### 2. CI 报错 `This script requires bun@^1.3.14`

仓库要求 bun ≥ 1.3.14，本地版本太旧。运行 `bun upgrade` 升级。

### 3. CI 报错 `Username and password required`（docker login 步骤）

GitHub secrets `ACR_USERNAME` / `ACR_PASSWORD` 未配置或值为空。去仓库 Settings → Secrets and variables → Actions 检查，确认建在 **Repository secrets** 下（不是 Environment secrets，也不是 Variables）。

### 4. CI 报错 `unknown manifest class for application/vnd.oci.empty.v1+json`

阿里云 ACR 个人版不支持 OCI 清单。已通过 `--provenance=false` 解决。如果还遇到，检查 workflow 里该参数是否存在。

### 5. 插件在容器里加载失败

本地复现 CI 的打包和校验步骤：

```bash
bun build packages/ybrain/src/index.ts --bundle --target=bun --outfile=/tmp/ybrain.js
bun -e 'const m = await import("/tmp/ybrain.js"); console.log(typeof m.server)'
```

应输出 `function`。如果失败，检查插件是否引入了无法打包的依赖。

### 6. 本地（macOS）运行 sqlite-vec spike 报 "does not support dynamic extension loading"

macOS 上 Bun 默认链接苹果系统的 SQLite，未开启扩展加载。需要 Homebrew 的 SQLite：

```bash
brew install sqlite   # 已安装可跳过
# 从 https://github.com/asg017/sqlite-vec/releases 下载 loadable-macos-aarch64 包并解压出 vec0.dylib
SQLITE_VEC_PATH=/path/to/vec0.dylib \
CUSTOM_SQLITE_PATH=/opt/homebrew/opt/sqlite/lib/libsqlite3.dylib \
  bun run packages/ybrain/deploy/spike/sqlite-vec.ts
```

`CUSTOM_SQLITE_PATH` 只用于 macOS 本地开发；Linux 容器不需要设置。
