# 测试、验收与部署

## 测试策略
- 单元测试：抽签、轮空、锁轮、结果统计、导出布局；
- 集成测试：导入 → 过滤 → 抽签 → 开赛 → 完赛 → 赛后分享；
- E2E：手机端比赛主流程、离线继续、接管与冲突、分享与导出；
- 视觉回归：关键页面与组件状态；
- 浏览器兼容：现代 iOS / Android / 桌面 Chrome / Edge / Safari / Firefox。

## 验收重点
- QQ 音乐公开歌单可导入；
- 网易云音乐公开歌单可导入，并能在歌单详情只内嵌部分歌曲时按完整歌曲 ID 补齐名称与歌手；
- 歌曲检查与排除正确；
- 抽签预览可无限重抽；
- 正式开始后数据正确锁定；
- 手机端四场对决操作顺畅；
- 左右赛区与锁轮逻辑正确；
- 八强 / 半决赛 / 决赛页面切换正确；
- 已加载赛事断网后仍可继续；
- 赛后只读分享仅在主动开放后生成；
- 海报与纯对阵图可本地生成。

## 部署要求
- Cloudflare 仅用免费套餐；
- 若本机代理影响 Wrangler，则先完成本地开发与测试，再在最后阶段处理远程开发与部署；
- 最终需要部署到 `workers.dev` 并返回访问地址。

## 当前可执行验收

- `pnpm test`：领域、Web 仓储/导出和 Worker 单元测试；
- `pnpm test:public-access`：固定上游反向代理、启动健康检查和大陆探测结果判定测试；
- `pnpm typecheck`：全部 TypeScript 工作区；
- `pnpm build`：先构建共享包与 Vite，再执行包含静态资产、D1、Durable Object 和 Queue 绑定的 Wrangler dry-run；
- `pnpm test:e2e`：在 Vite 生产预览中运行移动端 16 强至决赛主流程、离线选择与刷新、第二设备只读、主动分享、两类 PNG 下载、模拟登录、赛事认领与旧恢复链接失效、迁移页和后台。
- `pnpm public:start`：通过本机固定上游代理和 Pinggy HTTPS 出站隧道临时公开现有 Cloudflare 生产站；实际 URL、PID 和日志写入忽略提交的 `.public-access/`。
- `pnpm public:service:install`：安装/更新无需管理员权限的用户级 macOS LaunchAgent；服务不随登录立即启动，也不会在隧道退出后自动换址。
- `pnpm public:refresh`：面向无人值守任务通过 LaunchAgent 安全重启本项目入口，并在 URL、`bootId` 和生产健康检查一致后返回。
- `pnpm public:verify-cn`：从 5 个中国大陆节点分别验证当前 `bootId`/生产健康状态和真实首页，默认至少要求 2 个不同城市成功。
- Codex 本地每小时自动化：依次刷新入口、校验当前实例、执行大陆探针，再通过 Gmail 发送最新地址；失败时禁止发送旧 URL，只发送故障说明。该配置保存在用户的 Codex 自动化目录，不属于仓库数据。

## 当前验证与发布状态

- 2026-07-20 本地验证：领域测试 21 项、Web 测试 7 项、Worker 测试 11 项、移动端 E2E 2 项全部通过；类型检查、生产构建、Wrangler dry-run、生产依赖审计和 Markdown 链接检查通过。
- 2026-07-20 网易云音乐导入扩展验证：领域测试 30 项、Web 测试 9 项、Worker 测试 15 项、移动端 E2E 2 项全部通过；全仓类型检查、生产构建、Wrangler dry-run、`git diff --check` 和 Markdown 本地链接检查通过。
- 隔离 D1 迁移验证先应用 `0001` 至 `0010` 并写入 1 个 QQ 快照/16 首歌曲，再应用 `0011_netease_playlist_import.sql`：旧数据全部保留、`PRAGMA foreign_key_check` 无结果、`netease_import = 1`，且可写入 `netease_cloud_music` 快照。
- 本地真实 Worker 验证：普通网易云歌单 `6819106603` 按完整 `trackIds` 导入 91 首；官方短链接 `https://163cn.tv/Kzh05tW` 安全展开后导入 6 首。两次均返回 201、写入 D1 不可变快照，并由本地 Queue `1/1` 消费。
- 2026-07-20 已部署到 [song-world-cup.baituola-song-world-cup.workers.dev](https://song-world-cup.baituola-song-world-cup.workers.dev)。Worker 同时托管 SPA 静态资产与 `/api/*`，Durable Object 导出为 `TournamentCoordinator`。
- 远端 D1 `song-world-cup` 位于 APAC，`0001` 至 `0010` 全部应用且无待执行迁移；Queue `song-world-cup-events` 已绑定 1 个生产者和 1 个消费者；`ADMIN_TOKEN` 已写入 Worker secret，本机副本存放在 macOS 钥匙串服务 `song-world-cup.cloudflare.ADMIN_TOKEN`。
- 线上冒烟验证：生产首页与 `/admin` 深链接可渲染；公开 QQ 歌单“随便放”实际导入 1255 首并写入不可变快照；成功创建 16 强云端草稿、启动赛事、取得编辑租约并同步一次选胜；后台 secret 鉴权成功，远端 D1 与 Queue 消费结果可查询。
- 当前 `AUTH_MODE=mock`，微信与 QQ 正式 OAuth 代码已完成，但仓库不含第三方平台密钥。代码已完成，生产联调待凭证；取得微信/QQ 凭证后再切换 OAuth 模式并验证真实授权回调。
- 2026-07-20 网易云音乐导入已发布到生产环境，Cloudflare Worker 版本为 `46f6cdaf-4966-46ad-ad92-14ae712d3f67`。执行 `0011` 前已导出远端 D1 备份；迁移前后均保留 3 个快照与 3765 首歌曲，外键检查无异常。公网冒烟使用歌单 `14339440319` 成功导入并保存 6 首歌曲，Queue 已消费对应 `playlist_imported` 事件；验证后生产库共 4 个快照、3771 首歌曲。
- 2026-07-20 中国大陆临时公网中转已完成真实验收。非交互启动生成 Pinggy HTTPS 地址后，生产健康检查在成都、北京、深圳、天津、广州 5 个大陆节点均返回匹配本次 `bootId` 的 200；真实首页在广州、深圳、北京、天津、成都 5 个大陆节点均返回 200 和“歌曲世界杯”标题，其中深圳首页节点位于 Chinanet Backbone。可复核的 Globalping 测量为[健康检查 `2lAEEAf2qCL2lYBng00020nJE`](https://globalping.io?measurement=2lAEEAf2qCL2lYBng00020nJE)和[首页 `2olnRTNlaP2t6CU3u00020nJE`](https://globalping.io?measurement=2olnRTNlaP2t6CU3u00020nJE)。验收 URL 属于约 60 分钟有效的免费临时地址，当前运行地址以 `.public-access/public-url.txt` 为准。
- 2026-07-20 每小时公网入口邮件链路已完成验收：用户级 LaunchAgent 在刷新命令退出后继续托管代理与隧道，连续两次刷新会停止旧管理进程并生成不同 URL；最新一轮大陆健康检查在宁波、深圳通过，首页在北京、广州、上海、天津、深圳通过，对应 [Globalping 健康测量](https://globalping.io?measurement=2fL142gzoQGNPoq3b00020nKG)和[首页测量](https://globalping.io?measurement=2TCfhnyxfJjKrFFCR00020nKG)。Codex 每小时自动化已启用，Gmail 首封最新地址邮件发送并回读成功。
