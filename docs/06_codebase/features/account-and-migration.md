# 账号、我的赛事与迁移认领

## 功能范围与用户入口

- `/mine` 聚合此设备 IndexedDB 赛事、恢复链接和当前账号拥有的云端赛事，并按进行中/已完成分组。
- 用户可通过微信或 QQ 模拟 Provider 登录；正式 OAuth 路径代码与回调页已存在，生产联调待平台凭证。
- `/mine/migrate` 只列出此设备拥有有效匿名恢复令牌、尚未属于当前账号且没有待同步事件的赛事；确认后批量认领。

## 代码入口与职责

- `apps/web/src/features/mine/MinePage.tsx`：本地赛事、账号赛事、恢复链接与登录入口。
- `apps/web/src/features/mine/MigrationPage.tsx`：迁移候选核验、选择和摘要。
- `apps/web/src/features/auth/session.ts`：版本化本地会话缓存与请求头。
- `apps/web/src/features/auth/api.ts`、`OAuthCallbackPage.tsx`：模拟登录、OAuth 跳转/回调、注销和迁移客户端。
- `apps/api/src/auth.ts`：哈希会话、一次性 OAuth state、微信/QQ 授权码交换与用户资料规范化。
- `apps/api/src/ownership.ts`：账号赛事列表和批量所有权迁移。
- `0006_accounts_and_ownership.sql`、`0007_oauth_states.sql`、`0010_atomic_ownership_claims.sql`：账号、会话、OAuth state，以及原子所有权认领的数据结构与触发器。

## 调用、状态与安全边界

1. 模拟 Provider 只在 `AUTH_MODE=mock` 开放；正式模式缺少对应 client secret、回调地址时明确拒绝启动授权。
2. 会话原文只返回浏览器一次，D1 保存 SHA-256 哈希和过期时间；账号赛事请求使用 `X-Session-Token`。
3. 迁移前浏览器检查每个赛事的 IndexedDB 待同步事件数；存在本地分支时禁用该候选。
4. Worker 再次校验账号会话；D1 触发器在同一原子 batch 内校验赛事仍为匿名且原恢复令牌匹配，然后写入账号所有权，并轮换赛事与来源草稿的恢复哈希。并发认领只有一个请求能成功。
5. 迁移后账号赛事可跨设备读取，旧匿名恢复链接返回 404，不再具备读取或编辑权限。

## 验证路径

- API 实测覆盖模拟登录、迁移前匿名访问、迁移成功、旧令牌失效、账号会话访问、账号赛事列表、注销和注销后拒绝访问。
- Playwright 覆盖移动端模拟 QQ 登录、已完成赛事认领、旧恢复链接失效、迁移页渲染和空候选摘要。
- `pnpm test` 覆盖正式 OAuth 地址参数、缺少平台凭证和后台鉴权边界。

## 相关文档

- [核心流程与页面](../../01_product/core_flows_and_pages.md)
- [业务规则](../../02_rules/business_rules.md)
- [技术架构与 API](../../03_technical/architecture_and_api.md)
- [数据与同步](../../03_technical/data_and_sync.md)
- [测试与部署](../../05_delivery/test_and_deployment.md)
