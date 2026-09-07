# 18 任务：headscale 部署与三端组网

Type: task
Status: open
Blocked by: 16

## 做什么

1. 起 headscale 容器（8080/tcp、3478/udp、41641/udp），服务端地址 `http://120.25.146.106:8080`；
2. 服务器宿主机装 tailscaled 并加入自有 headscale（预认证密钥）；
3. Mac Tailscale 客户端入网；Android Tailscale APK（F-Droid/官网）入网；
4. ybrain 端口发布改为绑宿主机 Tailscale IP。

## 验收

三端 tailnet 互通；Mac 浏览器访问 `http://<tailnet-ip>:4096` 可开界面；公网端口扫描 4096/8787 关闭（验收 A1–A3）。
