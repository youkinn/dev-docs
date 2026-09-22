# feat-A012：调用链路可观测增强（`reasoning_tokens` + 重试标识 + 路由来源 + Token 明细）

> 特性号：feat-A012
> 状态：定稿（负责人 2026-09-22 确认「路由来源」「Token 明细」并入）
> 作者：Coco
> 涉及项目：mcp-orchestrator（主要）、mcp-web
> 日期：2026-09-22
> 关联：bug-00018（起因之一：思考 token 吃满 `max_tokens`）、feat-A003 / feat-A011（路由分层：L1 标签 / L2 关键词 / L3 向量 / L4 轻量分类）、feat-A007 / feat-A008（日志采集与页面）、feat-A011（`cached_tokens` 同法扩展）

## 背景

bug-00018 暴露三处观测盲区：

1. 生成轮空答案的根因是「思考 token 吃满 `max_tokens`」，但日志只记 `prompt_tokens` / `completion_tokens` / `cached_tokens`，**`reasoning_tokens` 未采集**，定位只能靠线下探针重放；「重试」动作也与首次调用无法区分（只有 `seq` 递增）。
2. 输入 token 只有总数，看不出**花在哪**（域提示词 / 检索注入原文 / 用户输入），优化输入 token 缺少依据。
3. `request_logs` 无路由层级字段，只有请求体原样回传的 `domain`（auto 时为空）→ L2 关键词命中与 L3 向量命中在日志里形状完全一致（无 `classify` 行 + 一次 `generation` + 一次工具调用），**「快路径是否生效、命中哪一层」只能靠时间先后硬推**；排查 `sango_novel_search` 这类调用发生在 LLM 前还是后时缺少权威依据。

## 目标

- [ ] `llm_call_logs` 新增 `reasoning_tokens`（取自 `usage.completion_tokens_details.reasoning_tokens`，provider 不返回为 `null`），全量记录所有调用轮，不限于重试轮
- [ ] 新增重试标识字段（如 `attempt`：1 = 首次 / 2 = 重试），由服务端写入，不靠前端按 `seq` / 时间推断
- [ ] `request_logs` 新增路由来源 `route_source`（枚举 `label` / `keyword` / `vector` / `classify` / `free`），历史行为 `null`
- [ ] `llm_call_logs` 新增输入 token 分段估算（JSON 列，如 `input_breakdown`）：`system`（域提示 / 分类提示）、`user`（当前输入）、`injected`（检索注入片段）；`history` / `tools` 保留字段、当前恒 0
- [ ] 输出侧拆分为「思考 / 正文」：正文 = `completion_tokens` − `reasoning_tokens`（两项均为 provider 真值）
- [ ] `GET /api/v1/logs` 明细回传以上字段
- [ ] 日志页：Token 列 hover 可见明细（输入分段 + 输出拆分）、列表行可见「是否重试」与「路由来源」标记

## 非目标

- **不做输入分段的精确对账**：provider 不提供按段 token，分段为本地估算，**不要求各段之和等于 `prompt_tokens`**，只呈现各段各自的值
- 不引入 tokenizer 依赖（本地字符启发式估算；后续需要更准再议）
- 不改 `/api/chat` 请求与响应形状
- 不改重试策略本身（口径见 bug-00018）
- 不做思考预算调优 / 提示词调优
- 不做路由来源的查询过滤（列表标记 + 明细字段够用）
- 不按 `cached_tokens` 拆分段（缓存命中是独立维度，保持单列）

## 验收标准

1. [ ] 库表迁移（旧库 ALTER）后历史行 `reasoning_tokens` / `route_source` / `input_breakdown` 为 `null`，新行按实际落值
2. [ ] 一次发生重试的请求：两轮调用分别落库，重试轮标识可区分
3. [ ] `GET /api/v1/logs` 明细含 `reasoningTokens`、重试标识、`routeSource`、输入分段
4. [ ] 日志页 Token 列 hover 可见：输入各段的值（标注「估算」）+ 输出「思考 / 正文」；关闭思考的轮次不显示「思考 0」
5. [ ] 五条路径各走一次（L1 标签 / L2 关键词 / L3 向量 / L4 分类编号 1 或 2 / L4 编号 99），`routeSource` 与实测路径一致
6. [ ] 未重试请求无标记；重试请求有标记；hover 显示中文的 `finish_reason` 与 `reasoning_tokens`
7. [ ] `npm run build` 通过、既有测试全绿

