# 16 任务：服务器初始化（Docker/swap/fail2ban）

Type: task
Status: open
Blocked by: 09

## 做什么

在实例 i-wz93frlza7g5nz9ft5dc（深圳，Alibaba Cloud Linux 3）上，经 workbench 执行：
1. 安装 Docker CE（阿里云镜像源）+ compose 插件，`systemctl enable docker`；
2. 创建 4G swap 文件 `/swapfile`，`swappiness=15`，写入 fstab；
3. 安装配置 fail2ban（保护 SSH 22）；
4. 配置 Docker 日志轮转（json-file max-size 10M ×3）；
5. 建目录 `/opt/ybrain/{vault,data,headscale}`，`.env` 已就位（票据 07）。

依据：[票据 09](../issues/09-decision-deployment-access.md) 三端配置清单、2G 内存专项。
本人配合：安全组放行 TCP 8080、UDP 3478/41641。

## 验收

`docker version` / `swapon --show`（4G）/ `systemctl is-active fail2ban` 均正常；重启机器后 swap 与 Docker 自动恢复。
