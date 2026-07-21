# 技术架构与 API 轮廓

## 技术栈
- pnpm monorepo
- 前端：React + TypeScript + Vite
- API：Cloudflare Workers
- 数据库：Cloudflare D1
- 单设备编辑权与关键原子操作：Durable Objects
- 轻量任务：Cloudflare Queues
- 本地缓存：IndexedDB
- 离线壳：Service Worker（普通网页，不做 PWA 安装）
- 测试：Vitest + Playwright

## 免费套餐约束下的关键策略
- 不使用 Cloudflare Paid 功能；
- 不使用 Cloudflare Containers；
- 导出图不走云端渲染；
- 中途分享取消，减少实时同步压力；
- 后台保持最小化。

## 中国大陆临时公网中转

`workers.dev` 在部分中国大陆网络不可达时，仓库提供一个不复制生产数据的临时中转入口：

```text
中国大陆浏览器 → Pinggy HTTPS → 本机 SSH 反向隧道
                 → 127.0.0.1 Node 固定上游代理 → 生产 Worker
                 → 原 D1 / Durable Objects / Queues
```

中转代理只允许访问配置中的固定生产 origin，默认监听 `127.0.0.1`；`/__public-access/health` 同时返回本次随机 `bootId` 并实时请求生产 `/api/health`，启动脚本只有在公网响应与当前 `bootId` 一致时才接受入口。代理使用可替换的 Undici 环境代理连接池；上游网络请求异常时丢弃旧连接池并重新读取当前 `HTTP_PROXY / HTTPS_PROXY / NO_PROXY`。`GET / HEAD / OPTIONS` 最多自动重试一次，`POST / PATCH / DELETE` 等写请求只重建后续请求使用的连接池、不自动重放本次请求，避免重复业务写入。页面和 `/api/*` 继续由同一个生产 Worker 处理，因此赛事令牌、编辑租约、版本、分享和异步事件仍只有一份权威状态。

该入口使用 Pinggy 免费 HTTPS 隧道，只用于临时访问和验收：地址与进程绑定，约 60 分钟后失效，本机休眠、网络/代理中断或隧道退出都会终止入口。它不替代中国大陆备案、境内部署或可用性 SLA；恢复链接、IndexedDB、Service Worker 和分享链接都受浏览器 origin 约束，地址变化后不能沿用旧入口生成的完整链接。

## Windows 本机固定公网入口

当前 Windows 主机还提供一套与 Cloudflare 生产数据隔离的本机部署：Vite 以 `/sowocu/` 为公开基路径构建，自动启动的 `song-world-cup-local-server` Windows 服务通过 Wrangler 本地运行时在 `127.0.0.1:8787` 承载同一 Worker、静态资产、D1、Durable Object 与 Queue；`local-nginx` 同时监听 `6498` 和 frpc 使用的 `9864`，把 `/sowocu/` 剥离后转发到 Worker 根路径。公网链路为 `14.22.85.30:6498 → frpc → 127.0.0.1:9864 → local-nginx → 127.0.0.1:8787`。

Worker 不监听局域网地址，管理令牌随机生成并仅保存在 `.local-server/`；公网只开放网关中的 `/sowocu` 路由。浏览器侧的 Router、API、恢复链接、分享链接与 Service Worker 均从 Vite `BASE_URL` 计算前缀，根路径 Cloudflare 构建仍保持兼容。

现有 frp 只提供 HTTP TCP 入口。`127.0.0.1` 在浏览器中属于可信回环上下文，Service Worker 可用；公网 IP 的 HTTP origin 不是安全上下文，Service Worker、离线壳和其他要求 HTTPS 的 Web 能力不可用，请勿通过该入口传输后台令牌或敏感生产数据。浏览器端草稿、设备、离线事件和 QQ JSONP 回调标识在该入口下以 `crypto.getRandomValues` 生成 RFC 4122 v4 UUID，不使用非加密随机数；安全上下文仍优先调用原生 `crypto.randomUUID`。正式公网使用需要在 frp 或其前置代理补充受信任的 HTTPS。

