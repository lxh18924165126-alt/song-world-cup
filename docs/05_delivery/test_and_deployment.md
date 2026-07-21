# 测试、验收与部署

## 测试策略
- 单元测试：抽签、轮空、锁轮、结果统计、导出布局；
- 集成测试：导入 → 过滤 → 抽签 → 开赛 → 完赛 → 赛后分享；
- E2E：手机端比赛主流程、离线继续、接管与冲突、分享与导出，以及 4096 强画布的虚拟 DOM、选择反馈和镜头帧间隔；
- 视觉回归：关键页面与组件状态；
- 浏览器兼容：现代 iOS / Android / 桌面 Chrome / Edge / Safari / Firefox。
- Windows 公网 HTTP 兼容：验证缺少 `crypto.randomUUID` 时双平台导入、本地草稿、设备 ID 与离线事件仍使用加密随机 UUID 正常工作。

## 验收重点
- QQ 音乐公开歌单可导入；
- 网易云音乐公开歌单可导入，并能在歌单详情只内嵌部分歌曲时按完整歌曲 ID 补齐名称与歌手；
- 歌曲检查与排除正确；
- 抽签预览可无限重抽；
- 正式开始后数据正确锁定；
- 手机端四场对决操作顺畅；
- 左右赛区与锁轮逻辑正确；
- 固定画布自动平移、受控回看以及八强 / 半决赛 / 决赛舞台强化正确；
- 已加载赛事断网后仍可继续；
- 赛后只读分享仅在主动开放或下载带二维码的对阵图时生成；
- 超大画布对阵图及其公开赛果二维码可在设备本地生成，图片不上传。

## 部署要求
- Cloudflare 仅用免费套餐；
- 若本机代理影响 Wrangler，则先完成本地开发与测试，再在最后阶段处理远程开发与部署；
- 最终需要部署到 `workers.dev` 并返回访问地址。
- 用户明确选择 Windows 本机部署时，不发布新的 Cloudflare Worker；使用 Wrangler 本地运行时和独立本地状态，Worker 只监听 `127.0.0.1`，再由 `E:\code\local-nginx` 的专用前缀路由向公网开放。

## 当前可执行验收

- `pnpm test`：领域、Web 仓储/导出和 Worker 单元测试；
- `pnpm test:public-access`：固定上游反向代理、连接池失败自愈、安全方法重试/写方法不重放、启动健康检查和大陆探测结果判定测试；
- `pnpm typecheck`：全部 TypeScript 工作区；
- `pnpm build`：先构建共享包与 Vite，再执行包含静态资产、D1、Durable Object 和 Queue 绑定的 Wrangler dry-run；
- `pnpm local:prepare`：以 `/sowocu/` 构建、生成本机随机后台令牌，并向 `.local-server/wrangler-state/` 应用 D1 迁移；
- `pnpm local:start` / `pnpm local:stop`：后台启动或停止仅监听 `127.0.0.1:8787` 的本机 Worker；
- `pnpm local:service:install`：经 UAC 安装自动启动的 `song-world-cup-local-server` Windows 服务，并由服务保持 Worker 运行；
- `pnpm test:e2e`：使用隔离的 `14173 / 18787` 端口，在 Vite 生产预览中运行固定画布移动端 16 强至决赛主流程、4096 强首屏虚拟渲染与性能边界、离线选择与刷新、第二设备只读、主动分享、两类 PNG 下载、模拟登录、赛事认领与旧恢复链接失效、迁移页和后台；不会复用或停止 `8787` 上的常驻本地服务。
- `pnpm public:start`：通过本机固定上游代理和 Pinggy HTTPS 出站隧道临时公开现有 Cloudflare 生产站；实际 URL、PID 和日志写入忽略提交的 `.public-access/`。
- `pnpm public:service:install`：安装/更新无需管理员权限的用户级 macOS LaunchAgent；服务不随登录立即启动，也不会在隧道退出后自动换址。
- `pnpm public:refresh`：面向无人值守任务通过 LaunchAgent 安全重启本项目入口，并在 URL、`bootId` 和生产健康检查一致后返回。
- `pnpm public:verify-cn`：从 5 个中国大陆节点分别验证当前 `bootId`/生产健康状态和真实首页，默认至少要求 2 个不同城市成功。
- Codex 本地每小时自动化：依次刷新入口、校验当前实例、执行大陆探针，再通过 Gmail 发送最新地址；失败时禁止发送旧 URL，只发送故障说明。该配置保存在用户的 Codex 自动化目录，不属于仓库数据。

## 当前验证与发布状态

- 2026-07-21 固定签表画布改造：领域 30 项、Web 28 项、Worker 17 项单元测试和移动端 E2E 3 项通过；4096 强场景最多挂载三个视窗，自动检查单次选择反馈小于 100ms、运行期无 100ms 以上长任务且镜头采样 P95 帧间隔小于 35ms。全仓类型检查、生产构建、Wrangler dry-run、Markdown 本地链接与 `git diff --check` 通过；Windows 环境缺少 `bash`，未执行 `test:public-access`。
- 2026-07-20 公网 HTTP UUID 兼容修复：Chrome 在 `http://14.22.85.30:6498/sowocu/` 实测网易云歌单导入 554 首、QQ 音乐歌单导入 1255 首，均进入歌曲检查页且无页面或控制台错误；领域测试 30 项、Web 测试 18 项、Worker 测试 17 项和全仓类型检查通过，`pnpm local:prepare`、Markdown 本地链接检查与 `git diff --check` 通过。
- 2026-07-20 Windows 本机部署：`song-world-cup-local-server` 已安装为自动启动服务并仅监听 `127.0.0.1:8787`；本地 D1 的 `0001` 至 `0011` 无待执行迁移。`local-nginx` 已加载 `/sowocu` 路由，本机 `6498`、frpc 本地入口 `9864` 和公网 `http://14.22.85.30:6498/sowocu/` 的健康检查、首页、哈希资源与 SPA 深链接均返回 200。Chrome 实测本机 Service Worker 作用域为 `/sowocu/` 且已接管页面，公网首页和 `/mine` 深链接可渲染；公网 HTTP 不是安全上下文，未启用 Service Worker。
- 本机部署最终校验：领域测试 30 项、Web 测试 13 项、Worker 测试 17 项、`local-nginx` 测试 17 项全部通过；全仓类型检查、`/sowocu/` 生产构建、Wrangler dry-run、Windows PowerShell 5.1 解析、Nginx 配置语法、Markdown 本地链接和 `git diff --check` 通过。

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
- 2026-07-20 长驻公网回源改为可替换的 Undici 环境代理连接池，避免系统代理短暂中断后旧连接池持续返回 502；安全方法失败后换池补试一次，写方法换池但不自动重放。领域 30 项、Web 10 项、Worker 17 项和公网中转 10 项测试通过，类型检查与生产构建通过；重装 LaunchAgent 后，大陆健康检查在北京、长沙、广州、深圳、天津 5 个城市通过，首页在北京、广州、深圳、长沙 4 个城市通过，对应 [Globalping 健康测量](https://globalping.io?measurement=222QTgbxwauzBzSP100020nL2)和[首页测量](https://globalping.io?measurement=2ZSkjd3kT1zVWGFCf00020nL2)。
