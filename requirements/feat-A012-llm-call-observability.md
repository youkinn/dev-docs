# feat-A012：LLM 调用可观测增强（`reasoning_tokens` 采集 + 重试标识 + 日志页标记）

> 特性号：feat-A012
> 状态：草稿（Coco 起草，待与负责人共同定稿）
> 作者：Coco
> 涉及项目：mcp-orchestrator（主要）、mcp-web
> 日期：2026-09-22
> 关联：bug-00018（本特性起因）、feat-A007 / feat-A008（日志采集与页面）、feat-A011（`cached_tokens` 同法扩展）

## 背景

bug-00018 暴露：生成轮空答案的根因是「思考 token 吃满 `max_tokens`」，但日志只记 `prompt_tokens` / `completion_tokens` / `cached_tokens`，**`reasoning_tokens` 未采集**，定位只能靠线下探针重放；且「重试」这一动作在日志里与首次调用无法区分（只有 `seq` 递增）。

## 目标

- [ ] `llm_call_logs` 新增 `reasoning_tokens` 并回填（取自 `usage.completion_tokens_details.reasoning_tokens`，provider 不返回时为 `null`）——**全量记录所有调用轮**，不限于重试轮
- [ ] 新增重试标识字段（如 `attempt`：1 = 首次 / 2 = 重试），由服务端写入，不靠前端按 `seq` / 时间推断
- [ ] `GET /api/v1/logs` 明细回传 `reasoningTokens` 与重试标识
- [ ] 日志页列表行可见「是否重试」标记（语义＝**该请求内发生过重试**），hover 展示 `finish_reason`、`reasoning_tokens` 的中文表达

## 非目标

- 不改 `/api/chat` 请求与响应形状
- 不改重试策略本身（口径见 bug-00018）
- 不做思考预算调优 / 提示词调优

## 验收标准

1. [ ] 库表迁移（旧库 ALTER）后历史行 `reasoning_tokens` 为 `null`，新行按 provider 回传落值
2. [ ] 一次发生重试的请求：两轮调用分别落库，重试轮标识可区分
3. [ ] `GET /api/v1/logs` 明细含 `reasoningTokens` 与重试标识
4. [ ] 日志页：未重试请求无标记；重试请求有标记；hover 显示中文的 `finish_reason` 与 `reasoning_tokens`
5. [ ] `npm run build` 通过、既有测试全绿

## 接口影响

| 变更 | 归属 | 说明 |
|------|------|------|
| `llm_call_logs` 新增 `reasoning_tokens` 与重试标识列（含旧库迁移） | 老陈（总台） | 出参形状不变，仅新增字段 |
| `GET /api/v1/logs` 明细增 `reasoningTokens` 与重试标识 | 老陈（总台） | 缺省 `null` |
| 日志页「是否重试」标记 + hover 中文表达 | 小叶（前厅） | 列表行级标记语义＝该请求内发生过重试 |

## 技术要点

- `reasoning_tokens` 与 feat-A011 的 `cached_tokens` 同法：`src/agent.ts` 落库处 + `src/storage/logs.ts` 列与旧库迁移 + `src/api/v1/logs.ts` 字段
- 重试标识由编排侧在调用点写入，不由前端推断
- 列表页已有「缓存命中」列，重试标记建议用角标 / 图标而非新增整列，避免列表过宽

## 风险 & 开放问题

1. 重试标识的字段名与取值待定稿确认
2. `finish_reason` 中文映射口径（`stop` / `length` / `tool_calls` 等）待定
3. 列表页标记的视觉方案（角标 vs 整列）待前端评估
4. 本特性分支须基于 **A011 合并后的 `origin/main`** 拉取

## 任务与负责人

| 任务 | 负责人 | 依赖 |
|------|--------|------|
| 需求定稿 + INDEX 登记 | Coco | — |
| 接口文档（新字段 + 重试标识契约） | 老陈 | 需求定稿 |
| 总台：采集 / 迁移 / 接口字段 / 重试标识写入 | 老陈 | 接口文档 |
| 前厅：列表标记 + hover 中文表达 | 小叶 | 接口文档 |

## 分支计划

- dev-docs：`coco/feat-A012_llm-call-observability`
- mcp-orchestrator：需求分支 `coco/feat-A012_llm-call-observability`；成员分支 `chen/feat-A012_llm-call-observability`
- mcp-web：`ye/feat-A012_retry-marker`

## 故事号（Coco 生产）

| 故事号 | 内容 | 负责人 | 状态 |
|--------|------|--------|------|
| story-A012-01 | 实现·总台与前厅：`reasoning_tokens` 采集与迁移、重试标识、接口字段、日志页标记 | 老陈 / 小叶 | 待定稿 |
