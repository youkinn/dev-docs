# feat-A005: 风云三国迁出总台（fengyunsanguo MCP）

> 特性号：feat-A005
> 状态：已定稿
> 作者：Coco
> 涉及项目：mcp-orchestrator, mcp-server, mcp-web
> 日期：2026-09-20

## 背景

总台（mcp-orchestrator）的架构定位是「仅做编排」：HTTP 层 + LLM 编排 + MCP 传输。但风云三国题库域（feat-A002）目前整体内嵌在总台：`src/sango.ts`（题库加载 / bigram 召回 / 判题 / 随机一题会话 / L3 路由识别）、`data/sango-questions.json`（88 题）、`/api/sango/random` 确定性链路。领域逻辑与编排逻辑混在一起，与总台定位不符。

本次将风云三国题库域整体迁出到 mcp-server，正式命名为 `fengyunsanguo`，与三国演义（`sango` / `sango-novel` / `sanguo-yanyi`）明确区分——`sango` 语义过泛，可指演义、三国志等任何三国相关，与「风云三国 MOD 招募题库」定位不符，故 HTTP domain 一并改名（2026-09-20 决策）。

## 目标

- [ ] 风云三国题库能力（题库数据、召回、随机一题状态机、L3 高置信识别）全部下沉 mcp-server 独立 MCP `fengyunsanguo/`；**代码与数据必须全部迁出（含测试与脚本），总台不允许残留任何风云三国领域代码**
- [ ] 对外 HTTP 契约 domain 值 `sango` → `fengyunsanguo`（破坏性变更，orchestrator 与 mcp-web 同发）
- [ ] 功能行为零变化：知识问答、随机一题、判题、无标签 L3 自动路由与现状一致
- [ ] MCP 工具契约：`fengyunsanguo_query`（候选召回，先保留，调用侧默认 limit=1）/ `fengyunsanguo_quiz_command`（随机一题状态机）/ `fengyunsanguo_quiz_route`（L3 识别）

## 非目标

- 三国演义解读的服务端渲染与引用校验（`citation.ts`、prompt 限定，A004 范围）不搬——A004 未合入 main，待其稳定后单议
- 不改动 A004 命名：`sango` 注册名、`sango_novel_search`、`source=sanguo-yanyi` 保持现状
- 不做独立仓库（沿用 mcp-server 单仓多 MCP；触发拆仓条件见 `docs/mcp-server-architecture.md` §4）
- 不改判题 / 召回算法与题库数据（行为零变化迁移）
- mcp-web 仅做 domain 改名的必要改动，不改交互与样式

## 验收标准

1. [ ] `POST /api/chat` 带 `domain="fengyunsanguo"` 时知识问答行为与 A002 验收 3/4/13 完全一致（同一题不同问法命中、未收录提示）；`domain="sango"` 返回 400
2. [ ] `POST /api/sango/random` 行为与 A002 验收 5~8 完全一致（随机出题 / 判题 / 查答案 / 无会话提示），sessionId 语义不变
3. [ ] 无 domain 自动路由：L1/L2 未命中时，风云三国高置信问句仍路由到风云三国（L3 经 `fengyunsanguo_quiz_route`）；其余路由行为不变
4. [ ] `GET /api/tools` 上报含 `fengyunsanguo_query`（来源 MCP）与 `sango_novel_search`、`get-forecast` / `get-alerts`；总台无本地工具
5. [ ] orchestrator 侧 `src/sango.ts`、`data/sango-questions.json` 已删除，`SANGO_QUESTION_FILE` 环境变量移除；`rg "sango"` 仅剩演义检索引用（注册名、工具名、文档）
6. [ ] mcp-server `fengyunsanguo/` 独立 `npm run build` 与测试通过；总台启动时 quiz 缺配（可选 server）→ `/api/sango/random` 与 `domain=fengyunsanguo` 请求返回 503，其余功能正常
7. [ ] mcp-web domain 改名后全链路回归通过：标签选择 / 知识问答 / 随机一题（小叶自测清单）
8. [ ] orchestrator 既有 A002/A003 测试更新后全绿；文档同步清单（见下）全部落地

