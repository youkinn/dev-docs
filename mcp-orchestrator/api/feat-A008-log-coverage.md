# feat-A008: 风云三国与天气日志补全（接口文档）

> 作者：老陈
> 对应特性号：feat-A008
> 故事号：story-A008-01
> 涉及项目：mcp-orchestrator（server.ts / storage/logs.ts / transport.ts）、mcp-web（小叶对接）
> 日期：2026-09-21
> 前置：feat-A007（表结构 / 查询契约 / 埋点方案沿用，本文只写增量）

## 概述

在 feat-A007 基础上做两件事：`/api/sango/random` 纳入全链路埋点（新 `log_type=quiz`，含 traceId 头、t0 / t6 上报）；`/api/chat` 白名单扩 `weather`（纯扩项）。**表结构 / 查询接口 / 两个路由的响应体均不变**。

## 一、quiz 埋点注册

| 项 | 取值 |
|------|------|
| 路由 | `POST /api/sango/random` |
| 注册方式 | `chatTracing` 抽为通用 `tracingMiddleware(logType, resolveDomain)`：`/api/chat` 注册 `chat` + 取请求体 `domain`；`/api/sango/random` 注册 `quiz` + 固定 `fengyunsanguo`（该路由仅服务风云三国域，body 只有 `message` / `sessionId`，无 `domain`） |
| log_type | `quiz`（新取值，`log_type` 已是字段，无需 DDL） |
| domain | `fengyunsanguo`（服务端固定，忽略请求体） |

**主表 `request_logs` 落库字段（quiz）：**

| 字段 | 取值 |
|------|------|
| `log_type` | `quiz` |
| `user_input` | 请求体 `message`（≤300；校验失败可为 NULL） |
| `domain` | `fengyunsanguo` |
| `answer` | 返回 `data.answer`（工具纯文本） |
| `citations` | `'[]'`（quiz 恒无原文引用，行为与现状零变化） |
| `status` / `response_code` / `error_message` | 与 A007 同口径：成功 `success` / 200 / ''；失败 `failed` / 500 或 503 / 对应 message |
| 时间点 | t1 骨架（`ensureSkeleton`）→ t2 出队（`markHandled`）→ t5 响应（`markResponded`）→ t6 前端补报回填 |
| 幂等 | 沿用 A007：骨架 `INSERT OR IGNORE` + 回填，重试不产生重复记录 |

校验失败（400 / 413）同样落主表一条（t2 为 NULL、t5 回填校验失败时刻），与 A007 一致。

**工具明细 `tool_call_logs`（quiz）：**

| 字段 | 取值 |
|------|------|
| `mcp_server` | `fengyunsanguo` |
| `tool_name` | `fengyunsanguo_quiz_command` |
| 其余字段 | 沿用 A007 通用口径（`args_summary` / `call_sent_at` / `call_returned_at` / `result_summary` / `status` / `error_message`）；`transport.callTool` 埋点已通用，traceId 上下文就位即自动落库 |
| 条数 | 一次 HTTP 请求当前恰好调用一次工具 → 一条明细；契约按实际调用条数记（一对多已支持） |

**LLM 明细：无**（quiz 为确定性薄转发，不经 LLM）→ 列表 `tokens` 恒 `null`，`llm_call_logs` 无记录。

**旁路原则：**沿用 A007 `trySafe`，日志写入失败静默（只告警），绝不影响 `/api/sango/random` 主流程与响应。

## 二、请求头契约（/api/sango/random，与 /api/chat 同口径）

| Header | 必填 | 说明 |
|--------|------|------|
| `X-Trace-Id` | 否（服务端兜底） | 前端生成 UUID v4；幂等重试沿用同一值；缺失时服务端兜底生成并随响应头 `X-Trace-Id` 返回，前端补报以响应头值为准 |
| `X-Client-Sent-At` | 否 | t0 = `Date.now()`，毫秒时间戳；未上报时 `client_sent_at` 为 NULL |

- **响应头**：`X-Trace-Id` 恒返回（含兜底场景）；CORS `exposedHeaders` 已含 `X-Trace-Id`（A007 已配），无需改动。**响应体不变**：`{ code, data: { answer, citations }, message }`。
- **t6 补报**：复用 `POST /api/v1/logs/:traceId/frontend-end`（body `{ clientReceivedAt }`，未知 traceId 静默 200，fire-and-forget）。`sendSangoRandom` 当前无补报路径，按 A007 口径补实现。

