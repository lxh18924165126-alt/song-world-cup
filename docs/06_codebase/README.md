# 代码功能阅读说明

## 当前状态

仓库已进入生产实现阶段，第一版产品代码已覆盖公开歌单导入、歌曲检查、赛事设置与抽签、正式比赛、关键赛段、离线同步、编辑租约、结果分享、本地导出、我的赛事、账号迁移、模拟登录、运营后台和事件队列。`prototype/index.html` 仍是设计交付物，不计入生产代码覆盖。

生产部署地址：[歌曲世界杯](https://song-world-cup.baituola-song-world-cup.workers.dev)。Cloudflare Worker、D1、Durable Object 与 Queue 已完成远端部署和冒烟验证，网易云音乐导入与 `0011` 迁移已于 2026-07-20 发布；正式微信/QQ OAuth 仍待平台凭证联调。

## 实际工作区

- `apps/web`：React + TypeScript + Vite 前端，承载导入、歌曲检查、赛事设置、抽签预览、逐场选胜、专属决赛舞台、对阵总览、结果分享、本地 PNG、我的赛事、迁移、后台、IndexedDB 草稿/赛事/事件队列和离线壳。
- `apps/api`：Cloudflare Worker API、D1 迁移、Durable Object 与 Queue，承载 QQ 音乐/网易云音乐公开歌单解析、不可变快照、云端草稿、赛事状态机、单设备编辑协调、账号与所有权、分享、后台和应用事件。
- `packages/domain`：前后端共享的歌单、快照、赛事草稿、签表和比赛状态机类型与纯领域函数。

根 `package.json` 是命令入口，`pnpm-workspace.yaml` 定义工作区和依赖构建脚本白名单。

## 当前命令

- `pnpm install`：安装全部工作区依赖。
- `pnpm dev`：并行启动 Vite 与本地 Worker。
- `pnpm db:migrate:local`：应用本地 D1 迁移。
- `pnpm typecheck`：检查所有工作区 TypeScript。
- `pnpm test`：运行所有工作区测试。
- `pnpm test:public-access`：验证生产站反向代理和大陆探测判定逻辑。
- `pnpm test:e2e`：运行 Playwright 手机端主流程、离线、编辑权、分享、导出、登录与后台测试。
- `pnpm build`：构建共享包、前端，并对 Worker 执行部署前 dry-run 打包。
- `pnpm public:start`：启动现有生产站的本机反向代理与 Pinggy HTTPS 临时公网入口。
- `pnpm public:service:install`：安装/更新当前用户的 macOS LaunchAgent，为无人值守入口提供独立进程托管。
- `pnpm public:refresh`：安全替换旧入口，在后台保持新隧道并等待公网健康检查通过，供无人值守任务调用。
- `pnpm public:verify-cn`：从中国大陆节点验证当前临时入口的健康状态和真实首页。

## 功能说明索引

- [公开歌单导入与歌曲检查](features/playlist-import-and-check.md)
- [赛事设置与抽签预览](features/draft-and-draw-preview.md)
- [正式开赛与逐轮比赛](features/tournament-play.md)
- [赛事离线缓存与顺序同步](features/offline-tournament-sync.md)
- [单设备编辑租约与接管](features/edit-lease-and-takeover.md)
- [完赛结果、赛后分享与本地导出](features/results-share-and-export.md)
- [账号、我的赛事与迁移认领](features/account-and-migration.md)
- [运营后台与应用事件](features/admin-and-events.md)
- [中国大陆临时公网中转](features/public-access-relay.md)

## 目录职责

本目录用于帮助后续 Agent 和维护者按“功能能力”阅读已经落地的代码：

- 本文件维护功能说明索引、实际工作区/服务边界和权威命令来源。
- `features/<stable-feature-name>.md` 保存端到端功能说明；只在对应代码真实存在时创建。
- 若出现跨多个功能共享且足够稳定的基础设施，再按实际代码建立 `foundations/`；不要预建空目录或占位文件。

## 功能说明最小结构

每份功能说明应包含：

1. 功能范围与用户入口；
2. 真实代码入口、关键模块及职责；
3. 调用链、数据流、API/schema/持久化；
4. 状态、不变量、离线/并发/失败处理；
5. 直接相关测试、验证命令与调试入口；
6. 相关产品、业务、架构和部署文档。

内容只描述当前仓库可复核的事实。实现、重构、重命名或删除功能时，在同一改动中更新说明和本索引；详细执行规则由根 `AGENTS.md` 直接路由到 `docs/agent/code-documentation.md`。
