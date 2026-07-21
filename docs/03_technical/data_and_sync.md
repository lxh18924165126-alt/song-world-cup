# 数据模型、离线同步与冲突

## 核心实体
- `PlaylistSnapshot`：带 `qq_music / netease_cloud_music` 来源平台的歌单快照
- `SnapshotSong`：快照歌曲
- `TournamentDraft`：赛事名称、候选歌曲集合、赛制、签表和乐观版本
- `Tournament`：赛事主体
- `TournamentEntrant`：参赛条目
- `Match`：对阵与结果
- `PickEvent`：用户选择事件流
- `EditLease`：单设备编辑租约
- `Account / AuthSession / OAuthState`：账号、哈希会话和一次性授权状态
- `FeatureFlag / AdminAuditLog / AppEvent`：运营开关、后台审计和异步应用事件

## 关键状态
- 赛事：`draft_local / draft_cloud / in_progress / finished / deleted / expired`
- 分享：`closed / open`
- 对阵：`pending / picked / locked / auto_bye`

当前实现把赛事状态机作为一个带版本号的原子 `progress_json` 保存到 D1，同时单独保存 `status / version / updated_at / completed_at` 供条件更新和索引；Durable Object 编辑租约控制单设备写入，服务端版本仍用于拒绝旧进度覆盖。

## 离线策略
- 导入后的本地赛事草稿写入 IndexedDB；云端草稿恢复令牌仅在设备本地和恢复链接 fragment 中保留，服务端只保存哈希；
- 赛事首次在线加载后写入 IndexedDB；
- 用户选择以事件队列方式本地存储；
- 恢复联网后按顺序分批回放到服务端；
- 服务端使用版本号或顺序号防止旧数据覆盖新数据；
- 锁轮必须是原子操作。

当前代码已实现 IndexedDB 赛事缓存、`pick / lock_round` 有序事件、每批最多 256 项的联网原子回放、事件 ID 幂等确认、临时网关错误整批重试一次、409 冲突保留、编辑租约、5 分钟离线保护期和到期接管。客户端收到整批确认后，才在同一个 IndexedDB 事务中更新云端基线并删除对应事件；批次期间新增的事件继续乐观应用在新基线上。冲突时只提供“使用云端进度”和“将本地分支另存为新赛事”两种处理。

Windows `/sowocu` 部署的服务端状态保存在忽略提交的 `.local-server/wrangler-state/`，与 Cloudflare 远端 D1、Durable Object 和 Queue 完全分离。重新构建不会删除该目录；若人工移除 `.local-server/`，本机服务端数据和后台令牌都会丢失，浏览器 IndexedDB 中尚未同步的数据仍按现有离线规则处理。

中国大陆临时公网中转只在连接失败后自动重试 `GET / HEAD / OPTIONS`。携带赛事事件、租约或其他业务写入的请求不会在中转层自动重放；其恢复仍由客户端现有事件 ID、连续顺序、版本校验和幂等批量接口负责，避免连接断开时无法判断 Worker 是否已接收请求而导致重复提交。

完赛结果页优先读取 IndexedDB 的已完成进度并立即渲染，待同步事件和分享状态在后台处理。网络或公网中转失败只显示“赛果已保存在本机”的可重试提示，不再把本地赛果替换成整页错误；云端确认完成前禁用依赖服务端完赛状态的分享操作，以及必须静默开放分享并附公开二维码的对阵图下载。

## 编辑权
- `docs/02_rules/business_rules.md` 规定单设备编辑约束；本层通过编辑租约实现；
- 编辑设备定时心跳续租；
- 离线后保留保护期；
- 超时后其他设备可接管；
- 原设备重新上线发现已被接管时，不做自动合并。

“使用云端进度”先成功读取云端，再在同一个 IndexedDB 事务中替换赛事缓存并删除待同步事件。“另存为新赛事”把本地进度提交给服务端；服务端从原不可变签表重放全部轮次和选择，只有与领域状态机结果完全一致时才复制草稿来源、生成独立令牌和新赛事。

浏览器把设备 ID 保存在 `localStorage`，把赛事和队列保存在 IndexedDB；服务端 Durable Object 按赛事 ID 保存租约代次和期限。设备 ID 与离线事件 ID 在安全上下文优先使用 `crypto.randomUUID`，在公网 HTTP 非安全上下文使用 `crypto.getRandomValues` 生成同格式 UUID。设备 ID 不承担身份认证，所有租约和赛事请求仍须通过恢复令牌授权。

## 账号迁移与所有权

- 匿名赛事以恢复令牌授权；账号赛事以 `X-Session-Token` 授权，两类凭证都只以 SHA-256 哈希形式存储。
- 迁移 API 通过 `0010_atomic_ownership_claims.sql` 的校验与应用触发器，在一个 D1 batch 中原子校验匿名所有权和原恢复令牌、写入 `owner_account_id`，并轮换赛事及草稿恢复令牌哈希；并发认领只有一个请求能成功。
- 迁移成功后旧恢复链接立即失效；浏览器只允许选择没有待同步离线事件的赛事，避免认领时丢失本地分支。
- OAuth state 只保存哈希并带过期时间，回调在交换外部 token 前先删除 state，防止重复使用。
