# ybrain 部署

镜像由 GitHub Actions（push main）构建并推送阿里云 ACR，服务器只拉取运行。

## 服务器（前置：票据 16 已装 Docker、swap，票据 18 已组网）

```bash
sudo mkdir -p /opt/ybrain && cd /opt/ybrain
sudo cp <repo>/packages/ybrain/deploy/{compose.yaml,.env.example} .
sudo cp .env.example .env && sudo chmod 600 .env   # 编辑填入 YBRAIN_IMAGE / YBRAIN_TAILSCALE_IP / 密码 / 密钥
sudo docker compose pull
sudo docker compose up -d
sudo docker logs ybrain --tail 20                   # 应看到 ybrain plugin loaded (configured=true)
```

## 访问

- Web 界面：`http://<tailnet-ip>:4096`（基本认证密码 = OPENCODE_SERVER_PASSWORD）
- 捕获接口：`http://<tailnet-ip>:8787`（票据 19 实装前为空壳）

## 本地验证镜像

```bash
# 在仓库根目录（与 workflow 同步骤组装构建上下文）
bun install
bun run --cwd packages/opencode build --single
mkdir -p packages/ybrain/deploy/context/plugin
cp packages/opencode/dist/opencode-linux-x64/bin/opencode packages/ybrain/deploy/context/opencode
cp packages/ybrain/src/index.ts packages/ybrain/deploy/context/plugin/ybrain.ts
docker build -t ybrain:local packages/ybrain/deploy
docker run --rm -e OPENCODE_SERVER_PASSWORD=x -e DEEPSEEK_API_KEY=d -e SILICONFLOW_API_KEY=d -p 4096:4096 ybrain:local
```
