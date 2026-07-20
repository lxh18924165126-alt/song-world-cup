# 单设备编辑租约与接管

## 功能范围与用户入口

- 赛事在线打开时，浏览器使用本地持久设备 ID 申请编辑权；持权设备每 15 秒续租。
- 同一赛事在任一时刻只允许一个设备向云端写入。其他设备仍可查看，但比赛选择和锁轮变为只读。
- 持权设备离线后保留 5 分钟保护期；保护期结束后，其他设备可从比赛页接管编辑权并重新加载云端最新进度。
- 网络不可用时，已缓存设备仍可继续写入本地有序队列；恢复联网后先确认编辑权，再尝试回放。
- 若本地队列与云端分叉，页面只允许放弃本地操作并使用云端，或把本地状态另存为独立新赛事。

## 代码入口与职责

- `apps/web/src/features/tournament/device.ts`：生成并在 `localStorage` 持久化设备 ID。
- `apps/web/src/features/tournament/api.ts`：为赛事写入附加设备 ID，并提供心跳、接管及租约错误载荷。
- `apps/web/src/features/tournament/PlayPage.tsx`：定时心跳、只读提示、保护期倒计时、接管入口和联网恢复顺序。
- `apps/web/src/features/tournament/repository.ts`：识别租约冲突，保留未确认的本地事件且停止自动重试。
- `apps/api/src/lease.ts`：租约获取、续租、保护期和代次递增的纯状态机。
- `apps/api/src/coordinator.ts`：按赛事 ID 隔离的 Durable Object；在同一串行入口内校验租约并调用 D1 赛事变更。
- `apps/api/src/index.ts`：`heartbeat / takeover / picks / lock-round` 路由、设备 ID 校验及 Durable Object 内部请求。
- `apps/api/src/tournaments.ts`：从原签表重放并校验本地分支，复制来源草稿并创建独立赛事。

## 调用、数据与持久化

1. Worker 通过 `TOURNAMENT_COORDINATOR.getByName(tournamentId)` 把同一赛事路由到同一个 Durable Object。
2. Durable Object 使用 SQLite 存储保存 `deviceId / generation / heartbeatAt / activeUntil / protectUntil`，配置由 `wrangler.jsonc` 的 `durable_objects.bindings` 与声明式 `exports` 定义。
3. 首次心跳创建第 1 代租约；同设备心跳延长 45 秒活跃期和 5 分钟离线保护期。
4. 其他设备在保护期内获得 409 `edit_lease_required`，响应包含接管时间；保护期结束后接管会创建下一代租约。
5. 选择和锁轮也先在 Durable Object 内申请或续租；未持权请求不会到达 D1 状态机。

## 状态、不变量与失败处理

- 恢复令牌仍是赛事读取与写入的创建者凭证；设备 ID 只标识同一浏览器安装，不能代替授权。
- Durable Object 负责同赛事请求串行化，D1 的版本和事件顺序约束仍是持久数据的第二道防线。
- 只读设备不会生成新的本地选择；租约冲突时已有队列保留，且不会因自动重试形成请求循环。
- 接管后页面只在没有本地待同步事件时加载云端进度；有冲突时不会自动合并或覆盖。
- “使用云端进度”清空旧赛事的本地队列；“另存为新赛事”保留原赛事记录，并跳转到带新恢复令牌的独立赛事。

## 验证路径

- `apps/api/src/lease.test.ts` 覆盖首次获取、续租、保护期内拒绝和到期接管代次递增。
- 本地 Worker 实测首设备心跳为 200；第二设备心跳、提前接管和写入均为 409；持权设备写入进入正常领域校验。
- 本地 Worker 实测合法进度可创建分支并凭新令牌恢复，注入原签表外歌曲的分支返回 400。
- `pnpm --filter @song-world-cup/api build` 验证 Durable Object 与 D1 绑定进入 Worker 包。

## 相关文档

- [业务规则](../../02_rules/business_rules.md)
- [技术架构与 API](../../03_technical/architecture_and_api.md)
- [数据与同步](../../03_technical/data_and_sync.md)
- [赛事离线缓存与顺序同步](offline-tournament-sync.md)
- [测试与部署](../../05_delivery/test_and_deployment.md)