## API 轮廓
- `POST /api/playlists/resolve`：识别平台并解析 QQ 音乐或网易云音乐公开歌单
- `POST /api/playlists/browser-snapshot`：校验并持久化浏览器备用快照
- `POST /api/drafts`：创建云端草稿
- `GET /api/drafts/:id`：凭恢复令牌读取云端草稿与对应快照歌曲
- `PATCH /api/drafts/:id`：更新草稿
- `POST /api/drafts/:id/redraw`：重新抽签
- `POST /api/drafts/:id/start`：正式开始
- `GET /api/tournaments/:id`：读取赛事
- `POST /api/tournaments/:id/picks`：提交选择事件
- `POST /api/tournaments/:id/events`：批量提交 1–256 个连续的 `pick / lock_round` 事件
- `POST /api/tournaments/:id/lock-round`：锁定当前轮并生成下一轮

赛事变更请求使用 `version` 防止旧状态覆盖，并携带 `eventId / sequence` 支持离线队列幂等重放；相同事件重复提交返回当前结果，同顺序号不同事件返回冲突。批量接口在 Durable Object 内先校验编辑租约和连续顺序，再用共享领域状态机回放整批事件，最后只执行一次带版本与最后顺序号条件的 D1 更新；整批成功或整批失败，重试已落库的同一批次不会重复应用。
- `POST /api/tournaments/:id/heartbeat`：续租编辑权
- `POST /api/tournaments/:id/takeover`：接管编辑
- `POST /api/tournaments/:id/branch`：把经过原签表状态机校验的本地进度另存为独立赛事

赛事写入和租约请求都携带 `X-Device-ID`。Worker 将同一赛事路由到同一个 SQLite Durable Object；其声明式 `exports` 配置负责对象生命周期，内部 `fetch` 入口串行校验租约后再执行 D1 版本更新。当前租约活跃期为 45 秒，离线保护期为最后一次心跳后的 5 分钟。
- `POST /api/tournaments/:id/open-share`：开放赛后分享
- `POST /api/tournaments/:id/close-share`：关闭分享
- `POST /api/tournaments/:id/reset-share-link`：重置分享链接
- `GET /api/share/:token`：赛后只读数据

分享记录由 `0005_tournament_shares.sql` 创建，默认不存在；只有完赛赛事的创建者主动开放分享或下载带二维码的对阵图时才生成随机令牌。对阵图下载复用同一 `open-share` 契约静默开放只读分享，取得当前有效 `/share/:token` 后在浏览器本地生成二维码；重置会替换令牌，公共读取同时校验 `is_open = 1` 与赛事已完成。对阵图与二维码合成完全在浏览器 Canvas 生成，不上传图片、不经过 Worker 渲染。
- `POST /api/migration/claim`：登录后迁移赛事
- `POST /api/auth/mock`：本地或演示模式模拟微信 / QQ 登录
- `GET /api/auth/:provider/start`：生成一次性 OAuth state 与正式授权地址
- `GET /api/auth/:provider/callback`：校验一次性 state、交换平台凭证并建立账号会话
- `GET /api/auth/session`、`DELETE /api/auth/session`：读取或注销当前会话
- `GET /api/account/tournaments`：读取当前账号拥有的赛事
- `GET /api/admin/overview`：后台总览
- `PATCH /api/admin/feature-flags`：功能开关

正式 OAuth 路径包含微信与 QQ 的授权码、token 和用户资料交换代码；当前仓库未包含平台密钥，部署默认保留模拟 Provider。后台必须通过 Worker secret 显式配置 `ADMIN_TOKEN`，生产构建不会展示本地演示令牌。

歌单成功导入会向 `EVENT_QUEUE` 写入 `playlist_imported` 事件，Queue consumer 将批次持久化到 `app_events`。当前配置批量上限 10、等待 5 秒、失败重试 3 次，符合 Workers 免费套餐可用的 Queues 能力边界。

网易云音乐官方开放平台提供“获取歌单详情”和歌曲详情能力，但需要完成开发者入驻、应用审核并申请相应 API 权限。当前无平台凭证的生产实现只在 Worker 内请求网易云音乐官方域名的公开 Web 元数据接口：先读取公开歌单及完整歌曲 ID，再按 100 首一批、最多 4 批并发补取歌曲名称、歌手、专辑与时长；不请求播放地址、不读取 Cookie。该接口不是已授权 OpenAPI 契约，商业化前必须切换到审核后的正式能力。
