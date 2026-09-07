# 01 盘点阿里云服务器现状

Type: task
Status: open
Blocked by: 无

## Question

登录阿里云服务器，盘点部署外脑系统所需的基础事实，产出一份环境清单。后续架构决策（06）与部署访问决策（09）都依赖这些事实。

需要确认的事实：

1. 服务器基本配置：CPU 核数、内存大小、磁盘容量与剩余空间、公网带宽、操作系统版本（如 Ubuntu/CentOS 及版本号）；
2. 运行环境：是否已安装 Docker 与 Docker Compose（及版本）；若没有，记录安装方式；
3. 网络连通性：从服务器能否正常访问 `api.deepseek.com`（DeepSeek API）、`dashscope.aliyuncs.com`（阿里云通义千问 API）；
4. 安全组现状：阿里云控制台安全组当前放行的入方向端口；服务器内防火墙（如 ufw/firewalld）状态；
5. 已在运行的服务：服务器上是否已有其他网站/服务在跑，哪些端口被占用；
6. 服务器地域与可用区（影响访问阿里云对象存储 OSS 等内网服务）。

操作提示：可在服务器执行 `uname -a`、`cat /etc/os-release`、`free -h`、`df -h`、`docker --version`、`docker compose version`、`curl -I https://api.deepseek.com`、`ss -tlnp` 等命令收集信息。

## Answer

2026-09-06 通过阿里云工作台（workbench CLI）远程执行完成盘点：

| 项目 | 事实 |
| --- | --- |
| 实例 ID | i-wz93frlza7g5nz9ft5dc（地域：华南深圳 cn-shenzhen） |
| 公网 IP | 120.25.146.106；内网 IP 172.28.85.88 |
| 规格 | ecs.e-c1m1.large = **2 vCPU / 2Gi 内存**（与本人确认一致） |
| 操作系统 | Alibaba Cloud Linux 3（OpenAnolis 版），内核 5.10.134，x86_64 |
| 内存 | 总量 1.8Gi，盘点时已用 359Mi、可用 1.5Gi；**Swap 为 0，未配置** |
| 磁盘 | 系统盘 /dev/vda3 共 40G，已用 4.6G，**剩余 33G**（配 2–4G swap 文件无压力） |
| Docker | **未安装**（`docker: command not found`），部署阶段需安装 |
| 主机防火墙 | firewalld 未启用（inactive），iptables INPUT 策略 ACCEPT 无规则 |
| 监听端口 | 仅 22（sshd）；127.0.0.1:46555 为阿里云混合备份客户端 hbrclient（仅本地）；机器干净无其他服务 |
| DeepSeek API | 可达：`https://api.deepseek.com` 返回 401（未带密钥的预期响应），时延 0.22s |
| 百炼 API | 可达：`https://dashscope.aliyuncs.com` 返回 404（根路径预期响应），时延 0.16s |

**遗留给票据 09 的控制台事项**：阿里云**安全组规则**无法从机器内部查看，部署 Headscale 时需在控制台放行：TCP 8080（Headscale 控制面，或自选端口）、UDP 3478（STUN）、UDP 41641（WireGuard 数据面直连）；业务端口在 Headscale 组网后只绑虚拟网卡，不入安全组。

**对后续票据的输入**：① 06 架构——内存账按 1.8Gi 实物做预算，磁盘充足；② 09 部署——首批任务含"安装 Docker（Alibaba Cloud Linux 3 用 dnf 装 docker-ce 或阿里云源）"、"创建 2–4G swap 文件并设 swappiness"、"安全组放行 Headscale 三个端口"；③ 两个模型 API 从深圳节点访问时延都很低，无需特殊网络处理。

## Comments

- **2026-09-06 本人提供**：服务器配置为 **2 核 CPU、2G 内存**（非此前预估的 4G）。2G 内存使内存预算成为架构硬约束，已同步至地图 Notes 及票据 06、09。
- **2026-09-06 代理执行**：经本人授权使用已配置好的 workbench CLI（凭据位于本机 ~/.workbench/config.json，未读取未回显）远程盘点，结果见上。
