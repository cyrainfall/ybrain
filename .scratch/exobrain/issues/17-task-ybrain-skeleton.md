# 17 任务：ybrain fork 工程骨架与 CI/镜像发布

Type: task
Status: open
Blocked by: 09

## 做什么

在 [cyrainfall/ybrain](https://github.com/cyrainfall/ybrain) 中：
1. 新增 `packages/ybrain/`（外脑代码隔离目录，遵守票据 06 合并纪律：非必要不改核心文件）；
2. `openspec/` 空目录初始化（`openspec init`，为票据 27 自我改进回路预留；MVP 不启用完整流程，只建结构）；
3. `opencode serve` 能加载外脑插件代码（进程内入口）；
4. GitHub Actions：push main → 构建 linux/amd64 镜像 → 推阿里云 ACR 个人版；
5. `compose.yaml` 模板：ybrain + headscale 两服务、mem_limit（128m / 1.2g）、卷挂载、`.env` 注入、仅绑 Tailscale 网卡（4096/8787）、关闭 LSP、Web 基本认证；
6. 服务器 `docker pull` + `compose up -d` 能起空壳服务。

## 验收

CI 产出镜像；服务器拉起后 Web 界面（经 tailnet）可打开 opencode 原版对话；`.env` 密钥被进程读到（日志脱敏，只打印 configured=true）。
