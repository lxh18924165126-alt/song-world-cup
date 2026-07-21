# Windows 本机部署与 `/sowocu` 公网路由

## 功能范围与入口

该部署模式在 Windows 本机运行完整 Worker 应用，不访问原 Cloudflare 生产 D1、Durable Object 或 Queue。公开入口固定为 `http://14.22.85.30:6498/sowocu/`，本机验收入口为 `http://127.0.0.1:6498/sowocu/`，Worker 直连健康检查为 `http://127.0.0.1:8787/api/health`。

## 代码与配置入口

- `scripts/prepare-local-server.ps1`：安装锁定依赖、以 `/sowocu/` 构建，将前端复制到 Git 忽略的 `.local-server/web-dist/` 独立资产目录，生成随机后台令牌、写入 `apps/api/.dev.vars`，并应用本地 D1 迁移。
- `scripts/start-local-server.ps1`：以前台方式启动 Wrangler 本地运行时，绑定 `127.0.0.1:8787`，并通过 `--assets` 固定读取 `.local-server/web-dist/`，避免普通根路径构建覆盖公网入口。
- `scripts/start-local-server-background.ps1` 与 `scripts/stop-local-server.ps1`：后台进程、健康检查、PID 与日志管理。
- `scripts/install-local-server-service-admin.ps1`：复用本机 `local-nginx` 的 WinSW 运行时，安装自动启动和失败重启的 `song-world-cup-local-server` Windows 服务。
- `apps/web/src/app/paths.ts`：统一计算 Router basename、API、Service Worker、恢复和分享路径。
- `apps/web/src/app/id.ts`：兼容公网 HTTP 非安全上下文的浏览器端加密随机 UUID。
- `apps/web/public/sw.js`：按 Service Worker scope 缓存 `/sowocu/` 应用壳，不清理同一网关其他应用的缓存。
- `E:\code\local-nginx\local_nginx_gateway.py`：生成 `/sowocu` 到 `127.0.0.1:8787` 的反向代理配置。

## 调用与数据流

浏览器请求 `/sowocu/*` 后，经 frp 到达 `local-nginx` 的 `9864` 监听端口。Nginx 剥离 `/sowocu`，把 `/api/*` 和 SPA/静态资产统一转发给 Worker；响应中的前端资源地址仍带 `/sowocu/`。本地服务静态资产固定存放在 `.local-server/web-dist/`，不会被日常 `pnpm build` 产生的 `apps/web/dist/` 根路径产物覆盖；服务端 D1、Durable Object 与 Queue 状态固定写入 `.local-server/wrangler-state/`，浏览器离线状态继续保存在当前公网 origin 下的 IndexedDB 和 Cache Storage。

## 安全与不变量

- Worker 只能监听 `127.0.0.1`，不能绕过网关暴露到局域网或公网。
- `.local-server/admin-token.txt` 首次准备时随机生成，并通过 Git 忽略的 `apps/api/.dev.vars` 注入 Wrangler；启动参数、进程命令行、日志和文档不得输出令牌。
- `/sowocu` 是唯一新增公网前缀，不能占用网关根路径、`/robot`、`/active`、`/downloads` 或 `/pmgo`。
- 本地状态不与远端生产状态互相迁移或覆盖；删除 `.local-server/` 等同于删除本机服务端部署数据。
- 当前公网入口是 HTTP，不得在公网提交后台令牌或敏感生产数据；Service Worker 只在受信任的本机回环入口启用，公网离线壳需等受信任 HTTPS 接入后使用。
- 公网 HTTP 中不可用的 `crypto.randomUUID` 由 `crypto.getRandomValues` 的 RFC 4122 v4 实现替代，覆盖双平台导入后的本地草稿、QQ JSONP 备用快照、设备 ID 和离线事件 ID；不得退回 `Math.random`。

## 运行、验证与恢复

首次部署依次执行 `pnpm local:prepare`、`pnpm local:service:install`，再重载 `local-nginx`；安装命令会请求一次 UAC。每次功能或界面改动验收后重新执行 `pnpm local:prepare`，再重启服务。验证顺序为 Windows 服务状态与 Worker `/api/health`、网关 `6498/sowocu/api/health`、frpc 本地入口 `9864/sowocu/api/health`、公网 `/sowocu/api/health`，最后检查首页、哈希资源、SPA 深链接；Service Worker 只在本机回环入口验收。

服务日志位于 `.local-server/service/logs/`；开发用后台启动日志位于 `.local-server/server.out.log` 和 `.local-server/server.err.log`。修复后重新运行 `pnpm local:start`，或重新执行服务安装命令更新服务配置。网关配置异常时先在 `E:\code\local-nginx` 运行配置测试和 `nginx -t`，只有配置通过后才重载。保留 `.local-server/wrangler-state/` 即可在重启后继续使用原本机数据。