## 接口影响

| 接口 | 说明 |
|------|------|
| `POST /api/chat` | domain 白名单 `sango` → `fengyunsanguo`（400 提示文案同步）；**破坏性变更，与 mcp-web 同发** |
| `POST /api/sango/random` | 路径不变；内部从本地 `SangoService` 改为调 MCP `fengyunsanguo_quiz_command`；信封 / 串行队列 / sessionId 语义不变 |
| `GET /api/tools` | `sango_query` 变为 `fengyunsanguo_query`，来源从本地工具变 MCP server |
| MCP 新增 | `fengyunsanguo/` server：`fengyunsanguo_query(text, limit=1)`（先保留，调用侧默认 limit=1，预期无用待评估）、`fengyunsanguo_quiz_command(message, sessionId?)`、`fengyunsanguo_quiz_route(text)` |
| mcp-web | `domain` 类型与判定同步改名（`client.ts` / `stores/chat.ts` / `WeatherView.vue`） |

## 命名决策（2026-09-20）

| 层 | 现名 | 新名 |
|----|------|------|
| HTTP domain | `sango` | `fengyunsanguo` |
| MCP 目录 / 注册名 | — | `fengyunsanguo` |
| package | — | `mcp-fengyunsanguo` |
| 环境变量 | — | `MCP_FENGYUNSANGUO_SCRIPT` |
| 工具名 | `sango_query`（本地） | `fengyunsanguo_query` / `fengyunsanguo_quiz_command` / `fengyunsanguo_quiz_route` |
| 演义侧（不动） | — | `sango-novel` / `sango_novel_search` / `sanguo-yanyi` |

## 技术要点

- 搬迁原则：`SangoService`（`src/sango.ts`）行为零改动迁入 `mcp-server/fengyunsanguo/`（TypeScript，`registerTool` + Zod + 日志只写 stderr + version 读 package.json，遵循 mcp-server AGENTS.md）；`data/sango-questions.json` git mv
- 随机一题状态机整体下沉：`handleRandom` 1:1 映射为 `fengyunsanguo_quiz_command(message, sessionId)`；会话 Map 放 quiz 子进程内存（TTL 30min、重启即清，与现状总台重启即清一致）；总台 `/api/sango/random` 只做薄转发（校验 / 信封 / 队列 / 503 语义不变）
- LLM 语义判定留总台：`fengyunsanguo_query` 只出候选，调用侧默认 limit=1（与 A004 `sango_novel_search` 同模式）；agent.ts 快路径 `preCallSangoQuery` 已内置 localTools → transport 回退，接线即用
- L3 自动路由：L2 关键词（路由信号）留总台不动；L3 题库向量识别下沉为 `fengyunsanguo_quiz_route`，总台路由层调用（保无标签自动路由行为不变）；备选「本期停用 L3」不采纳（会改变现状行为）
- 注册表：`transport.ts` `resolveMCPServerConfigs` 增加 `MCP_FENGYUNSANGUO_SCRIPT`（可选 server、失败降级），沿用 A004 多 server 机制，无新基建
- 依赖：A005 基于 A004 合入后的最新 `origin/main` 拉分支（团队约定「新需求先拉 main」）；mcp-server 侧 `fengyunsanguo/` 独立目录，可与 A004 收尾并行开发、零冲突

## 风险 & 开放问题

- 范围边界（需负责人确认）：本期仅搬题库域；演义解读服务端逻辑（`citation.ts` 等）同样属领域逻辑，但关联 A004 在飞，建议 A004 合入稳定后单议
- 契约破坏性变更：domain 改名需 orchestrator + mcp-web 同发，提测须两端一起验收；无状态 API，无历史兼容负担
- 进程边界：quiz 子进程与总台生命周期绑定（总台拉起 / 关闭），会话状态随 quiz 进程存亡，与现状一致；quiz 独立崩溃（可选 server）→ 风云三国功能 503，其余照常
- stdio 开销：知识问答 / 随机一题链路各 +1 次 MCP roundtrip（毫秒级），对 1~2s 响应目标无影响（参考 A004 已走 MCP）
- `fengyunsanguo_query` 先保留：调用侧默认 limit=1；预期可能无用，A005 验收实测后评估是否移除

