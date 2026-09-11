# ybrain 运行镜像（linux/amd64）。
# 构建上下文由 CI（.github/workflows/ybrain-image.yml）组装到本目录 context/：
#   context/opencode          由 `bun run --cwd packages/opencode build --single` 产出
#   context/plugin/ybrain.js  由 `bun build --bundle --target=bun` 打包而来（单文件，含依赖）
# 多阶段：runtime 是生产镜像；spike 仅由 CI 构建运行，验证 bun:sqlite + sqlite-vec 链路。
FROM debian:bookworm-slim AS base

ARG SQLITE_VEC_VERSION=0.1.9
# sha256 来自官方 release 自带的 checksums.txt
ARG SQLITE_VEC_SHA256=b959baa1d8dc88861b1edb337b8587178cdcb12d60b4998f9d10b6a82052d5d7

# git：票据 25 容器内向 Gitee 备份 vault；部署密钥的挂载在 compose/票据 25 中补
# curl：下载 sqlite-vec 可加载扩展
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl ripgrep libstdc++6 git \
  && rm -rf /var/lib/apt/lists/* \
  && git config --system --add safe.directory '*' \
  && curl -fsSL "https://github.com/asg017/sqlite-vec/releases/download/v${SQLITE_VEC_VERSION}/sqlite-vec-${SQLITE_VEC_VERSION}-loadable-linux-x86_64.tar.gz" -o /tmp/vec.tar.gz \
  && echo "${SQLITE_VEC_SHA256}  /tmp/vec.tar.gz" | sha256sum -c - \
  && tar -xzf /tmp/vec.tar.gz -C /tmp \
  && install -D -m 0755 /tmp/vec0.so /opt/ybrain/extensions/vec0.so \
  && rm /tmp/vec.tar.gz /tmp/vec0.so

# 票据 22 的数据层通过此路径加载向量扩展
ENV SQLITE_VEC_PATH=/opt/ybrain/extensions/vec0.so

# 仅 CI 验证使用：bun 版本与仓库 packageManager 锁定保持一致
FROM base AS spike
COPY --from=oven/bun:1.3.14 /usr/local/bin/bun /usr/local/bin/bun
COPY spike /spike
CMD ["bun", "/spike/sqlite-vec.ts"]

FROM base AS runtime

# 容器内没有跨命令复用的转译缓存，直接关闭
ENV BUN_RUNTIME_TRANSPILER_CACHE_PATH=0

COPY context/opencode /usr/local/bin/opencode
RUN opencode --version

COPY context/plugin /opt/ybrain/plugin
COPY opencode.json /opt/ybrain/opencode.json

WORKDIR /opt/ybrain
ENTRYPOINT ["opencode", "serve", "--port=4096", "--hostname=0.0.0.0"]
