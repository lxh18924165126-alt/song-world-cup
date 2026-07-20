# 中国大陆临时公网中转

## 功能范围与入口

该能力在中国大陆网络无法直连生产 `workers.dev` 地址时，提供一个临时 HTTPS 入口。它不启动本地 Worker，也不复制 D1、Durable Objects 或 Queue；所有页面和业务 API 仍由现有 Cloudflare 生产环境处理。

- 启动：`pnpm public:start`
- 安装后台服务：`pnpm public:service:install`（首次或服务定义变更后）
- 后台刷新：`pnpm public:refresh`
- 当前 URL：`.public-access/public-url.txt`
- 大陆节点验收：`pnpm public:verify-cn`
- 停止：在启动终端按 `Ctrl+C`

## 真实代码入口

- `scripts/start-public.sh`：端口选择、Node 探测、系统代理探测、旧进程范围确认、反向代理启动、Pinggy SSH 443 隧道、公网 `bootId` 健康检查、状态输出和退出清理。
- `scripts/public-access-service.mjs`、`scripts/install-public-access-service.sh`：生成并校验当前项目专属的用户级 macOS LaunchAgent，注册到当前 GUI 会话；服务固定使用当前 Node 路径且不会在隧道退出后静默换址。
- `scripts/refresh-public-access.sh`：通过 `launchctl kickstart -k` 重启后台入口，等待新 `manager.pid`、URL、`bootId` 和公网健康响应一致后返回；用于定时自动化。
- `scripts/public-access-lib.sh`：Node/端口/代理探测、Pinggy HTTPS URL 解析和本机/公网健康轮询。
- `scripts/public-access-proxy.mjs`：固定上游 HTTP 反向代理、请求与响应流转发、生产健康检查、绝对重定向 origin 改写，以及失效上游连接池的原子替换和安全请求重试。
- `scripts/pinggy-askpass.sh`：以非交互方式向免费 Pinggy SSH 会话提交空密码，不保存凭据。
- `scripts/public-access-cn-verify.mjs`：调用 Globalping，从中国大陆节点验证本次实例和真实首页并写入结构化报告。
- `scripts/test-public-access.sh`、`scripts/verify-public-access-cn.sh`：在 Node 不位于 shell `PATH` 时复用 Codex 打包运行时，并分别执行自动化测试和远端验收。

## 调用与数据流

1. 启动脚本生成随机 `PUBLIC_BOOT_ID`，选择未占用的回环端口。
2. Node 代理固定回源 `UPSTREAM_ORIGIN`，默认是生产 `song-world-cup.baituola-song-world-cup.workers.dev`；若 macOS 配置了可连接的 HTTP(S) 代理，启动脚本把代理环境传给进程，Undici `EnvHttpProxyAgent` 使用它访问生产站。回源不依赖 Node 进程级全局代理连接池。
3. `GET /__public-access/health` 实时请求生产 `/api/health`，只有上游返回 `{ status: "ok" }` 才返回 200，并带当前 `bootId`。
4. Pinggy SSH 客户端通过 443 端口建立出站反向隧道，仅把公网请求转发到所选的 `127.0.0.1` 端口。启动脚本只接受 `pinggy.link` 或 `run.pinggy-free.link` 下的 HTTPS 地址，并要求公网健康响应匹配当前 `bootId`。
5. 浏览器对页面、Service Worker 和 `/api/*` 的请求沿原路径代理到生产 Worker。代理删除 hop-by-hop/Host/压缩长度头、流式转发请求体和响应体，并把指向生产 origin 的绝对 `Location` 改写为当前公网 origin。
6. 大陆验收分别请求健康路径和 `/`。两项都默认选择 5 个 `country=CN` 探针，至少 2 个不同城市返回正确内容才通过；报告写入 `.public-access/cn-verification.json`。
7. 定时刷新由 macOS LaunchAgent 终止并重启入口管理进程；管理进程自身也会校验状态目录中的上一代 PID，退出钩子只清理自己记录的代理与隧道。新入口完全就绪后，刷新命令才输出 URL，避免邮件发送旧地址。
8. 任一上游 fetch 因网络异常失败时，代理先创建新 `EnvHttpProxyAgent`，再丢弃失败连接池。`GET / HEAD / OPTIONS` 使用新连接池补试一次；写方法不重放已发送或已消费的请求体，但后续请求会直接使用新连接池。

## 状态、不变量与安全边界