## 文档同步清单（审查前置条件）

- A002 需求与接口文档、A003 路由文档：「本地题库 / `sango` domain」表述全部更新
- `docs/sango-mcp-routing-design.md`：示例 1/2 的 domain 与工具名
- `docs/architecture.md`（总台职责）、`docs/mcp-server-architecture.md`（成员表）
- `mcp-orchestrator/AGENTS.md`（架构图「sango.ts 本地工具」条目）

## 任务与负责人

| 任务 | 负责人 | 依赖 |
|------|--------|------|
| 接口文档（工具契约 + 编排侧行为 + 破坏性变更说明） | 老陈 | 需求定稿 |
| mcp-server `fengyunsanguo/` 新建（搬迁 + 3 工具 + 测试） | 老陈 | — |
| 总台改造（注册表 / .env / 装配 / 转发 / 删代码 + domain 改名） | 老陈 | A004 合入 main |
| agent.ts 改造（prompt 工具名、L3 注入点、测试更新） | 小胡 | 接口文档 |
| mcp-web domain 改名 | 小叶 | 接口文档 |
| 需求 / 架构文档定稿、INDEX、审查提测 | Coco | — |

## 分支计划（2026-09-20）

- dev-docs：`coco/feat-A005_fengyunsanguo-to-mcp`（当前分支，文档契约）
- mcp-orchestrator：Coco 拉需求分支 `coco/feat-A005_fengyunsanguo-to-mcp`；老陈 / 小胡基于它拉个人分支（`chen/feat-A005_*`、`hu/feat-A005_*`），成员自合入需求分支
- mcp-server：单人（老陈）直接拉个人分支 `chen/feat-A005_fengyunsanguo-mcp`；独立目录，与 A004 收尾并行、零冲突
- mcp-web：单人（小叶）直接拉个人分支 `ye/feat-A005_domain-rename`

## 故事号（Coco 生产）

| 故事号 | 内容 | 负责人 | 状态 |
|--------|------|--------|------|
| story-A005-01 | 需求文档与故事号规则落地（含本次修订、定稿） | Coco | 开发中（已完成，待负责人核对） |
| story-A005-02 | 接口文档：fengyunsanguo 工具契约 + 编排侧行为 + 破坏性变更说明（老陈先出） | 老陈 | 开发中（已完成，待核对） |
| story-A005-03 | mcp-server `fengyunsanguo/` 新建：SangoService 搬迁 + 3 工具 + 测试与脚本迁入 | 老陈 | 开发中（已完成，待核对） |
| story-A005-04 | 总台改造：`MCP_FENGYUNSANGUO_SCRIPT` 注册表 / .env / 装配 / random 薄转发 / 删 `src/sango.ts`+`data/sango-questions.json` / domain 改名（orchestrator 侧 A004 已合入 main，可开工） | 老陈 | 开发中（已完成，待核对） |
| story-A005-05 | agent.ts 接线：快路径回退、prompt 工具名、L3 注入点、测试更新 | 小胡 | 开发中（已完成，待核对） |
| story-A005-06 | mcp-web domain 改名：`client.ts` / `stores/chat.ts` / `WeatherView.vue` | 小叶 | 开发中（已完成，待核对） |
| story-A005-07 | 需求 / 架构文档定稿（文档同步清单）、INDEX、审查提测 | Coco | 待开发 |

> 开发排期时由 Coco 按拆分粒度登记并分配；故事号全局唯一、一经分配不变，**特性上线后归档作废、不再用于新提交、永不重用**（故事号表状态列：开发中 / 待开发 / 已归档，归档仅在特性上线后）；提交以故事号为准（格式见 AGENTS.md「编号与 Commit」），git 可依故事号追查代码归属。需要拆分向 Coco 申请补发。

## 合并记录

| 成员 | 分支名 | 审查结果 | 合并日期 |
|------|--------|----------|----------|
| — | — | — | — |