## 三、domain 白名单扩项（/api/chat）

- `CHAT_ALLOWED_DOMAINS` 由 `['fengyunsanguo', 'sango-novel']` 增 `weather` —— **纯扩项**：既有取值校验 / 路由行为不变；此前 `domain=weather` 报 400 拒绝，现在接受。
- 前端天气标签传 `domain=weather` 后：主表 `domain` 落 `'weather'`（日志页「域」列不再显 `—`），天气工具明细（`mcp_server=weather`）可查；weather 命中 L1 硬锁走 LLM tool-use，与当前 L2 关键词路由结果一致。
- 不传 `domain`（直接调 API）行为不变：`domain` 落 NULL、L2 关键词路由照旧；`domain` 传未知值仍 400。

## 四、查询接口（零改动确认）

- `GET /api/v1/logs`：`logType` 过滤已通用，新增取值 `quiz` 直接可查，默认仍为全部。
- `GET /api/v1/logs/token-stats`：只聚 LLM 明细，quiz 无 LLM 调用不入桶，无影响。
- 表结构：主表 / `llm_call_logs` / `tool_call_logs` 均无 DDL。

## 五、前端对接（小叶）

- `sendSangoRandom`：生成 UUID 存会话级变量随 `X-Trace-Id` 发送（重试沿用同一值）；`X-Client-Sent-At = Date.now()`；收到响应后以**响应头 `X-Trace-Id`** 补报 `POST /api/v1/logs/:traceId/frontend-end`，body `{ clientReceivedAt: Date.now() }`。
- `sendChatMessage`：天气标签选中时请求体带 `domain='weather'`；domain 类型加 `weather`。
- 日志页类型下拉：加 `quiz` 项（`chat` / `quiz` 两值），默认「全部」= 不传 `logType`。

## 六、接口侧验收标准（逐条可测）

| #（需求） | 验收点 |
|-----------|--------|
| 1 | 带 `X-Trace-Id` 调 `/api/sango/random` 一次，列表出现 `log_type=quiz` 记录：`domain=fengyunsanguo`、`user_input` 为提交文本、`answer` 为工具返回、`citations='[]'` |
| 2 | 该 trace 明细含工具 `fengyunsanguo_quiz_command`（入参 / 出参 / 耗时），无 LLM 明细；列表 `tokens` 为 null |
| 3 | 带 `X-Client-Sent-At` + t6 补报后，quiz 记录 `durations.frontend` 有值；未知 traceId 补报仍静默 200 |
| 4 | 不带 `X-Trace-Id` 调 quiz：响应头 `X-Trace-Id` 返回兜底值，用该值补报成功回填 t6 |
| 5 | `/api/chat` 带 `domain=weather` 返回 200 且主表 `domain='weather'`；不带 `domain` 行为不变；未知 domain 仍 400 |
| 6 | 日志页类型下拉切 `quiz` 过滤正确（仅回 quiz 记录）；默认全部 |
| 7 | 故障注入（DB 写抛错）后 `/api/sango/random` 仍正常返回（旁路原则） |
| 8 | 既有 A003~A007 相关测试全绿（埋点不改业务行为） |

## 七、风险 & 开放问题落实（回填需求）

1. **domain=weather 由 L2 关键词路由变 L1 硬锁**：前端显式传 `domain=weather` 后命中 L1 硬锁（`DOMAIN_ROUTES`），用户选天气标签却问三国问题会硬锁在天气域。此为既有 L1 设计（feat-A003）的既定行为，与风云三国 / 三国演义一致，非本特性引入；不传 domain 的直接 API 调用仍走 L2，行为不变。
2. **quiz 一次点击是否触发多次 `fengyunsanguo_quiz_command`**：出题与判题是两次独立 HTTP 请求（前端各自调 `sendSangoRandom`），各一条主表记录；单次 HTTP 请求当前实现恰好调用一次工具，故一条工具明细。契约定清：**一次 HTTP 请求一条主表记录，工具明细按实际调用条数记**（一对多已支持，不做额外约束）。
3. **sendSangoRandom 的 t6 补报路径**：按 A007 口径实现——以响应头 `X-Trace-Id` 为准调 `POST /api/v1/logs/:traceId/frontend-end`（body `{ clientReceivedAt }`），fire-and-forget，失败不打扰主流程。
