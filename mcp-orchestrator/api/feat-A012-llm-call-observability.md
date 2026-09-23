# feat-A012: LLM 调用可观测增强 —— 接口文档

> 作者：老陈
> 对应特性号：feat-A012
> 故事号：story-A012-01
> 涉及项目：mcp-orchestrator（总台，小胡 agent 埋点配合）、mcp-web（小叶对接）
> 日期：2026-09-23
> 前置：feat-A007（日志查询 / llm_call_logs / token 埋点）、feat-A009（快路径预调 / 检索诊断）、feat-A010（模型可见工具白名单 / 域提示注入）、feat-A011（提示词瘦身 / cachedTokens / auto 轻量分类）

## 概述

本特性为 LLM 调用可观测增强，全链路只做「日志 / 统计 / 展示」侧扩展，`/api/chat` 请求 / 响应形状零变更，重试策略零变更：

1. **调用级新维度**：`llm_call_logs` 新增 `reasoning_tokens`（思考 token）、`attempt`（重试标识，服务端写入）、`input_breakdown`（输入分段 token 估算）、`max_tokens`（本次调用输出上限）。
2. **请求级新维度**：`request_logs` 新增 `route_source`（路由来源五分支），前端日志列表行 hover 类型标签展示（不加角标）。
3. **输出侧拆「思考 / 正文」**：正文 = `completion_tokens − reasoning_tokens`（两项均为 provider 真值，不做估算）。
4. **Token 图表缓存维度**：token-stats 按桶聚合 `cached_tokens`，前端合并为单根三段堆叠柱（缓存输入 / 未缓存输入 / 输出），图表读数区展示区间总 token 与缓存命中率。
5. **日志页展示优化**：LLM 调用子表 Token 列拆「输入 / 输出」两列并 hover 明细；列表最外层状态列简化；token 数值统一精确整数 + 千分位。

不改：`/api/chat` 请求 / 响应形状（`answer` / `citations`）、重试策略（bug-00018 空答案变参重试 1 次）、`status` / `responseCode` 筛选口径、明细子表状态列、最外层 Token 合并列、`route_source` 查询过滤（列表无此筛选项）、分段精确对账（`input_breakdown` 与 `prompt_tokens` 不对账）、tokenizer 依赖（不引入）。

### 核心口径（实现时逐条照做）

- `input_breakdown` 为**本地启发式 token 估算**：CJK 字符（含全角标点）按 1 token/字，其余字符按 1 token/4 字符，各段累加后四舍五入取整（公式见 §2.3）。与 `prompt_tokens` 同量纲，但各段之和不要求等于 `prompt_tokens`；页面必须标注「估算」；分段不按 `cached_tokens` 拆分。
- `input_breakdown` 在 `src/agent.ts` `callModel` 调用点计算（messages 已结构化），**不得从 `request_summary` 反推**（该字段 8000 字符截断）。
- 缓存口径：`cached_tokens ⊂ prompt_tokens`，未缓存 = 输入 − 缓存，两段之和恒等于该桶输入；历史 `null` 计 0；单桶若 `cached_tokens > prompt_tokens`（异常数据）未缓存段兜底 0，不出现负值柱。三段（缓存输入 / 未缓存输入 / 输出）合并为**单根堆叠柱**（§4.4）。
- 缓存命中率 = 区间缓存合计 / 区间输入合计，均为**区间合计**（非逐桶）；输入合计 0 时显示「—」。

## 一、存储层字段契约

> 全部走 SQLite `ALTER TABLE ... ADD COLUMN`（缺省 NULL），与 feat-A011 `cached_tokens` 迁移同模式：建表语句同步加列；迁移 try/catch 幂等（新库 / 已迁移库重复执行忽略）。**历史行一律不迁移、不回填，读取为 `null`。**

### 1.1 llm_call_logs（4 个新列）

| 列名 | 类型 | 空值语义 | 说明 |
|------|------|----------|------|
| `reasoning_tokens` | INTEGER | null = provider 未返回 `usage.completion_tokens_details.reasoning_tokens`，或失败调用无 usage | 思考 token 数；**全量记录所有调用轮（含空答案变参重试轮）**，同 trace 内重试轮也落一条 |
| `attempt` | INTEGER | null = 历史行（A012 前），读取语义见 §2.1 | 重试标识：`1` = 首次 / `2` = 变参重试；**服务端写入，前端不得按 seq / 时间推断** |
| `input_breakdown` | TEXT（JSON 字符串） | null = 历史行；正常调用必有值 | 输入分段 token 估算（折算规则见 §2.3），形状 `{ system, user, injected, history, tools }` |
| `max_tokens` | INTEGER | null = 历史行 | 本次调用输出上限，取调用点参数原值（当前恒为常量 1000，bug-00018 口径） |

