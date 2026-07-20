# 公开歌单导入与歌曲检查

## 功能范围与用户入口

- `/` 接收 QQ 音乐或网易云音乐公开歌单链接，先在浏览器识别平台并校验链接，再调用 Worker 解析。
- 导入成功后同时写入 D1 不可变快照和设备 IndexedDB，随后进入 `/import/check`。
- 歌曲检查支持按歌名/歌手搜索、单条排除、批量全选/取消及恢复全部；重复歌曲按歌单原位置保持为独立条目，确认后进入 `/setup`。
- QQ 音乐服务端解析不可用时，前端自动改用 QQ Musicu JSONP 接口；网易云音乐仅走服务端解析。显式参数错误和对应平台导入开关关闭时不触发备用路径。

## 代码入口与职责

- `apps/web/src/features/import/HomePage.tsx`：导入表单、链接预校验和导入状态。
- `apps/web/src/features/import/SongCheckPage.tsx`：搜索、选择与排除交互。
- `apps/web/src/features/import/api.ts`：服务端优先客户端、JSONP 备用请求、脚本清理与超时控制。
- `apps/web/src/features/import/repository.ts`：IndexedDB 中的快照与独立赛事草稿。
- `apps/api/src/index.ts`：Worker 路由和错误映射。
- `apps/api/src/qq-music.ts`：无 Cookie 请求 QQ 音乐公开歌单并规范化响应。
- `apps/api/src/netease-cloud-music.ts`：无 Cookie 请求网易云音乐官方域名的公开歌单元数据，并分批补齐普通用户歌单的歌曲详情。
- `apps/api/src/snapshots.ts`：将快照与歌曲以 D1 批处理原子写入。
- `packages/domain/src/playlist.ts`：双平台链接识别、共享快照契约，以及 QQ/网易云响应规范化。
- `packages/domain/src/tournament.ts`：固定规模可用性、“所有歌曲随机”签表规模及后续抽签所需共享契约。

## 调用、数据与持久化

1. 前端调用 `parsePlaylistReference` 拒绝非 HTTPS 或非受支持域名链接。QQ 音乐兼容 `/n/ryqq/playlist/:id`、`/n/ryqq_v2/playlist/:id`、旧版 `/n/yqq/playlist/:id.html` 和分享页查询参数；网易云音乐兼容 `/playlist?id=:id`、`/#/playlist?id=:id`、`/m/playlist?id=:id`、旧版路径式链接，以及移动端常见的 `https://163cn.tv/:token` 官方短链接。
2. 网易云短链接只在 Worker 内以 `redirect: manual` 请求一次；响应必须是 3xx，且 `Location` 必须重新通过网易云公开歌单域名与路径校验，才会提取歌单 ID。浏览器不跨域展开短链接，也不会跟随到任意第三方地址。
3. QQ 分支请求公开歌单接口，`normalizeQqPlaylist` 只保留可识别歌名与歌手的条目；网络或服务端故障时，浏览器以 `no-referrer` JSONP 请求同一 Musicu 数据结构并生成本地快照。
4. 网易云分支先读取公开歌单详情。榜单通常直接带完整 `tracks`；普通用户歌单可能只带少量 `tracks`，因此 Worker 按完整 `trackIds` 去重后，以 100 首一批、最多 4 批并发调用歌曲详情接口，再按原 `trackIds` 顺序重建条目。重复歌曲仍以不同 `sourcePosition` 独立保存，超过 4096 首时明确拒绝而不静默截断。100 首批次已通过真实接口验证；4096 首极限情况下，标准链接最多产生 42 次外部请求，短链接因额外展开最多产生 43 次，均保留在 Workers 免费套餐每次调用 50 次子请求的边界内。
5. `savePlaylistSnapshot` 用一个 D1 batch 写入快照和所有歌曲；每条多行语句限制为 8 首，兼容 D1 的 SQLite 绑定参数上限。
6. API 返回快照后，前端在一个 IndexedDB 事务中写入 `snapshots` 和独立 `drafts`，只在 `localStorage` 保存当前草稿 ID。
7. 歌曲检查只修改 `TournamentDraft.selectedSongIds`，不修改快照歌曲。
8. 若 QQ 快照来自 JSONP 备用路径，进入云端抽签前调用 `POST /api/playlists/browser-snapshot`；Worker 重新生成快照/歌曲 ID、限制 2~4096 首、清理媒体字段并只接受 QQ 域名封面，然后写入 D1。前端按 `sourcePosition` 重建已选歌曲 ID，再创建云端草稿。

