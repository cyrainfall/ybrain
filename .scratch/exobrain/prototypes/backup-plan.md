# 备份与恢复方案（票据 13 工件）

2026-09-06 定稿。

## 1. 备份对象与策略

| 对象 | 位置 | 策略 | 理由 |
| --- | --- | --- | --- |
| vault 笔记库 | `/opt/ybrain/vault/` | Git 仓库：每次提炼自动 commit（票据 12），commit 后推送 **Gitee 私有仓库**；Mac 端 Obsidian Git 插件定时 pull/push | 唯一不可重建资产；服务器/Mac/Gitee 三份副本 |
| SQLite 索引/jobs | `/opt/ybrain/data/` | **不备份**。恢复时跑 `ybrain reindex` 从 vault 全量重建（bge-m3 嵌入免费，几百篇几分钟）；jobs 队列从收件箱扫描重建 | 索引是派生数据，备份零收益 |
| headscale 配置 | `/opt/ybrain/headscale/` | **不备份**。丢失则重建控制面：重新起 headscale、三端重新登录（约 15 分钟），笔记数据不受影响 | 配置小但重建简单，不为它引入 OSS |
| `.env` 密钥 | `/opt/ybrain/.env` | **不进 Git、不进备份**。本人在密码管理器存一份密钥记录；密钥全部可在平台侧重新生成 | 凭据不落第三方 |
| compose.yaml 等部署文件 | ybrain fork 仓库内 | 随 fork 仓库版本管理（GitHub，公开可见的只有模板，真实 .env 不入库） | 基础设施即代码 |

## 2. 推送机制

- ybrain 每次提炼闭环 commit 后执行 `git push`（失败只告警、不阻塞提炼，下次提交时重试）；
- 服务器用部署密钥（deploy key，仅该 Gitee 仓库写权限）推送，密钥在服务器上、不进 vault；
- Mac 端 Obsidian Git 插件：每 10 分钟自动 pull，启动时 pull；本人在 Obsidian 里的手写/改动通过 push 回到服务器（服务器 pull 在提炼前进行，冲突以 Git 合并解决）。
- 待本人操作：注册 Gitee → 建私有仓库（如 `ybrain-vault`）→ 生成部署密钥配到服务器（构建票据执行）。

## 3. 恢复演练（新服务器/灾难恢复步骤）

```
1. 新机基础环境：装 Docker CE + compose 插件、建 4G swap（票据 09 清单）；
2. 组网：起 headscale 容器 → 三端（Mac/Android/新服务器宿主 tailscale）重新登录；
3. 拉代码与数据：
   - clone ybrain fork（含 compose.yaml 模板）到 /opt/ybrain/；
   - clone Gitee 私有 vault 仓库到 /opt/ybrain/vault/；
4. 配置：重写 /opt/ybrain/.env（从密码管理器取密钥：DeepSeek / SiliconFlow /
   三个渠道捕获令牌 / 将来的 WEREAD_API_KEY；缺失的平台侧重新生成），chmod 600；
5. 起服务：docker compose up -d（镜像从 ACR 拉取）；
6. 重建索引：ybrain reindex（全量分块+嵌入，约几分钟）；
7. 验证：浏览器打开 Web 界面提问、发一条测试捕获、确认收件箱与检索正常。
```

验收标准（票据 14 引用）：按上述步骤在一台干净机器上走完，能检索到备份前的笔记内容。

## 4. 日常检查

- 每周日周复盘会话顺带报告：最近一次成功推送 Gitee 的时间、收件箱 dead 任务数；
- 本人每月看一眼 Gitee 仓库确认推送在持续（或 Web 界面周报复核）。