旧库迁移 SQL（每句独立 try/catch，幂等）：

```sql
ALTER TABLE llm_call_logs ADD COLUMN reasoning_tokens INTEGER;
ALTER TABLE llm_call_logs ADD COLUMN attempt INTEGER;
ALTER TABLE llm_call_logs ADD COLUMN input_breakdown TEXT;
ALTER TABLE llm_call_logs ADD COLUMN max_tokens INTEGER;
```

### 1.2 request_logs（1 个新列）

| 列名 | 类型 | 空值语义 | 说明 |
|------|------|----------|------|
| `route_source` | TEXT | null = 历史行，或请求在路由判定前中断（骨架行 / 400 / 413 校验失败） | 路由来源五分支：`label` / `keyword` / `vector` / `classify` / `free`，判定规则见 §2.2 |

旧库迁移 SQL（独立 try/catch，幂等）：

```sql
ALTER TABLE request_logs ADD COLUMN route_source TEXT;
```

### 1.3 落库点总览

| 字段 | 落库点文件与函数 | 写入时机 |
|------|------------------|----------|
| `reasoning_tokens` | `src/storage/logs.ts` `LlmCallPayload.reasoningTokens`；采集 `src/agent.ts` `callModel` 内 `recordCall` | 每次调用成功 / 空答案失败回填时，随 usage 一并写入 |
| `attempt` | 同上（`LlmCallPayload.attempt`）；写入 `src/agent.ts` `callModel` 的 `callOnce` → `recordCall` | 每次调用落库时显式携带（1 / 2） |
| `input_breakdown` | 同上（`LlmCallPayload.inputBreakdown`）；计算 `src/agent.ts` `callModel` 调用点 | 每次调用落库时携带（含失败调用） |
| `max_tokens` | 同上（`LlmCallPayload.maxTokens`）；采集 `src/agent.ts` `callModel` 调用点 | 每次调用落库时携带（取本次 `params.max_tokens` 原值） |
| `route_source` | `src/storage/logs.ts` 新增模块级便捷函数（与 `appendLlmCall` 同模式，agent 直接 import）；回填 `src/agent.ts` `processQueryData` | 路由判定完成后立即回填一次（LLM 调用之前），见 §2.2 |

## 二、采集口径（判定规则，无歧义）

### 2.1 attempt 写入时机

`src/agent.ts` `callModel` 现有调用结构（bug-00018）：`callOnce` 执行单次请求，空答案（content 为空 / `finish_reason=length`）时以变参 `{ disableThinking: true, temperature: 0 }` 重试 1 次。`attempt` 与调用轮一一对应：

| 调用轮 | attempt | 触发 |
|--------|---------|------|
| 首轮 | `1` | 每次 `callOnce`（首轮） |
| 变参重试轮 | `2` | 首轮空答案触发重试的 `callOnce` |

- 首轮成功：落 1 条 `attempt=1`、`status=success`。
- 首轮空答案、重试成功：落 2 条 —— `attempt=1` `status=failed`（error_message 写明首轮空答案）+ `attempt=2` `status=success`。
- 两轮均空答案：落 2 条 failed，随后上抛 500。
- 请求异常（超时 / 限流，`callOnce` 内 catch 分支）：按当前轮次落 `failed`，attempt 仍为当前轮（首轮=1 / 重试轮=2）。
- **全量记录所有调用轮**：首轮与重试轮各自独立成行（现状已如此，仅新增 `attempt` 标注），不因重试覆盖首轮行。

实现要求：`callOnce` 返回对象或回调参数中携带当前轮次（1 / 2），`recordCall` 与 catch 分支的 `appendLlmCall` 均显式传 `attempt`。**读取语义**：`attempt: null` = 历史行（A012 前），前端不得把 null 当作 1。

### 2.2 route_source 判定规则

