# 赛事设置与抽签预览

## 功能范围与用户入口

- `/setup` 仅保留赛事设置主流程：读取当前设备的歌单快照与赛事草稿，支持编辑 1–20 字赛事名称、选择 16–4096 的可用固定规模或全部歌曲，然后进入抽签预览。
- `/draw-preview/:id#token=...` 从云端恢复抽签草稿，以紧凑设置摘要和首轮部分对阵作为开赛前确认，并支持复制恢复链接、重新抽签与正式开始。
- 正式开始创建不可变来源的赛事进度，进入 `/t/:id/play`；之后再次调用重抽接口会返回 409。

## 代码入口与职责

- `apps/web/src/features/draft/SetupPage.tsx`：名称、规模选择和创建云端草稿。
- `apps/web/src/features/draft/DrawPreviewPage.tsx`：恢复、签表摘要、对阵示例及重抽交互。
- `apps/web/src/features/tournament/api.ts`：从抽签预览发起正式开赛。
- `apps/web/src/features/draft/api.ts`：创建、恢复与重抽客户端。
- `apps/web/src/features/import/repository.ts`：在 IndexedDB 保存云端草稿 ID、恢复令牌和版本。
- `apps/api/src/drafts.ts`：校验快照歌曲归属、令牌哈希、草稿读取和乐观版本重抽。
- `apps/api/src/index.ts`：草稿路由及 400、404、409 错误映射。
- `packages/domain/src/tournament.ts`：参赛歌曲随机选择、签位生成、左右轮空均衡及共享契约。

## 调用、数据与持久化

1. 设置页继续使用导入阶段生成的不可变 `PlaylistSnapshot` 和 `TournamentDraft.selectedSongIds`。
2. 固定规模从全部候选中随机抽取指定数量，因此没有轮空；全部歌曲模式把签表扩展到不小于歌曲数的最小 2 的幂。
3. `POST /api/drafts` 校验全部歌曲 ID 属于同一快照，生成签表并写入 `tournament_drafts`。
4. API 只返回一次明文恢复令牌；D1 仅保存 SHA-256 哈希。恢复链接把令牌放在 URL fragment，浏览器通过 `X-Draft-Token` 显式传给 API。
5. `POST /api/drafts/:id/redraw` 要求客户端提交当前版本，D1 更新使用 `WHERE version = ?`；过期版本返回 409，防止旧页面覆盖新签表。

迁移 `apps/api/migrations/0002_cloud_drafts.sql` 创建 `tournament_drafts`，保存快照引用、名称、赛制、候选歌曲 ID、签表 JSON、令牌哈希和版本。快照外键阻止草稿引用不存在的来源数据。

## 状态、不变量与失败处理

- 每次创建云端草稿生成新的 ID 和恢复令牌；D1 不保存令牌明文。
- 正式开赛后 `tournaments.draft_id` 的唯一约束锁定该草稿，重抽接口同时检查赛事是否已存在。
- 左右赛区轮空数差不超过 1，且首轮不会生成“轮空对轮空”的空比赛。
- 固定规模重抽会重新选择参赛歌曲并重新生成签位；全部歌曲模式保留全部候选，仅重新生成签位。
- 草稿恢复失败统一表现为不可用，不向调用方区分 ID 不存在与令牌错误。
- IndexedDB 旧草稿缺少云端字段时会按 `null` 兼容读取；离线重抽与比赛事件队列不属于当前已落地能力。

## 验证路径

- `pnpm test` 覆盖固定规模、全部歌曲签表、偶数/奇数轮空均衡、无空比赛和重复歌曲 ID 拒绝。
- `pnpm typecheck` 检查共享领域、Web 与 Worker 契约。
- `pnpm build` 执行共享包编译、Vite 生产构建和 Worker dry-run。
- `pnpm db:migrate:local` 应用两份 D1 迁移；本地 API 验证包含创建 201、错误令牌 404、恢复 200、重抽升级版本和旧版本 409。
- 浏览器端到端路径为 `/` → `/import/check` → `/setup` → `/draw-preview/:id`；应验证重抽版本变化、刷新恢复、控制台健康及桌面/390px 布局。

## 相关文档

- [核心流程与页面](../../01_product/core_flows_and_pages.md)
- [业务规则](../../02_rules/business_rules.md)
- [技术架构与 API](../../03_technical/architecture_and_api.md)
- [数据与同步](../../03_technical/data_and_sync.md)
- [视觉与组件](../../04_design/visual_and_components.md)
- [测试与部署](../../05_delivery/test_and_deployment.md)
