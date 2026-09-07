# ybrain 运行镜像（linux/amd64）。
# 构建上下文由 CI（.github/workflows/ybrain-image.yml）组装到本目录 context/：
#   context/opencode        由 `bun run --cwd packages/opencode build --single` 产出
#   context/plugin/ybrain.ts  由 packages/ybrain/src/index.ts 复制而来
FROM debian:bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates ripgrep libstdc++6 \
  && rm -rf /var/lib/apt/lists/*

# 容器内没有跨命令复用的转译缓存，直接关闭
ENV BUN_RUNTIME_TRANSPILER_CACHE_PATH=0

COPY context/opencode /usr/local/bin/opencode
RUN opencode --version

COPY context/plugin /opt/ybrain/plugin
COPY opencode.json /opt/ybrain/opencode.json

WORKDIR /opt/ybrain
ENTRYPOINT ["opencode", "serve", "--port=4096", "--hostname=0.0.0.0"]