迁移 `apps/api/migrations/0001_playlist_snapshots.sql` 创建 `playlist_snapshots` 与 `snapshot_songs`。`snapshot_songs` 以 `(snapshot_id, source_position)` 唯一约束保留同一来源歌曲的重复出现。

迁移 `apps/api/migrations/0011_netease_playlist_import.sql` 在延迟外键检查的单个迁移事务内复制并重建 `playlist_snapshots`，把平台约束扩展为 `qq_music / netease_cloud_music`，保留现有快照主键及所有草稿、赛事、歌曲外键，同时新增 `netease_import` 功能开关。

## 状态、不变量与失败处理

- 每次导入创建新的 UUID 快照；没有更新快照内容的 API。
- 云端与本地快照共享同一数据契约；Worker 成功响应为 `cloud`，浏览器备用成功为 `local`，后续云端草稿仍以对应快照 ID 为依据。
- 任一平台请求、响应结构或 D1 写入失败时，API 返回结构化错误，前端不会创建本地半成品草稿。
- IndexedDB 内快照和赛事草稿分表，排除或恢复歌曲不会改写原始歌单快照。
- JSONP 脚本显式禁用 Referer，完成或超时后删除脚本、全局回调和计时器，避免重复导入残留。
- 网易云音乐没有浏览器备用路径；服务端不可用时保留明确错误，不把只返回少量内嵌歌曲的响应保存为不完整快照。
- 浏览器上传的快照不信任客户端 ID、媒体 URL、试听 URL或导入时间；这些字段全部由 Worker 重建。备用导入断网时可完成检查和设置，恢复联网后才能提升快照并创建云端草稿。
- `public/sw.js` 为生产构建提供同源静态资源缓存和离线导航壳；赛事离线事件队列见独立功能说明。

## 验证路径

- `pnpm test`：双平台链接解析、网易云分批补齐、重复歌曲、不可识别条目以及赛事规模/抽签领域规则测试。
- `pnpm typecheck`：共享包、Web 与 Worker 类型检查。
- `pnpm build`：Vite 生产构建、共享包编译与 Wrangler dry-run。
- `pnpm db:migrate:local`：本地 D1 迁移。
- 启动 `pnpm dev` 后，用两个平台的公开歌单分别调用导入 API，可核对 `playlist_snapshots`、`snapshot_songs` 与来源平台；浏览器断开 Worker 后，QQ 链接应自动通过 JSONP 进入 `/import/check`，网易云链接应明确提示服务端不可用。QQ 备用路径已用歌单 `7052783065` 实测导入 1243 首歌曲。
- 本次在隔离 D1 与本地 Worker 中实测：普通网易云歌单 `6819106603` 从只内嵌少量详情的响应补齐并保存 91 首；短链接 `https://163cn.tv/Kzh05tW` 展开后保存 6 首，两次 Queue 均消费成功。`0011` 迁移前写入的 QQ 快照及 16 首歌曲在迁移后全部保留，外键检查无异常。

## 外部能力边界

- [网易云音乐开放平台](https://developer.music.163.com/st/developer/)及其官方文档目录明确提供[获取歌单详情](https://developer.music.163.com/st/developer/document?docId=730b0a8b80e745dea3b9f354eddb467e)和[获取歌曲详情](https://developer.music.163.com/st/developer/document?docId=2f583c5e2d764bbabaa221865f62dbc4)能力，但正式使用需要开发者入驻、应用审核和 API 权限。
- 当前代码调用的是 `music.163.com` 官方域名公开 Web 元数据接口，不携带用户 Cookie 或平台密钥，也不获取播放地址；它不等同于正式 OpenAPI 授权，接口变化时应由独立 `netease_import` 开关快速关闭。商业化前的正式授权仍以[延后范围](../../05_delivery/future_scope.md)为准。

## 相关文档

- [核心流程与页面](../../01_product/core_flows_and_pages.md)
- [业务规则](../../02_rules/business_rules.md)
- [技术架构与 API](../../03_technical/architecture_and_api.md)
- [数据与同步](../../03_technical/data_and_sync.md)
- [视觉与组件](../../04_design/visual_and_components.md)
- [测试与部署](../../05_delivery/test_and_deployment.md)
