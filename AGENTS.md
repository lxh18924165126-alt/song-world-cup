# 歌曲世界杯 Agent Rules

## 基本约定

- 始终使用简体中文；修改请求授权范围内连续实施，只读限制优先。
- 先检查工作树并保留用户修改；未经要求不提交、推送。

## 项目背景

- 生产代码已开始按功能切片落地；`prototype/` 仍只是设计原型，范围以文档为准。

## 风险与改动规模

- R1：局部可逆且不触及契约、数据、安全或基础设施；直接实施并最低验证。
- R2：跨领域、共享契约、依赖、构建、CI 或基础设施；微计划后实施并验证边界。
- R3：迁移/丢失、认证授权、安全、生产、不可逆或破坏性兼容；分析风险，强化验证和恢复，不重复确认当前授权。
- 超过 3 个领域/组件或约 100 行手写代码只触发复评。

## 技术栈与文档

- 目标栈：pnpm monorepo；React/TypeScript/Vite；Workers/D1/Durable Objects/Queues；IndexedDB/Service Worker；Vitest/Playwright。
- 根 `package.json` 与各工作区 manifest 是实际命令、依赖和版本权威；当前命令与组件边界见 [代码索引](docs/06_codebase/README.md)。总索引见 [项目文档](docs/DOCUMENTATION_INDEX.md)。

## 领域规则路由

直接规则：[实施](docs/agent/project-implementation.md)、[摘要](docs/00_overview/project_summary.md)、[流程](docs/01_product/core_flows_and_pages.md)、[业务](docs/02_rules/business_rules.md)、[架构](docs/03_technical/architecture_and_api.md)、[数据](docs/03_technical/data_and_sync.md)、[视觉](docs/04_design/visual_and_components.md)、[验收](docs/05_delivery/test_and_deployment.md)、[延后](docs/05_delivery/future_scope.md)、[代码说明](docs/agent/code-documentation.md)。

- 0→1：实施及全套规则；产品：摘要+流程+业务+延后；前端：流程+业务+视觉+实施。
- API/数据/离线/Cloudflare：业务+架构+数据；测试/部署：验收；代码或契约变化：代码说明。

按目标、路径和影响加载并集；路径只是证据。根直接链接权威规则，叶子不得强制串联。

## 文档与检查点

- 行为、API、配置、部署、数据或架构变化时，同步更新项目文档和 `docs/06_codebase/`。
- 检查点是内部自检，除硬阻断外不中断；不创建无关流程文档，不写猜测、`TODO` 或 `TBD`。

## 最低验证

- 检查 diff 并运行最窄校验；R2 覆盖边界，R3 另验兼容、数据、安全和恢复。
- 当前至少检查 Markdown 链接、规则路由和文档一致性；未运行的检查不得声称通过。
- 每次功能或界面改动完成并通过最低验证后，先执行 `pnpm local:prepare` 生成 `/sowocu/` 本地部署产物，再用 `pnpm local:stop` 与 `pnpm local:start` 自动重启一次本地服务并检查 `/api/health`；不得由此触发生产发布或部署。

## 禁止事项

- 不回滚/覆盖用户工作或手改生成文件；不自动提交、发布、部署或执行生产/破坏性动作。
- 不把静态原型、假交互、空 API 或无迁移数据壳称为完成；不用 Cloudflare 付费能力、Containers、云端图片渲染或单曲封面。
- 未经明确扩展，不实施延后范围。

## 架构护栏

- QQ 音乐与网易云音乐公开歌单导入均无需 Cookie；保存不可变快照，重复歌曲保持独立。
- 开赛后锁定歌曲/签位/路径；分享默认关闭且仅创建者开放；PNG 在设备本地生成。
- 离线选择进有序队列；服务端防旧数据覆盖并原子保护锁轮/编辑权。前端须有真实状态/离线逻辑，后端须有真实模型/迁移/API。

## 可选工作流入口与规则优先级

- AgentHub 默认关闭，仅在用户明确要求多 Agent/分工/并行代理时加载。
- Harness 默认关闭，仅在用户明确要求 Harness 或工程化设计/实施/工作流时加载；两者不自动互启。
- 模型、上下文、压缩和价格等运行时配置不属于项目规则。
- 优先级：平台/沙箱/命令/CI > 当前用户范围 > 根内核 > 架构/安全/数据 > 领域规则 > 可选工作流 > 仓库惯例。

## Superpower

Superpower 默认禁止。仅当当前任务是实际 R3 仓库修改，或用户明确要求工程化设计、工程化实施或 Harness 工作流时，才允许考虑职责最窄的具体技能。

满足条件只解除禁令，不代表必须使用；`using-superpowers` 总入口始终禁止。
