# 运营后台与应用事件

## 功能范围与用户入口

- `/admin` 通过管理员令牌读取最近 24 小时导入量、进行中/已完成赛事、开放分享数和账号数。
- 后台可分别切换 QQ 音乐导入、网易云音乐导入、QQ 浏览器备用解析、赛后分享、微信登录和 QQ 登录，并查看最近审计日志。
- 歌单成功导入后通过 Cloudflare Queue 异步写入 `app_events`，不阻塞导入响应。

## 代码入口与职责

- `apps/web/src/features/admin/AdminPage.tsx`、`api.ts`：后台鉴权、指标、功能开关和审计表格。
- `apps/api/src/admin.ts`：管理员 secret 校验、并行指标查询、开关更新和审计写入。
- `apps/api/src/events.ts`：Queue 消息契约、事件创建和批次消费。
- `apps/api/src/index.ts`：后台路由、功能开关门禁、Queue producer 与 consumer 入口。
- `0008_admin_controls.sql`、`0009_app_events.sql`、`0011_netease_playlist_import.sql`：功能开关、审计日志、应用事件与网易云导入开关。

## 配置、状态与失败处理

- `ADMIN_TOKEN` 必须由环境显式提供；本地 `pnpm dev` 通过 Wrangler `--var` 注入演示令牌，生产构建不显示该值。
- 生产部署使用 `wrangler secret put ADMIN_TOKEN`，不得把令牌写入 `wrangler.jsonc`。
- 当前生产令牌的本机副本保存在 macOS 钥匙串；需要进入后台时可运行 `security find-generic-password -a song-world-cup -s song-world-cup.cloudflare.ADMIN_TOKEN -w` 读取，令牌不得提交到仓库或粘贴到公开记录。
- 功能开关更新和审计记录在同一个 D1 batch 中提交；未知开关或无效参数返回 400。
- Queue producer 使用 `ExecutionContext.waitUntil` 异步发送；consumer 按事件 ID `INSERT OR IGNORE`，重复投递不会产生重复记录。
- 当前 Queue 配置为批量 10 条、最多等待 5 秒、失败重试 3 次；事件只记录快照 ID 与歌曲数，不包含恢复令牌或账号会话。

## 验证路径

- API 实测覆盖无令牌 401、真实指标读取、导入开关关闭后 503、重新开放和两条审计记录。
- 本地真实导入已观察到 Queue consumer `1/1`，D1 `app_events` 中存在对应 `playlist_imported` 与歌曲数。
- Playwright 覆盖移动端后台登录、真实指标、功能开关和审计日志渲染。

## 相关文档

- [技术架构与 API](../../03_technical/architecture_and_api.md)
- [数据与同步](../../03_technical/data_and_sync.md)
- [测试与部署](../../05_delivery/test_and_deployment.md)
