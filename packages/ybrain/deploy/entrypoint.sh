#!/bin/sh
# 票据 29：容器重建后插件懒引导，捕获接口要等第一个实例请求才起来。
#
# `opencode serve` 采用「按请求加载实例」的设计（上游启动优化 #30453，serve 命令写死
# instance: false），插件——包含捕获接口 8787——只在实例引导时加载。于是每次
# `docker compose up -d` 重建容器后，浏览器扩展与安卓快捷方式都推送不到，直到有人
# 打开 Web 界面或调一次 4096 的接口。
#
# 这里在 exec serve 之前，后台起一个预热进程：等 4096 就绪后带认证打一次实例接口，
# 触发插件加载（8787 随即在听）。预热进程与 serve 分离，exec 保留 PID 1 信号语义，
# SIGTERM 直达 opencode；预热失败只告警，不阻塞服务启动。
set -u

PORT=4096
MAX_TRIES=60

# 认证凭据：用户名默认 opencode（见 src/server/auth.ts）。密码为空时 opencode 视为
# 不需要认证、会忽略该凭据，所以可以无条件带上，省去分支与 sh 里的参数拆分问题。
# --noproxy "*"：请求只走回环，若环境里混进 http_proxy，curl 会把它转给代理并拿到 502，
# 预热静默超时——表现与本脚本要修的问题一模一样，难以察觉，索性绕开代理。
# --max-time 30：实例引导可能耗时二十多秒（冷启动拉模型目录，实测一次 21.7s），设得比
# 观测值宽，避免客户端先断连而打断引导；但不能无限等——一个真正挂死的请求会让循环永远
# 卡在同一次，容器重启后捕获渠道直接残废（票据 26 实测）。超时就放下一轮重试。
(
  i=0
  while [ "$i" -lt "$MAX_TRIES" ]; do
    if curl -fsS --noproxy "*" --max-time 30 -u "opencode:${OPENCODE_SERVER_PASSWORD:-}" "http://127.0.0.1:${PORT}/session" >/dev/null 2>&1; then
      echo "ybrain warmup: instance bootstrapped"
      exit 0
    fi
    i=$((i + 1))
    sleep 1
  done
  echo "ybrain warmup: 预热超时（${MAX_TRIES}s），捕获接口可能未就绪" >&2
) &

exec opencode serve --port="${PORT}" --hostname=0.0.0.0