# feat-A008: 风云三国与天气日志补全

> 特性号：feat-A008
> 状态：定稿（负责人 2026-09-21 拍板「先做 A008」）
> 作者：Coco
> 涉及项目：mcp-orchestrator（埋点注册 / domain 白名单）、mcp-web（traceId 上报 / domain 传参）
> 日期：2026-09-21
> 关联：feat-A007（链路日志追踪，本特性的地基）、feat-A005（fengyunsanguo MCP）、feat-A001（天气助手页面）、feat-A009（检索诊断，本特性之后做）

## 背景

feat-A007 打通了 `POST /api/chat` 全链路埋点，但按需求明确只覆盖三国演义，并把 `/api/sango/random` 列为非目标。现在把风云三国与天气两条链路补齐，让日志页完整反映三条链路。

实测缺口（2026-09-21）：

- `/api/sango/random`（风云三国随机出题 / 判题）**完全无埋点**：该路由未挂 `chatTracing` 中间件、无 traceId，前端 `sendSangoRandom` 也不生成，`transport.getTraceId()` 拿到 undefined → 工具明细被直接跳过（`transport.ts:228`）
- 天气链路虽然走 `/api/chat` 且埋点通用，但前端选中「天气」标签时不传 `domain`，主表 `domain` 落 `null`（`server.ts:128` 取请求体 domain）→ 日志页「域」列显 `—`，与风云三国 / 三国演义两条链路口径不一致

## 目标

- [ ] `/api/sango/random` 纳入埋点（新 `log_type=quiz`）：traceId 生成 / 透传 / 兜底、主表 + 工具明细落库、前端 t0 / t6 上报
- [ ] 天气标签选中时前端统一传 `domain=weather`，主表 `domain` 三端口径一致
- [ ] 风云三国知识问答路径（`domain=fengyunsanguo`）补测试与验收（通用埋点已覆盖，库里暂无验证数据）
- [ ] 日志页类型下拉支持 `chat` / `quiz`

## 非目标

- **不加主表字段**（如「解析后域」「路由来源层」）：前端统一传 domain 后 `domain` 即实际域；auto（无 domain）只出现在直接调 API 的场景，v1 不值得为它加列（过度设计）。留口子：记录器已按 log_type 注册，需要时再加
- 不做检索诊断 / 召回原因可视化（feat-A009）
- 不做 `GET /api/tools` 埋点（与链路无关）
- 不改 `/api/chat` 与 `/api/sango/random` 的响应体契约
- 不做登录鉴权（沿用 A007 v1 内网口径）

## 验收标准

1. [ ] 风云三国随机出题一次后，列表出现 `log_type=quiz` 记录：`domain=fengyunsanguo`、`user_input` 为提交文本、`answer` 为工具返回文本、`citations=[]`
2. [ ] 该记录的明细含工具 `fengyunsanguo_quiz_command`（入参 / 出参 / 耗时），**无 LLM 明细**，列表 `tokens` 为 null
3. [ ] quiz 的 `durations.frontend` 有值（前端 t0 上报 + t6 补报各就各位）
4. [ ] 天气标签一问一答后，「域」列显示 `weather`，天气工具明细（`mcp_server=weather`）可查
5. [ ] 日志页类型下拉可切 `chat` / `quiz` 并正确过滤；默认仍为「全部」
6. [ ] 前端选中「天气」标签时请求体带 `domain=weather`，后端不再拒绝（`CHAT_ALLOWED_DOMAINS` 含 weather）
7. [ ] 风云三国知识问答（`domain=fengyunsanguo`）有测试覆盖：工具明细落 `fengyunsanguo_query`
8. [ ] quiz 埋点失败不影响 `/api/sango/random` 主流程（旁路原则，故障注入验证）
9. [ ] 既有 A003~A007 相关测试全绿（埋点不改业务行为）

## 接口影响

- **HTTP 契约**：`/api/sango/random` 增 `X-Trace-Id` / `X-Client-Sent-At` 请求头与 `X-Trace-Id` 响应头（与 `/api/chat` 同口径）；响应体不变
- **`/api/chat` 白名单扩项**：`CHAT_ALLOWED_DOMAINS` 增 `weather`（`server.ts:22`）—— 纯扩项，既有取值行为不变
- **主表 / 明细表结构**：不变（`log_type` 已是字段，新增取值 `quiz` 不需 DDL）
- **查询接口**：不变（`logType` 过滤已通用）
- **前端**：`sendSangoRandom` 增 traceId / 时间上报；`sendChatMessage` 的 domain 类型加 `weather`；日志页类型下拉加 `quiz` 项