枚举五分支，判定点全部在 `src/agent.ts` `processQueryData`（路由判定流程），LLM 调用前一次性回填，后续 fallback 轮（引用校验兜底结论轮）**不覆盖**：

| 值 | 判定条件 | 判定位置 |
|----|----------|----------|
| `label` | L1 前端标签：请求 `domain` 参数命中 `DOMAIN_ROUTES` | `resolveRoute` |
| `keyword` | L2 本地关键词硬匹配命中专属关键词 | `resolveRoute` |
| `vector` | L3 题库向量高置信命中（仅 auto 时，`fengyunsanguoVectorMatcher` 命中） | `processQueryData` L3 分支 |
| `classify` | 分类轮解析编号 `1` / `2` | `processQueryData` 分类轮分支 |
| `free` | 分类轮解析 `99` / 无法解析 / 非 1/2/99（自由对话兜底） | `processQueryData` 分类轮分支 |

**resolveRoute 返回形状变更**（现返回 `RouteTarget` 纯域，无法区分 L1 / L2，需扩展）：

```ts
// 现状
resolveRoute(query: string, domain?: string): RouteTarget;   // "fengyunsanguo" | "sango-novel" | "auto"

// 变更后：route 与 source 一并返回；route=auto 时 source=null
interface RouteDecision {
  route: RouteTarget;                    // "fengyunsanguo" | "sango-novel" | "auto"
  source: "label" | "keyword" | null;    // label=domain 参数命中；keyword=L2 关键词命中；auto=null
}
resolveRoute(query: string, domain?: string): RouteDecision;
```

`processQueryData` 组合逻辑：

```ts
const decision = this.resolveRoute(query, domain);
let routeSource: RouteSource | null = decision.source;   // label / keyword / null
// lockedRoute = decision.route 为专用域时：
//   routeSource 保持 decision.source（label / keyword）
// 非锁定（auto）时：
//   L3 命中 → routeSource = "vector"
//   否则分类轮 → 编号 1 / 2 → "classify"；99 / 无法解析 / 非 1/2/99 → "free"
// 判定完成后（LLM 调用之前）调用便捷函数回填 request_logs.route_source
```

- **回填时机**：路由判定完成后、LLM 调用前，一次 UPDATE（`UPDATE request_logs SET route_source = ? WHERE trace_id = ?`），旁路静默（失败不影响主流程）。骨架行必然已存在（server.ts `ensureSkeleton` 先落）。
- **中断语义**：路由判定前中断（校验失败 / 骨架失败）→ `route_source` 保持 `null`，不回填。
- **读取语义**：`route_source: null` = 历史行或未完成路由判定；列表 / 明细原样透传。
**回填函数（供小胡对接，老陈先落桩）**：src/storage/logs.ts 新增模块级便捷函数

``ts
export type RouteSource = "label" | "keyword" | "vector" | "classify" | "free";
export function reportRouteSource(traceId: string, routeSource: RouteSource): void;
``

与 ppendLlmCall 同模式：agent 直接 import 调用，内部 UPDATE `request_logs.route_source`，旁路静默（失败 console.error 不影响主流程）。agent.ts `processQueryData` 在路由判定完成后、LLM 调用前调用一次。

### 2.3 input_breakdown 计算口径

在 `src/agent.ts` `callModel` 调用点基于**结构化 messages** 计算（禁止从 `request_summary` 反推）：

- **单位**：各段值 = 该段消息 `content` 的**估算 token 数**（本地启发式，非 provider 口径）。折算规则（写死进本文档，实现照此）：**CJK 字符（含全角标点）按 1 token/字，其余字符按 1 token/4 字符，累加后四舍五入取整**。公式：`estimateTokens(text) = Math.round(cjkCount + otherCount / 4)`，其中 `cjkCount` = Unicode 区间 U+2E80–U+9FFF（CJK 部首补充 / 标点 / 统一表意）、U+F900–U+FAFF（兼容表意）、U+FF00–U+FFEF（全角形式）内字符数，`otherCount` = 其余字符数。
- **分段规则**（按 role + 位置，覆盖全部三种 messages 排布）：

| 段 | 取值规则 | 现状覆盖 |
|----|----------|----------|
| `system` | messages 中**第一个** system 消息（域提示 / 分类提示 / 结论归纳提示） | 分类轮、生成轮、fallback 轮均命中 |
| `user` | user 消息（当前输入；fallback 轮 user 段含「用户问题+片段」混合，属估算误差可接受） | 全部轮次 |
| `injected` | **其余** system 消息（服务端注入片段） | 生成轮有注入时命中；分类轮 / fallback 轮为 0 |
| `history` | 恒 `0`（保留字段） | — |
| `tools` | 恒 `0`（保留字段） | — |

