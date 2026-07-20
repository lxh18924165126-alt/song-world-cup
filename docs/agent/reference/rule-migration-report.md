# Rule evidence ledger

## Scope

- Repository: `/Users/baituola/code/song-world-cup`
- Baseline inventory: `/var/folders/6r/1v51x3n50778gxd8tgk8dlsh0000gn/T/agent-rules-inventory.i6LZYS`
- Audited sources: `README.md`, `CODEX_PROMPT.md`, `docs/**/*.md`, `mockups/README.md`, `prototype/README.md`, `prototype/index.html`, Git status and tracked-file inventory
- Audit timestamp: `2026-07-20T09:49:48+08:00`

## Entries

| Source ID | Source | Location | Source type | Confidence | Existing explicit rule | Inferred from repository | User confirmed | Semantic summary | Category | Authority target | Status | Evidence | Semantics changed | Conflict notes |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| E-b08ca0a5f651 | README.md | file | documentation | high | no | yes | no | 仓库当前是歌曲世界杯设计与开发交付包，包含效果图、静态原型、需求文档和旧 Codex 提示词，尚无生产业务实现。 | 项目背景 | AGENTS.md | inferred-high-confidence | README、全仓文件清单与用户当前确认相互印证。 | no | - |
| E-77a7bd15f7b3 | mockups/README.md | file | documentation | high | no | yes | no | `mockups/` 是前端页面与状态的视觉复刻基线，不是可直接上线的实现。 | 前端 | docs/agent/project-implementation.md | inferred-high-confidence | mockups 清单、视觉组件文档、CODEX_PROMPT 和静态原型相互印证。 | no | - |
| E-da053f364cd5 | prototype/README.md | file | documentation | high | no | yes | no | `prototype/index.html` 只用于对齐页面结构、视觉、组件层级和关键交互，不接真实 API。 | 前端 | docs/agent/project-implementation.md | inferred-high-confidence | prototype README、原型源码与 CODEX_PROMPT 相互印证。 | no | - |
| R-a307937673af | user-current | language | user-input | high | no | no | yes | 始终使用简体中文与用户沟通，并以简体中文维护项目 Agent 规则。 | 根级基本约定 | AGENTS.md | user-confirmed | 当前用户提供的仓库级 AGENTS 指令。 | no | - |
| R-450623dad204 | user-current | repository-state | user-input | high | no | no | yes | 当前仓库不含业务代码；现有 HTML 是设计交付中的静态交互原型。 | 项目背景 | AGENTS.md | user-confirmed | 用户当前明确说明及仓库清单。 | no | - |
| R-2b2ce0bece5f | user-current | code-reading-docs | user-input | high | no | no | yes | 建立代码功能阅读说明目录；实现功能切片后在同一改动中补齐或更新对应说明。 | 文档与检查点 | docs/agent/code-documentation.md | user-confirmed | 用户当前明确要求。 | no | - |
| R-81229d155bc0 | CODEX_PROMPT.md | 开始前必须做的事 | other-assistant-evidence | high | yes | no | yes | 首次从零实施前完整审阅设计交付包；业务规则优先，前端以效果图与原型为复刻基线。 | 技术栈和文档索引 | docs/agent/project-implementation.md | migrated | 当前用户要求完整迁移旧规则；README、文档索引和设计文档支持该要求。 | no | 旧提示词不再自动作为 Codex 权威；语义迁入根直接路由的叶子。 |
| R-0216d7ed507e | CODEX_PROMPT.md | 技术栈与硬约束 | other-assistant-evidence | high | yes | no | yes | 目标实现使用 pnpm monorepo、React、TypeScript、Vite、Workers、D1、Durable Objects、Queues、IndexedDB、Service Worker、Vitest 和 Playwright。 | 架构护栏 | docs/03_technical/architecture_and_api.md | migrated | 技术架构文档逐项印证；根将直接路由该文件。 | no | 当前尚无 manifest，版本与实际命令不得猜测。 |
| R-cd356add89bc | CODEX_PROMPT.md | 技术栈与硬约束/Cloudflare | other-assistant-evidence | high | yes | no | yes | 只使用 Cloudflare 免费套餐；PNG 在设备本地生成；代理妨碍 Wrangler 时先完成本地开发验证并将远程步骤后置。 | 基础设施 | AGENTS.md | migrated | 架构文档和测试部署文档相互印证。 | no | - |
| R-2fcb8a5a114d | CODEX_PROMPT.md | 必须实现的功能 | other-assistant-evidence | high | yes | no | yes | 第一版完整范围覆盖导入、检查、设置、抽签、比赛、离线与接管、结果分享导出、登录迁移和最小后台；不能把静态原型当成完成。 | 项目背景 | docs/agent/project-implementation.md | migrated | 项目摘要、核心流程、业务规则、技术文档和效果图共同覆盖该清单。 | no | 根对各权威产品文档采用直接路由。 |
| R-0ef8af23feb3 | CODEX_PROMPT.md | 开发方法/切片 | other-assistant-evidence | high | yes | no | yes | 首次完整实施按可验证功能切片推进，每完成一个切片立即运行最窄相关验证。 | 文档与检查点 | docs/agent/project-implementation.md | migrated | 测试与部署文档支持分层验证。 | no | - |
| R-895e78fc4759 | CODEX_PROMPT.md | 开发方法/前端 | other-assistant-evidence | high | yes | no | yes | 前端必须实现真实交互、状态管理和离线行为，不得只提交静态页面。 | 前端 | docs/agent/project-implementation.md | migrated | 核心流程、离线策略、原型说明共同印证。 | no | - |
| R-1fa84c80b940 | CODEX_PROMPT.md | 开发方法/后端 | other-assistant-evidence | high | yes | no | yes | 后端必须提供真实数据模型、迁移和 API，不得只留空壳。 | 后端 | docs/agent/project-implementation.md | migrated | 技术架构、API 轮廓、数据与同步文档共同印证。 | no | - |
| R-68bb0785088c | CODEX_PROMPT.md | 开发方法/视觉 | other-assistant-evidence | high | yes | no | yes | 前端按效果图尽量一比一复刻，不得擅自替换为另一套视觉语言。 | 前端 | docs/agent/project-implementation.md | migrated | 视觉与组件规范、mockups、prototype 共同印证。 | no | - |
| R-a69ee9ff5ad7 | CODEX_PROMPT.md | 开发方法/凭证 | other-assistant-evidence | high | yes | no | yes | 外部平台凭证缺失时可以完成代码与模拟 Provider，但必须明确标记生产联调待凭证，不得声称已生产验收。 | 安全 | docs/agent/project-implementation.md | migrated | future_scope 将正式凭证接入列为延后项，项目摘要要求登录代码完成。 | no | - |
| R-f355ec037ed1 | CODEX_PROMPT.md | 最终交付 | other-assistant-evidence | high | yes | no | yes | 首次完整实现的交付包含可运行代码、数据库迁移、本地验证、实际部署结果与地址、已知问题和降级项；未执行项不得伪称完成。 | 文档与检查点 | docs/agent/project-implementation.md | migrated | CODEX_PROMPT 与测试部署文档。 | no | 部署仍须由当前用户目标明确包含，项目规则不自动执行外部动作。 |
| R-4e16d88da4fd | CODEX_PROMPT.md | 结尾 | other-assistant-evidence | high | yes | no | yes | 首次 0→1 完整实施先给出功能切片计划，再连续开发与验证；计划不是额外审批点。 | 风险与执行路由 | docs/agent/project-implementation.md | migrated | 旧提示词当前语境与统一风险政策兼容。 | no | - |
| R-4395b04d9e8f | docs/00_overview/project_summary.md | 全文 | explicit-rule | high | yes | no | yes | 项目目标、第一版范围和冻结决策定义当前产品边界。 | 项目背景 | docs/00_overview/project_summary.md | migrated | 用户要求保留现有规则；README 声明这些决策已冻结。 | no | 文件原地保留，通过根直接路由纳入规则系统。 |
| R-de1c51e31e58 | docs/01_product/core_flows_and_pages.md | 全文 | explicit-rule | high | yes | no | yes | 核心用户流程与页面路由定义第一版页面和主路径。 | 前端 | docs/01_product/core_flows_and_pages.md | migrated | 用户要求保留现有规则；项目摘要与原型支持。 | no | 文件原地保留，通过根直接路由纳入规则系统。 |
| R-a53720610704 | docs/02_rules/business_rules.md | 全文 | explicit-rule | high | yes | no | yes | 导入、歌曲检查、抽签、比赛交互、关键舞台、媒体、离线并发、分享与导出是业务行为最高优先级来源。 | 契约 | docs/02_rules/business_rules.md | migrated | README、CODEX_PROMPT 和该文档自身明确权威性。 | no | 全文各章节均保留；根直接路由整个文件。 |
| R-c44314e5f0dd | docs/03_technical/architecture_and_api.md | 全文 | explicit-rule | high | yes | no | yes | 技术栈、Cloudflare 免费套餐策略和 API 轮廓定义实现边界。 | 架构护栏 | docs/03_technical/architecture_and_api.md | migrated | CODEX_PROMPT 与数据同步文档相互印证。 | no | 文件原地保留，通过根直接路由纳入规则系统。 |
| R-4cbd865ae626 | docs/03_technical/data_and_sync.md | 全文 | explicit-rule | high | yes | no | yes | 核心实体、状态、离线事件队列、版本防覆盖、原子锁轮和编辑租约定义数据同步边界。 | 数据库 | docs/03_technical/data_and_sync.md | migrated | 业务规则的离线并发章节与技术架构相互印证。 | no | 文件原地保留，通过根直接路由纳入规则系统。 |
| R-fedf00acda47 | docs/04_design/visual_and_components.md | 全文 | explicit-rule | high | yes | no | yes | 视觉语言、设计令牌、组件结构和效果图顺序定义前端实现基线。 | 前端 | docs/04_design/visual_and_components.md | migrated | mockups、prototype 和 CODEX_PROMPT 共同支持。 | no | 文件原地保留，通过根直接路由纳入规则系统。 |
| R-e8c0d18a2f8f | docs/05_delivery/test_and_deployment.md | 全文 | explicit-rule | high | yes | no | yes | 单元、集成、端到端、视觉与浏览器验证以及 Cloudflare 部署要求定义验收边界。 | R3/强化验证 | docs/05_delivery/test_and_deployment.md | migrated | CODEX_PROMPT 的验证和最终交付要求。 | no | 文件原地保留，通过根直接路由纳入规则系统。 |
| R-3b6bce56bb03 | docs/05_delivery/future_scope.md | 全文 | explicit-rule | high | yes | no | yes | 列出的 PWA 安装、多歌单、手工导入、中途分享、公开广场、正式凭证、账号合并、更多海报和商业授权属于延后范围。 | 禁止事项 | docs/05_delivery/future_scope.md | migrated | 项目摘要和业务规则明确第一版边界。 | no | 除非用户明确扩展范围，否则不得混入第一版。 |
| R-be39863f27b9 | docs/02_rules/business_rules.md | 离线与并发，原 line 49 | explicit-rule | high | yes | no | yes | 同一时间只允许一台设备编辑，这是产品行为约束。 | 契约 | docs/02_rules/business_rules.md | migrated | 业务规则总表及数据同步文档原重复条目。 | no | 保留为该约束的唯一产品权威。 |
| R-8d2fdf3e356e | docs/03_technical/data_and_sync.md | 编辑权，原 line 25 | explicit-rule | high | yes | no | yes | 技术层通过编辑租约实现单设备编辑约束。 | 数据库 | docs/02_rules/business_rules.md | merged-equivalent | 原文“同一时间只允许一台设备编辑”；与业务规则逐字重复。 | no | 改为指向产品权威并说明租约实现，约束强度、适用条件和例外均未改变。 |
| R-38b51a1f1d6b | docs/00_overview/project_summary.md | 冻结决策，line 23 | explicit-rule | high | yes | no | yes | 第一版不使用单曲封面。 | 项目背景 | docs/00_overview/project_summary.md | migrated | 项目摘要与视觉规范原重复条目。 | no | 保留为该产品禁令的唯一权威。 |
| R-b440bd9a45e9 | docs/04_design/visual_and_components.md | 视觉方向，原 line 9 | explicit-rule | high | yes | no | yes | 视觉实现遵守不使用单曲封面的产品禁令，并用排版、聚光灯、奖杯和对阵线建立辨识度。 | 前端 | docs/00_overview/project_summary.md | merged-equivalent | 原文“不使用单曲封面。”；与项目摘要逐字重复。 | no | 改为指向产品权威并补充视觉实现后果，禁令未弱化。 |

## Coverage summary

- Baseline rule candidates: 0
- Baseline evidence candidates: 3
- Preserved in root: 0
- Migrated: 21
- Merged equivalent: 2
- Inferred high confidence: 3
- User confirmed: 3
- Unresolved needs user: 0
- Omitted not a rule: 0
- Externalized runtime config: 0
- Superseded by current user policy: 0
- Uncovered: 0

## Audit decisions

- 盘点模式：`bootstrap`；根 `AGENTS.md` 缺失且模式适用。
- 没有发现嵌套或异常命名的 Agent 指令、fallback、`.codex/rules/`、项目 Skill、manifest、锁文件、构建配置、测试配置、CI、schema 或 migration。
- `CODEX_PROMPT.md` 是其他助手说明；因用户明确要求完整迁移，其有效语义迁入根可直接路由的权威位置，但原文件保持不变。
- 没有发现操作者运行时配置或旧 Superpower 宽松触发，因此对应状态计数均为 0。
- 不需要用户补充事实：所有会影响当前禁止项、架构护栏和路由的内容已有用户确认或多源高置信证据。