## 技术要点

- **埋点复用**：`ensureSkeleton(logType, traceId, userInput, domain, ...)` 已参数化 logType（`storage/logs.ts:212`），把 `chatTracing` 抽成通用 `tracingMiddleware(logType, resolveDomain)` 即可，`/api/chat` 与 `/api/sango/random` 各注册一份
- **quiz 的 domain**：该路由 body 只有 `message` / `sessionId`，无 domain → 服务端固定填 `fengyunsanguo`（该路由只服务风云三国域）
- **工具明细零改动**：`transport.callTool` 的埋点已通用（`mcpServer` / `toolName` 为字段），quiz 与天气只要 traceId 上下文就位即自动落库
- **幂等**：沿用 A007 骨架 `INSERT OR IGNORE` + 回填，重试不产生重复记录
- **天气行为不变**：`domain=weather` 命中 L1 硬锁（`DOMAIN_ROUTES`）后走 LLM tool-use，与当前靠 L2 关键词路由的结果一致（用户显式选标签比关键词猜测更准）

## 风险 & 开放问题

> 以下 3 项为待落实细节，**不阻塞开工**（2026-09-21 负责人拍板「先做 A008」）；接口文档 / 实现阶段逐条落实，落实结果回填本节。

- **已落实（2026-09-21，接口文档 §7.1）** `domain=weather` 让天气从「L2 关键词路由」变为「L1 标签硬锁」：用户选了天气标签却问三国问题会硬锁在天气域。这是既有 L1 设计（feat-A003）的既定行为，与风云三国 / 三国演义一致，非本特性引入；不传 domain 的直接 API 调用仍走 L2，行为不变。
- **已落实（2026-09-21，接口文档 §7.2）** quiz 一次点击不会触发多次 `fengyunsanguo_quiz_command`：出题与判题是前端两次独立 HTTP 请求，各一条主表记录；单次 HTTP 请求当前恰好调用一次工具 → 一条工具明细。契约定清：一次 HTTP 请求一条主表记录，工具明细按实际调用条数记（一对多已支持）。
- **已落实（2026-09-21，接口文档 §7.3）** `sendSangoRandom` 的 t6 补报路径：复用 `POST /api/v1/logs/:traceId/frontend-end`（body `{ clientReceivedAt }`），以响应头 `X-Trace-Id` 为准（兜底场景服务端值优先），fire-and-forget，失败不影响主流程。

## 任务与负责人

| 任务 | 负责人 | 依赖 |
|------|--------|------|
| 接口文档（quiz 埋点注册、traceId / 时间头上报、domain 白名单扩项、前端对接） | 老陈 | 需求定稿 |
| 总台：通用 tracing 中间件抽取 + `/api/sango/random` 注册 quiz + domain 白名单 | 老陈 | 接口文档 |
| 前端：`sendSangoRandom` traceId / 时间上报 + 天气传 domain + 类型下拉 | 小叶 | 接口文档 |
| 测试：风云三国知识问答 + quiz 埋点 + 天气域口径 | 老陈 / 小叶 | 实现 |
| 需求 / INDEX 定稿、审查提测 | Coco | — |

## 分支计划

- dev-docs：`coco/feat-A008_log-coverage`
- mcp-orchestrator：单人（老陈）直拉 `chen/feat-A008_log-coverage`
- mcp-web：单人（小叶）直拉 `ye/feat-A008_log-coverage`

## 故事号（Coco 生产）

| 故事号 | 内容 | 负责人 | 状态 |
|--------|------|--------|------|
| story-A008-01 | 风云三国与天气日志补全（需求 / 接口 / 实现 / 前端全程复用） | Coco / 老陈 / 小叶 | 需求定稿完成（2026-09-21），开发中 |

> 本特性为小功能（不改表结构、不动响应体契约），按 2026-09-20 决策「默认一个特性一个故事号，贯穿开发全程复用」。
> 合并记录以 GitHub PR 记录为准，本表不再补登（2026-09-21 决策）。