- JSON 形状（示例数值为估算 token）：`{ "system": 230, "user": 45, "injected": 180, "history": 0, "tools": 0 }`，整串落库 `input_breakdown` TEXT 列。
- 失败调用同样落库（messages 在调用点可得，与 `requestSummary` 同一输入源，仅 `logContext` 非空时计算）。
- **口径约束**：各段之和不要求等于 `prompt_tokens`；不做精确对账；页面标注「估算」。

### 2.4 输出侧拆「思考 / 正文」

- 思考 = `reasoningTokens`（provider 原值，`usage.completion_tokens_details.reasoning_tokens`）。
- 正文 = `completion_tokens − reasoning_tokens`，**仅当两项均为 provider 真值（均非 null）时计算**；任一为 null（provider 未返回 / 历史行）→ 正文不下发、前端显示「—」，不做本地估算。

### 2.5 max_tokens 采集

取该次调用 `params.max_tokens` 原值（当前 `src/agent.ts` `callModel` 内常量 1000；建议提取为模块常量，落库与请求共用同一来源，防止两处漂移）。历史行 `null`。

## 三、接口响应形状

### 3.1 GET /api/v1/logs/:traceId —— 明细（新增字段，其余不变）

`data.log` 新增：

| 字段 | 类型 | 说明 |
|------|------|------|
| `routeSource` | `"label" \| "keyword" \| "vector" \| "classify" \| "free" \| null` | 请求路由来源；历史行 / 未完成判定为 null |

`data.llmCalls[]` 每项新增：

| 字段 | 类型 | 说明 |
|------|------|------|
| `reasoningTokens` | number / null | 思考 token 数（provider 原值）；null = provider 未返回 / 失败调用无 usage |
| `attempt` | number / null | `1` = 首次 / `2` = 变参重试；null = 历史行 |
| `inputBreakdown` | `{ system: number; user: number; injected: number; history: number; tools: number }` / null | 输入分段 token 估算（§2.3 折算规则）；null = 历史行 |
| `maxTokens` | number / null | 本次调用输出上限；null = 历史行 |

响应 JSON 示例（`data.llmCalls` 每项）：

```json
{
  "seq": 1,
  "stage": "generation",
  "model": "deepseek-reasoner",
  "promptTokens": 1280,
  "completionTokens": 520,
  "cachedTokens": 1024,
  "reasoningTokens": 300,
  "attempt": 1,
  "inputBreakdown": { "system": 230, "user": 45, "injected": 180, "history": 0, "tools": 0 },
  "maxTokens": 1000,
  "finishReason": "stop",
  "status": "success",
  "errorMessage": ""
}
```

### 3.2 GET /api/v1/logs —— 列表（展示契约所需，每行新增 2 字段）

`data.list[]` 每项新增：

| 字段 | 类型 | 说明 |
|------|------|------|
| `routeSource` | `"label" \| "keyword" \| "vector" \| "classify" \| "free" \| null` | 同明细；供列表行「路由来源」角标 |
| `hasRetry` | boolean | 该 trace 是否存在 `attempt=2` 的调用（SQL 聚合 `EXISTS` / `MAX(attempt)=2`）；历史行 false |

不改：`status` / `responseCode` 筛选口径、分页、其余行字段（最外层 Token 合并列保持原样）。

### 3.3 GET /api/v1/logs/token-stats —— Token 统计（桶级新增缓存维度）

`data.buckets[]` 每项（`TokenBucket`）新增：

| 字段 | 类型 | 说明 |
|------|------|------|
| `cachedTokens` | number | 该桶缓存命中 token 合计（`Σ cached_tokens`，历史 null 计 0） |

聚合实现：`src/storage/logs.ts` `queryTokenRowsStmt` 增加 `cached_tokens` 列；`queryTokenStats` 桶聚合 `current.cached += row.cached_tokens ?? 0`；`TokenBucket` 接口加 `cachedTokens: number`。

响应 JSON 示例：

