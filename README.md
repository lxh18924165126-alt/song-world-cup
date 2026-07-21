# 歌曲世界杯 · 设计与开发交付包

仓库现包含设计交付物与第一版可运行实现：

1. `mockups/`：前端效果图 PNG；
2. `prototype/`：静态 HTML/CSS/JS 原型；
3. `docs/`：拆分后的项目开发需求文档；
4. `CODEX_PROMPT.md`：完整开发与交付范围；
5. `apps/` 与 `packages/`：React 前端、Cloudflare Worker 和共享领域代码；
6. `e2e/`：Playwright 手机端完整赛事验收。

当前需求理解已达到可执行级别，核心玩法、页面结构、数据边界、Cloudflare 免费套餐约束、离线策略、分享策略与导出策略都已冻结。

## 开发状态

第一版生产代码已覆盖导入、检查、抽签、比赛、离线与编辑权、赛果、主动分享、本地导出、账号迁移、模拟登录和运营后台。当前工作区、功能边界和真实命令见 [`docs/06_codebase/README.md`](docs/06_codebase/README.md)。

本地启动：先运行 `pnpm install`、`pnpm db:migrate:local`，再运行 `pnpm dev`。全量检查使用 `pnpm test`、`pnpm typecheck`、`pnpm build` 和 `pnpm test:e2e`。

线上地址：[歌曲世界杯](https://song-world-cup.baituola-song-world-cup.workers.dev)。当前部署已支持 QQ 音乐与网易云音乐公开歌单导入，并使用模拟登录 Provider；微信与 QQ 正式 OAuth 联调仍需对应平台凭证。

## Windows 本机公网部署

固定本机部署不连接原 Cloudflare 生产数据。执行 `pnpm local:prepare` 会以 `/sowocu/` 为公开基路径构建前端、应用本地 D1 迁移，并在忽略提交的 `.local-server/` 中创建持久化状态与随机后台令牌。首次部署再运行 `pnpm local:service:install` 并确认 UAC，即可安装自动启动的 `song-world-cup-local-server` Windows 服务；Worker 仅监听 `127.0.0.1:8787`。`pnpm local:start` 可启动已安装的服务或开发用后台进程，停止命令为 `pnpm local:stop`。

`E:\code\local-nginx` 将 `/sowocu/` 剥离前缀后转发到该 Worker。网关重载后，本机入口为 `http://127.0.0.1:6498/sowocu/`，现有 frp 公网入口为 [http://14.22.85.30:6498/sowocu/](http://14.22.85.30:6498/sowocu/)。后台令牌保存在 `.local-server/admin-token.txt`，不得写入文档、日志或提交。完整运行和恢复说明见 [`docs/06_codebase/local-windows-deployment.md`](docs/06_codebase/local-windows-deployment.md)。

当前 frp 入口只有 HTTP，不属于浏览器安全上下文：页面和 API 可访问，但公网 origin 不能启用 Service Worker，且不应在公网使用后台令牌或承载敏感生产数据。本机回环入口可正常启用离线壳；若要把公网入口用于正式数据，必须先在穿透入口补充受信任的 HTTPS。

## 中国大陆临时公网入口

当大陆网络无法直连 `workers.dev` 时，运行 `pnpm public:start`。脚本会把现有 Cloudflare 生产站通过固定上游的本机反向代理和 Pinggy HTTPS 出站隧道临时公开，不会创建第二套 D1、Durable Object 或 Queue 数据。实际地址写入 `.public-access/public-url.txt`，保持命令、本机网络和代理持续运行；免费隧道约 60 分钟后失效。

另开终端运行 `pnpm public:verify-cn`，会从中国大陆多个探测节点同时检查本次启动标识、Cloudflare 上游健康状态和真实首页标题，并把报告写入 `.public-access/cn-verification.json`。免费入口首次用浏览器打开时会显示 Pinggy 确认页，确认后进入应用。

无人值守刷新先执行一次 `pnpm public:service:install` 安装当前用户的 macOS LaunchAgent，再使用 `pnpm public:refresh`。刷新命令会安全替换上一代本项目隧道，由系统后台服务保持新入口，并在公网健康检查通过后输出 URL。Codex 每小时自动化基于该命令刷新入口、运行大陆节点验收，再通过 Gmail 发送最新地址；电脑、Codex 桌面应用、网络和本机代理必须持续运行。
