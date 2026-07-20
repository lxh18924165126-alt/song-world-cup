# 赛事离线缓存与顺序同步

## 功能范围与用户入口

- 赛事首次在线打开后，把赛事、歌曲和恢复令牌写入 IndexedDB；此后断网仍可进入已缓存赛事并继续选胜、取消、改选和锁轮。
- 每次本地操作先立即更新页面，再写入按赛事排序的事件队列；联网后自动按顺序分批回放。
- 页面展示已同步、同步中、离线待同步和冲突四种状态，并显示待同步事件数。

## 代码入口与职责

- `apps/web/src/storage/database.ts`：IndexedDB v2 schema，包含快照、草稿、赛事缓存和赛事事件队列。
- `apps/web/src/features/tournament/repository.ts`：本地状态变更、事件入队、批量顺序回放、同赛事并发刷新合并、确认删除和冲突保留。
- `apps/web/src/features/tournament/PlayPage.tsx`：网络状态监听、即时本地交互、自动重试与同步提示。
- `apps/web/src/features/tournament/api.ts`：携带事件 ID、顺序号和服务端版本的单事件及批量赛事变更请求。
- `apps/api/src/tournaments.ts`：连续批次校验、事件幂等确认、领域状态机回放和带版本条件的单次原子赛事更新。
- `apps/web/public/sw.js`：安装时解析生产首页并预缓存 Vite 哈希 JS/CSS，运行时缓存同源静态资源与导航壳；明确排除 `/api/`，避免缓存旧赛事响应。

## 调用、数据与持久化

1. IndexedDB 的 `tournaments` 保存最近的服务端版本、乐观本地进度、歌曲、令牌、下一顺序号和同步时间。
2. `tournamentEvents` 以 `tournamentId + sequence` 建复合索引；事件分为 `pick` 和 `lock_round`。
3. 本地操作与事件写入在同一个 IndexedDB 事务中完成；锁轮也使用共享领域状态机，因此断网时可以继续生成下一轮。
4. 回放把连续事件切成最多 256 项的批次，每批携带基线 `version` 以及各事件的 `eventId / sequence`。Durable Object 校验一次编辑租约，服务端在内存中顺序回放后用单条条件更新写入进度、递增后的版本和最后事件身份。
5. 若服务端已接受整批事件但响应丢失，重试同一批次会通过最后事件身份和版本确认后返回当前赛事，不重复应用；批次缺号、同序号不同事件或旧版本返回 409。
6. 整批事件得到服务端确认后，缓存更新和对应队列删除在同一个 IndexedDB 事务中完成；请求期间新增的事件会重新应用到最新云端基线，保持界面乐观状态。同一赛事在页面切换前后并发触发刷新时复用同一个进行中的任务。

迁移 `apps/api/migrations/0004_tournament_event_identity.sql` 为赛事增加最后事件 ID 和顺序号。

## 状态、不变量与失败处理

- 队列严格按递增顺序分批发送；一个批次未确认前不会发送下一个批次。
- 408、429、5xx 和浏览器网络错误会幂等重试当前整批一次；仍失败时保留全部事件并显示离线或同步失败状态，浏览器触发 `online` 后可继续。
- 409 版本或租约冲突都保留本地事件、暂停同步并禁用在线继续编辑，防止无提示覆盖；租约冲突不会自动循环重试。
- Service Worker 不缓存 API 响应；赛事离线数据只从 IndexedDB 恢复。首次生产页面加载并由 Service Worker 接管后，断网刷新深层赛事路由仍可从应用壳与 IndexedDB 恢复。
- 冲突态只提供“使用云端进度”或“另存为新赛事”；前者原子清空本地队列，后者由服务端校验分支可达性后生成独立恢复令牌。

## 验证路径

- `apps/web/src/features/tournament/repository.test.ts` 使用独立 IndexedDB 实现验证离线选择、离线锁轮、整批连续版本回放、临时 502 幂等重试和冲突时保留队列。
- 本地 API 实测验证相同事件重试两次均为 200 且版本只增加一次；同顺序号不同事件返回 409。
- Playwright 在 Vite 生产预览中覆盖首次加载、Service Worker 接管、离线选择、断网刷新深层赛事路由、恢复联网、队列同步，以及完赛同步被挂起/返回 502 时本地赛果仍立即可见并可重试。
- `pnpm test`、`pnpm typecheck` 和 `pnpm build` 覆盖共享状态机、Web 离线仓储和 Worker 契约。

## 相关文档

- [业务规则](../../02_rules/business_rules.md)
- [技术架构与 API](../../03_technical/architecture_and_api.md)
- [数据与同步](../../03_technical/data_and_sync.md)
- [测试与部署](../../05_delivery/test_and_deployment.md)
