# 25 任务：Git 自动提交与 Gitee 备份

Type: task
Status: open
Blocked by: 24

## 做什么

1. vault 初始化为 Git 仓库；每次提炼闭环自动 `git add/commit`（message `distill: <标题>`）后 `git push` Gitee 私有仓库（失败告警不阻塞，下次重试）；
2. 服务器配 Gitee 部署密钥（仅该仓库写权限）；
3. Mac 端 Obsidian Git 插件配置：每 10 分钟 pull、启动 pull、本地改动 push；
4. 服务器提炼前先 pull（Mac 手写改动回流，冲突走 Git 合并）。

本人配合：注册 Gitee、建私有仓库 `ybrain-vault`。
依据：[backup-plan.md](../prototypes/backup-plan.md)。

## 验收

验收 C3（提炼后 Gitee 可见提交）、E1（Obsidian 浏览全部笔记）；连续推送无人工干预。