```json
{
  "code": 200,
  "data": {
    "granularity": "day",
    "timezone": "Asia/Shanghai",
    "startAt": 1779408000000,
    "endAt": 1779494400000,
    "buckets": [
      { "bucket": "09-23", "inputTokens": 2560, "outputTokens": 1040, "cachedTokens": 2048 }
    ]
  },
  "message": ""
}
```

### 3.4 前端类型同步（mcp-web）

`src/api/client.ts` `TokenBucket` 加 `cachedTokens: number`；明细 / 列表类型按 §3.1 / §3.2 同步（小叶侧）。

## 四、前端展示契约

### 4.1 LLM 调用子表：Token 列拆分 + hover 明细

- 「Token（输入/输出）」合并列拆为**「输入 Token」「输出 Token」两列**。
  - 输入 Token 列值 = `promptTokens`；hover 明细展示 `inputBreakdown` 三段估算，段名用中文：`系统提示（system）` / `用户输入（user）` / `检索注入（injected）`（数据来源 `llmCalls[].inputBreakdown`，单位 token，**标注「估算」**）；`history` / `tools` 恒 0 可不展示。
  - 输出 Token 列值 = `completionTokens`；hover 明细给出算式与代入过程（写法对齐候选分数表 `finalScoreFormula`）：首行 `输出 Token = 思考 + 正文`，随后 `思考 <reasoningTokens>`、`正文 <completionTokens − reasoningTokens>（<completionTokens> − <reasoningTokens>）`、`上限（max_tokens）<maxTokens>`（数据来源 `llmCalls[].reasoningTokens` / `.maxTokens`）。两项均非 null 时计算，否则该项显示「—」；`reasoningTokens` 为 null 时不显示「思考」行，`maxTokens` 为 null 时不显示上限行。
  - null 显示「—」（与 `cachedTokens` 展示口径一致）。
- **不改明细子表状态列**；**不改最外层（列表行）Token 合并列**。

### 4.2 日志列表行：重试 / 路由来源标记（hover 展示）

- 落点：**hover 最外层表格「类型」列的类型标签**弹 tooltip，不在类型列内联角标 / 图标（避免行内噪音）。
- tooltip 内容两行：`路由来源：标签路由（label）`（`list[].routeSource` 非 null 时）/ `重试：存在变参重试（attempt=2）`（`list[].hasRetry === true` 时）；有哪项列哪项，两项都不满足时不弹 tooltip。
- **不新增整列**（避免列表过宽）；`routeSource` 枚举中文名与图标映射沿用现有实现。

### 4.3 列表最外层状态列简化

- 失败行：只保留「失败」标签，**页面不出现响应码文本**；hover 展示「异常 code + 错误消息」（数据来源 `list[].responseCode` + `list[].errorMessage`）。
- 成功行：保持现状（「成功」）。
- **不改 `status` / `responseCode` 筛选口径**（接口筛选参数不变）。

### 4.4 Token 图表：单根三段堆叠柱 + 数值单位

- 单根堆叠柱，段顺序自下而上：`缓存输入`（淡蓝）→ `未缓存输入`（紫）→ `输出`（深绿）；柱高 = 三段之和 = 该桶 token 总消耗（输入 + 输出）。图例三项同名。
- `未缓存输入 = max(0, inputTokens − cachedTokens)`（沿用 §3.3 兜底口径，不出现负值段）；历史区间（`cached_tokens` 全 null）整段落在未缓存。
- 读数区（区间总 Token、缓存命中率）口径不变（§3.3）。
- **数值单位**：token 数值一律精确整数 + 千分位（如 `12,345`），不用 `k` / `m` 缩写；null 显示 `—`。落点：最外层表格 Token（输入/输出）列、LLM 子表「输入 Token」「输出 Token」列值与 hover 明细、区间总 Token、图表 y 轴 axisLabel。
- 数据来源不变（`GET /api/v1/logs/token-stats` 每桶 `inputTokens` / `outputTokens` / `cachedTokens`），**接口形状零变更**。

### 4.5 列表耗时列 tooltip：层级标注

- 目的：消除「总 / 总台 / LLM / 工具」四行并列被误读为相加关系（负责人实测：总 4.8s、总台 4.8s、LLM 1.5s、工具 3.3s）。
- 展示结构（缩进即层级）：

```
总 4.8s（= 前端 + 队列等待 + 总台）
前端 24ms
队列等待 2ms
总台 4.8s（服务端墙钟）
　LLM 1.5s
　工具 3.3s
　LLM + 工具 4.8s
```