## 接口影响

| 变更 | 归属 | 说明 |
|------|------|------|
| `llm_call_logs` 新增 `reasoning_tokens` 与重试标识列（含旧库迁移） | 老陈（总台） | 出参形状不变，仅新增字段 |
| `llm_call_logs` 新增 `input_breakdown`（JSON：各段估算值） | 老陈（总台） | 分段在调用点计算后落库；估算值，不做对账 |
| `request_logs` 新增 `route_source`（含旧库迁移） | 老陈（总台） | 枚举 `label`/`keyword`/`vector`/`classify`/`free`；由编排侧判定、随响应回传落库，不改 `/api/chat` 响应形状 |
| `GET /api/v1/logs` 明细增 `reasoningTokens` / 重试标识 / `routeSource` / 输入分段 | 老陈（总台） | 缺省 `null` |
| 日志页：Token hover 明细 + 「是否重试」标记 + 「路由来源」标记 | 小叶（前厅） | 标记语义＝该请求内发生过重试 / 本次命中哪一层；hover 中文表达 |

## 技术要点

- 输出侧：`正文 = completion_tokens − reasoning_tokens`，两项都是 provider 真值，**精确**；provider 不返回 `reasoning_tokens`（或关闭思考）时为 `null`，此时只显示正文，不显示「思考 0」
- 输入侧：分段在 `src/agent.ts` 的 `callModel` 调用点计算（messages 已结构化：域提示 / 分类提示、用户输入、注入片段），**不从 `request_summary` 反推**（该字段 8000 字符截断）
- 输入分段为**估算**：本地字符启发式，各段之和与 `prompt_tokens` 不要求相等；页面标注「估算」
- `route_source` 判定点：`resolveRoute` 命中专用域（`label` / `keyword`）、L3 向量命中（`vector`）、分类轮编号 1 / 2（`classify`）与 99（`free`）；`resolveRoute` 现只返回域，需新增 L1 与 L2 来源的区分
- 与 feat-A011 的 `cached_tokens` 同法：`src/agent.ts` 落库处 + `src/storage/logs.ts` 列与旧库迁移 + `src/api/v1/logs.ts` 字段
- 列表页已有「缓存命中」列，重试 / 路由来源标记建议用角标或图标而非新增整列，避免列表过宽

## 风险 & 开放问题

1. 输入分段是估算值：可能与 `prompt_tokens` 明显不符（中文分词差异），页面必须标注「估算」，否则会被当成账目使用
2. 重试标识的字段名与取值待接口文档确认
3. `finish_reason` 中文映射口径（`stop` / `length` / `tool_calls` 等）待定
4. 列表页标记的视觉方案（角标 vs 整列）待前端评估
5. `resolveRoute` 区分 L1 / L2 属新增分支，若触碰既有路由行为须回归 A003 / A011 路由用例
6. 本特性分支须基于 **A011 合并后的 `origin/main`** 拉取

## 任务与负责人

| 任务 | 负责人 | 依赖 |
|------|--------|------|
| 需求定稿 + INDEX 登记 | Coco | — |
| 接口文档（新字段 + 重试标识 + 路由来源 + 分段口径契约） | 老陈 | 需求定稿 |
| 总台：库表迁移 / 接口字段 / 重试标识与路由来源写入 / 分段估算落库 | 老陈 | 接口文档 |
| 编排：调用点分段标记与路由来源判定回传（`src/agent.ts`） | 小胡 | 接口文档 |
| 前厅：Token hover 明细 + 重试标记 + 路由来源标记 | 小叶 | 接口文档 |

## 分支计划

- dev-docs：`coco/feat-A012_llm-call-observability`
- mcp-orchestrator：需求分支 `coco/feat-A012_llm-call-observability`；成员分支 `chen/feat-A012_llm-call-observability`、`hu/feat-A012_llm-call-observability`
- mcp-web：`ye/feat-A012_log-observability`

## 故事号（Coco 生产）

| 故事号 | 内容 | 负责人 | 状态 |
|--------|------|--------|------|
| story-A012-01 | 实现·总台 / 编排 / 前厅：`reasoning_tokens` 与迁移、重试标识、`route_source`、输入分段估算、接口字段、日志页标记与 hover 明细 | 老陈 / 小胡 / 小叶 | 待开工 |