- `.public-access/` 只保存 PID、当前 URL、`bootId`、日志、SSH known-host 和验证报告，已加入 `.gitignore`，不是权威业务数据。
- 管理进程只会终止命令标记和项目路径/工作目录同时匹配的 PID，降低 PID 重用或其他项目同名脚本被误杀的风险。
- LaunchAgent 安装在当前用户的 `~/Library/LaunchAgents/com.baituola.song-world-cup-public-access.plist`，不需要管理员权限；`RunAtLoad` 与 `KeepAlive` 都关闭，只由显式刷新触发，避免免费隧道到期后静默生成未邮件通知的新地址。
- 重装 LaunchAgent 时，安装器在 `bootout` 后轮询确认旧任务已经从当前 GUI domain 消失，再执行 `bootstrap`，避免 launchd 尚未完成清理时返回 I/O 错误。
- 代理默认只监听 `127.0.0.1`，且上游由进程环境固定，不能由公网请求选择，避免成为开放代理。
- 现有赛事恢复令牌、账号会话、后台令牌和分享开关仍由生产 Worker 校验，中转层不读取或保存业务凭据。
- 公网只接受 HTTPS URL；Pinggy 作为 HTTP 反向隧道服务会终止入口 TLS，因此该临时入口不用于高敏感或正式生产流量。
- 免费隧道约 60 分钟后失效，重新启动通常会更换 origin。IndexedDB、Service Worker、`localStorage`、恢复链接和分享二维码不能跨 origin 自动迁移。
- 本机、代理或隧道退出不会损坏 Cloudflare 生产数据，只会使临时入口停止访问。
- 系统代理线路短暂中断后，长驻 Node 进程无需重启；线路恢复后的下一个安全请求会重建连接池并自动补试。线路仍处于中断状态时健康检查会继续返回 502，这一机制不伪造上游可用性。

## 失败与恢复

- 本机健康失败：检查 `.public-access/proxy.log` 以及本机代理是否仍能访问生产 `/api/health`。
- 本机代理监听正常但线路曾中断：查看 `proxy.log` 中的“已重建代理连接池”；系统代理恢复后重新请求健康路径即可，不需要重启 Node 中转进程。
- Pinggy 没有生成可用 HTTPS 地址：先尝试 SSH 443 直连；启动脚本会在存在系统 HTTP CONNECT 代理时自动重试。
- URL 有响应但 `bootId` 不匹配：拒绝该入口，避免把旧进程或陈旧 URL 当作本次部署。
- 免费隧道到期、电脑休眠或网络切换：重新运行 `pnpm public:start` 并使用新状态文件中的 URL；旧 URL 不再有效。
- 大陆探针结果不足：查看 `.public-access/cn-verification.json` 中每个城市的 DNS/TCP/TLS/HTTP 结果，修复后重新运行验收，不能以本机可访问代替大陆验证。

## 每小时邮件自动化

Codex 桌面应用中的本地自动化每小时执行一次，不存放在仓库中。每次运行先调用 `pnpm public:refresh`，再同时核对公网健康响应、本次 `bootId` 和 `pnpm public:verify-cn` 报告；只有 URL、实例和大陆验证三者一致时，才通过 Gmail 发送新入口。失败时不发送状态文件中的旧 URL，而是发送不含链接的故障通知。

自动化依赖电脑未休眠、Codex 桌面应用正在运行、Gmail 连接有效以及本机系统代理能真实转发 TLS。系统代理仅开启监听但上游线路失效时，入口健康检查会失败，自动化应进入故障邮件分支。

## 验证

- `pnpm test:public-access`：覆盖正确/错误 `bootId`、跨城市通过门槛、真实首页标题、请求方法/查询/头/正文转发、重定向改写，以及安全方法连接失败后换池重试、写方法换池但不重放。
- LaunchAgent 测试同时覆盖固定路径/关闭自动换址，以及卸载后必须等待旧服务完全消失的重装时序。
- `bash -n scripts/start-public.sh scripts/install-public-access-service.sh scripts/refresh-public-access.sh scripts/public-access-lib.sh scripts/test-public-access.sh scripts/verify-public-access-cn.sh scripts/pinggy-askpass.sh`：检查全部 Shell 入口。
- `pnpm public:verify-cn`：真实大陆公网验证；2026-07-20 自愈连接池重启后的健康测量为 `222QTgbxwauzBzSP100020nL2`，北京、长沙、广州、深圳、天津 5 个城市成功；首页测量为 `2ZSkjd3kT1zVWGFCf00020nL2`，北京、广州、深圳、长沙 4 个城市成功。

## 相关文档

- [技术架构与 API](../../03_technical/architecture_and_api.md)
- [测试、验收与部署](../../05_delivery/test_and_deployment.md)
- [数据模型、离线同步与冲突](../../03_technical/data_and_sync.md)
- [完赛结果、赛后分享与本地导出](results-share-and-export.md)