- 口径：`总台` = `server_responded_at − server_received_at`（服务端墙钟，`durations.server`）；`LLM` / `工具` 为各调用累计和（`durations.llm` / `.tool`），**与总台不保证相等**（差值 = 路由 / 落库等框架开销），故不写死「总台 = LLM + 工具」，只给合计行。
- 当 `|总台 − (LLM + 工具)| ≥ 100ms` 时追加一行 `其他 x（路由 / 落库等）`；否则不显示该行。
- 数据来源不变（`list[].durations`），**接口形状零变更**。

## 五、接口侧验收清单（文档级，逐条自检）

| # | 条目 | 验证方法 |
|---|------|----------|
| 1 | `reasoning_tokens` 采集 | 明细 `llmCalls[].reasoningTokens` 为 number / null；provider 返回时 = `usage.completion_tokens_details.reasoning_tokens` |
| 2 | `attempt` 标注 | 构造空答案用例：明细两条 `attempt=1`（failed）+ `attempt=2`（success）；无重试用例仅 `attempt=1`；`attempt` 不得由前端推断 |
| 3 | `route_source` 判定 | 五分支各构造一例：`domain` 参数（label）、关键词（keyword）、L3 命中（vector）、分类 1/2（classify）、分类 99（free）；历史行 / 校验失败行为 null |
| 4 | `input_breakdown` | 明细三段估算 + `history`/`tools`=0；值 = 各段 `content` 按 §2.3 折算规则估算的 token 数；不从 `request_summary` 反推 |
| 5 | 正文拆分 | `completionTokens − reasoningTokens`；任一为 null 时不计算、前端显示「—」 |
| 6 | `max_tokens` 采集 | 明细 `maxTokens` = 调用点原值（1000）；历史行 null |
| 7 | 明细响应形状 | §3.1 全字段存在、类型 / null 语义正确，200 不报错 |
| 8 | 列表新增字段 | `routeSource` + `hasRetry` 正确；历史行 `routeSource: null`、`hasRetry: false` |
| 9 | token-stats 缓存维度 | 桶 `cachedTokens` = 桶内 `Σ cached_tokens`；历史 null 计 0 |
| 10 | 命中率显示规则 | 区间命中率 = ΣcachedTokens / ΣinputTokens（区间合计）；输入合计 0 → 显示「—」；未缓存段 = 输入 − 缓存，异常数据兜底 0、无负值 |
| 11 | 旧数据兼容 | 存量库升级后新字段全部 null / false，明细、列表、token-stats 均 200 |
| 12 | 前端展示契约 | §4 可照做：两列拆分、hover 明细每项数据来源字段齐全、标记形态与 tooltip 内容明确、状态列简化 |

## 风险 & 开放问题

1. **`input_breakdown` 为本地估算口径**：值为估算 token（CJK 1 token/字 + 其余 1 token/4 字符，四舍五入），与 `prompt_tokens` 同量纲但不对账；页面标注「估算」即可，勿给用户精确对账预期。
2. **fallback 轮 user 段混合**：引用校验兜底结论轮 user 段含「用户问题 + 片段」混合文本，`injected` 段为 0；属估算误差，符合「分段精确对账」非目标。
3. **`attempt` 不含 provider 侧重试**：当前无 provider 自动重试，`attempt=2` 仅对应 bug-00018 空答案变参重试；重试策略本身不变（非目标）。
4. **列表接口新增字段**：`routeSource` / `hasRetry` 为展示契约所需（列表行角标），超出「明细回传全部字段」表述，已在 §3.2 明示，确认无异议。
5. **`resolveRoute` 返回形状变更**：由纯 `RouteTarget` 改为 `RouteDecision { route, source }`，影响 `processQueryData` 与相关测试断言（路由用例需同步更新，属文档同步范围）。

## 维护记录

- 2026-09-23 负责人验收打回（`test/feat-A012/test.md`）后同步展示契约：§4.1 输入 / 输出 hover 改中文段名 + 算式代入；§4.2 角标改 hover 类型标签；§4.3 失败行不再展示响应码；新增 §4.4 单根三段堆叠柱 + 千分位单位、§4.5 耗时 tooltip 层级标注。**接口形状零变更**（仅展示侧）。



