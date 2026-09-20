# 链路日志追踪（表结构 + /api/v1/logs 接口契约 + 埋点方案）

> 作者：老陈
> 对应特性号：feat-A007
> 故事号：story-A007-02（接口文档；实现见 story-A007-03）
> 涉及项目：mcp-orchestrator（server.ts / agent.ts / transport.ts / 新增日志存储层 / data/logs.db）、mcp-web（小叶对接）
> 日期：2026-09-20

## 概述

监控 `POST /api/chat` 全链路（前端发起 t0 → 总台收到 t1 → 队列等待 → 出队处理 t2 → LLM / MCP 工具调用 → 总台返回 t5 → 前端收到 t6 补报）：主表一次请求一条，LLM / 工具明细一对多，落库总台 SQLite 单文件；前端日志页（列表 + 行展开 + Token 图表）经 `/api/v1/logs` 查询。

数据结构与口径直接引用 `requirements/feat-A007-log-tracking.md`「数据模型」章节，本文档落定 DDL、HTTP 契约与写缓冲方案。全部接口沿用 `{ code, data, message }` 信封，分页遵循 `mcp-orchestrator/api/response-convention.md`「分页约定」。

## 表结构

### 主表 request_logs（一次请求一条）

```sql
CREATE TABLE request_logs (
  trace_id             TEXT PRIMARY KEY,               -- 前端 UUID；缺失时服务端兜底生成
  log_type             TEXT NOT NULL,                  -- 记录类型，本期 'chat'
  user_input           TEXT,                           -- 用户输入；≤300 字符（接口 413 上限），校验失败可为 NULL
  domain               TEXT,                           -- 如 'sango-novel'；chat 正常请求必填，校验失败可空
  status               TEXT NOT NULL,                  -- 'success' | 'failed'
  response_code        INTEGER NOT NULL,               -- 信封 code（= HTTP 状态码）
  error_message        TEXT NOT NULL DEFAULT '',       -- 失败原因（信封 message）；成功为空串
  client_sent_at       INTEGER,                        -- t0，毫秒时间戳；前端 X-Client-Sent-At 上报
  server_received_at   INTEGER NOT NULL,               -- t1，毫秒时间戳
  handle_started_at    INTEGER,                        -- t2，毫秒时间戳；校验失败未入队为 NULL
  server_responded_at  INTEGER,                        -- t5，毫秒时间戳；异常中断无响应为 NULL
  client_received_at   INTEGER,                        -- t6，毫秒时间戳；前端补报回填
  answer               TEXT,                           -- 最终返回 data.answer，序列化字符串 ≤8000；失败为 NULL
  citations            TEXT,                           -- data.citations JSON 序列化 ≤8000；成功恒为数组字符串（无引用 '[]'），失败为 NULL
  created_at           INTEGER NOT NULL                -- 落库时间，毫秒；保留 30 天（LOG_RETENTION_DAYS 可配）
);
CREATE INDEX idx_request_logs_received ON request_logs(server_received_at);  -- 时间过滤 + 列表排序
CREATE INDEX idx_request_logs_created  ON request_logs(created_at);          -- 每日清理
```

字段口径：`status` 枚举 `success` / `failed`；时间统一毫秒时间戳、UTC 存储（epoch ms，自含时区语义）、前端本地时区展示；`error_message` 成功为空串；校验失败（400 / 413）也落主表一条，`handle_started_at` 为空、`server_responded_at` 回填校验失败响应时刻。

### LLM 明细 llm_call_logs（每次大模型调用一条，一对多）

```sql
CREATE TABLE llm_call_logs (
  trace_id           TEXT NOT NULL REFERENCES request_logs(trace_id) ON DELETE CASCADE,
  seq                INTEGER NOT NULL,                 -- 同 trace 内调用序号，从 1 起
  stage              TEXT NOT NULL,                    -- 'routing' | 'generation'
  model              TEXT NOT NULL,                    -- 模型名
  request_at         INTEGER NOT NULL,                 -- 发出时间点，毫秒
  response_at        INTEGER,                          -- 返回时间点，毫秒；调用异常失败可为 NULL
  request_summary    TEXT,                             -- 请求内容，序列化字符串 ≤8000
  response_summary   TEXT,                             -- 响应内容，≤8000
  tool_calls         TEXT,                             -- LLM 声明要调的工具（name + arguments，JSON 序列化）≤8000；无则为空串
  prompt_tokens      INTEGER,                          -- LLM usage；缺省为 NULL（不缺失字段）
  completion_tokens  INTEGER,                          -- 同上
  finish_reason      TEXT,                             -- stop / tool_calls / length / error 等
  status             TEXT NOT NULL,                    -- 单次调用成败：'success' | 'failed'
  error_message      TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (trace_id, seq)
);
```

### 工具明细 tool_call_logs（每次 MCP 工具调用一条，一对多）

```sql
CREATE TABLE tool_call_logs (
  trace_id         TEXT NOT NULL REFERENCES request_logs(trace_id) ON DELETE CASCADE,
  seq              INTEGER NOT NULL,                   -- 同 trace 内调用序号，从 1 起（与 LLM 明细各自独立编号）
  mcp_server       TEXT NOT NULL,                      -- MCP 注册名：sango / weather / fengyunsanguo，新 MCP 直接落字段
  tool_name        TEXT NOT NULL,                      -- 如 sango_novel_search
  args_summary     TEXT,                               -- 调用参数，序列化字符串 ≤8000
  call_sent_at     INTEGER NOT NULL,                   -- 总台发出 = MCP 收到，两视角同一时刻只记一次，毫秒
  call_returned_at INTEGER,                            -- MCP 返回时间，毫秒；调用失败可为 NULL
  result_summary   TEXT,                               -- 返回内容，≤8000
  status           TEXT NOT NULL,                      -- 单次调用成败：'success' | 'failed'
  error_message    TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (trace_id, seq)
);
```

### 口径约定（引用需求文档「数据模型」· 口径约定）

- `trace_id` 必填、贯穿全链路：前端生成，所有阶段埋点挂同一值
- 主表写入时序：请求进入即落骨架（log_type / trace_id / user_input / domain / t1）→ 处理结束回填（t2 / t5 / answer / citations / response_code / status / error_message）→ 前端补报回填 t6，按 trace_id 更新；进程崩溃等异常保留骨架（status=failed、error_message 标注中断）
- 类型扩展：主表以 `log_type` 区分（本期 `chat`）；明细表对未涉及的类型为空；记录器按「类型 / 入口接口」注册表登记，新类型只加注册、不改结构
- 校验失败也落库：参数无效（400）/ 超长（413）等未入队请求同样落主表一条（trace_id 已透传）
- 时间点只记一次：「大模型发出工具请求」与「MCP 收到请求」是同一时刻，只记 `call_sent_at`
- 明细一对多：tool-use 是循环，一次请求可多次调 LLM / 工具
- 派生值不落库：耗时由时间点相减、token 聚合由 llm 明细 SUM，均在查询 / 展示层计算（v1 不加冗余列）
- 无 LLM 调用时 token 为 null（列表 tokens 与明细 token 字段均如此，不返回 0）

## 请求头约定（链路关联键）

| Header | 必填 | 说明 |
|--------|------|------|
| `X-Trace-Id` | 否（服务端兜底） | 前端生成 UUID v4；**幂等重试沿用同一值**。缺失时服务端兜底生成，并随响应头 `X-Trace-Id` 返回；前端补报一律用响应头里的值（兜底场景以服务端为准） |
| `X-Client-Sent-At` | 否 | 前端发起时刻 t0，毫秒时间戳（`Date.now()`）；未上报时 `client_sent_at` 为 NULL |

- 幂等语义：同一 trace_id 的重复请求（重试 / 超时重发）服务端按「骨架复用 + 回填」处理，不重复插入新记录
- 校验失败（400 / 413）同样依托 trace_id 落骨架：请求头缺失时服务端兜底生成并随响应头返回
- 跨域 / 网关部署时需暴露 `X-Trace-Id` 响应头（CORS `Access-Control-Expose-Headers`），否则前端读不到兜底值

## 接口契约

信封统一 `{ code, data, message }`：成功 `code`=200；失败 `data`=null、`message` 必填。四个 `/api/v1/logs` 接口均不参与日志埋点（防递归）。

### GET /api/v1/logs —— 列表

| 属性 | 值 |
|------|-----|
| 方法 | GET |
| 路径 | /api/v1/logs |

**请求参数（query）：**

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `pageNo` | number | 否 | 从 1 起，默认 1 |
| `pageSize` | number | 否 | 默认 20，范围 1–100，越界裁剪 |
| `logType` | string | 否 | 记录类型精确匹配；本期仅 `chat`，默认全部 |
| `traceId` | string | 否 | 精确匹配，排错定位单条 |
| `startAt` / `endAt` | number（ms） | 否 | 过滤 `server_received_at` ∈ [startAt, endAt] |
| `status` | string | 否 | `success` / `failed` |
| `responseCode` | number | 否 | 信封 code 精确匹配，如 500 |
| `keyword` | string | 否 | 模糊匹配 `user_input`（LIKE %kw%） |

排序固定 `server_received_at` DESC（新在前）。

**列表项字段（不含明细）：**

| 字段 | 类型 | 说明 |
|------|------|------|
| `traceId` | string | 链路关联键 |
| `logType` | string | `chat` |
| `userInput` | string | 摘要，≤200 字符，超长带「…（已截断）」标记 |
| `domain` | string \| null | 如 `sango-novel` |
| `status` | string | `success` / `failed` |
| `responseCode` | number | 信封 code |
| `errorMessage` | string | 失败原因原文，成功为空串 |
| `serverReceivedAt` | number（ms） | 时间锚（t1） |
| `durations` | object | 派生耗时（ms），定义见下 |
| `tokens` | object \| null | 派生 token 聚合，无 LLM 调用时整体为 null |

`durations` 字段与公式（时间点缺失则对应项为 null，不估算）：

| 字段 | 公式 |
|------|------|
| `frontend` | 前端耗时 = (t1 − t0) + (t6 − t5)，上行 + 下行 |
| `queueWait` | 队列等待 = t2 − t1（校验失败未入队为 null） |
| `server` | 总台耗时 = t5 − t1（含队列等待，队列单独列出便于归因） |
| `llm` | LLM 耗时 = Σ(response_at − request_at)，各调用之和 |
| `tool` | 工具耗时 = Σ(call_returned_at − call_sent_at) |
| `total` | 总耗时 = t6 − t0 |

`tokens`：`{ "input": number|null, "output": number|null }`；`input` = SUM(prompt_tokens)，`output` = SUM(completion_tokens)（llm 明细，不落库）；无 LLM 调用记录时为 null。SUM 忽略 usage 缺失（null）的行。

**成功响应：**

```json
{
  "code": 200,
  "data": {
    "list": [
      {
        "traceId": "9f7c...（uuid）",
        "logType": "chat",
        "userInput": "《三国演义》中关羽千里走单骑的经过是怎样的？",
        "domain": "sango-novel",
        "status": "success",
        "responseCode": 200,
        "errorMessage": "",
        "serverReceivedAt": 1789884000000,
        "durations": { "frontend": 7550, "queueWait": 12, "server": 3450, "llm": 2800, "tool": 600, "total": 11000 },
        "tokens": { "input": 1234, "output": 860 }
      }
    ],
    "total": 1,
    "pageNo": 1,
    "pageSize": 20
  },
  "message": ""
}
```

**错误响应：**

| code | 场景 | message 示例 |
|------|------|-------------|
| 400 | `pageNo` / `pageSize` / `status` / `startAt` / `endAt` 非法 | `分页参数非法`、`status 只支持 success/failed` |
| 500 | 查询内部错误 | `查询日志失败，请稍后重试` |

### GET /api/v1/logs/:traceId —— 明细

| 属性 | 值 |
|------|-----|
| 方法 | GET |
| 路径 | /api/v1/logs/:traceId |

主表整行 + LLM 明细 + 工具明细，行展开时按需拉取。

**成功响应（`data.log` 为主表全字段 camelCase；`llmCalls` / `toolCalls` 按 seq 升序）：**

```json
{
  "code": 200,
  "data": {
    "log": {
      "traceId": "9f7c...（uuid）",
      "logType": "chat",
      "userInput": "《三国演义》中关羽千里走单骑的经过是怎样的？",
      "domain": "sango-novel",
      "status": "success",
      "responseCode": 200,
      "errorMessage": "",
      "clientSentAt": 1789883998000,
      "serverReceivedAt": 1789884000000,
      "handleStartedAt": 1789884000012,
      "serverRespondedAt": 1789884003450,
      "clientReceivedAt": 1789884009000,
      "answer": "关羽在曹操军中得知刘备下落……",
      "citations": "[{...}]",
      "createdAt": 1789884010000
    },
    "llmCalls": [
      {
        "seq": 1,
        "stage": "generation",
        "model": "qwen-plus",
        "requestAt": 1789884000300,
        "responseAt": 1789884003100,
        "requestSummary": "{...}",
        "responseSummary": "{...}",
        "toolCalls": "[{...}]",
        "promptTokens": 1234,
        "completionTokens": 860,
        "finishReason": "tool_calls",
        "status": "success",
        "errorMessage": ""
      }
    ],
    "toolCalls": [
      {
        "seq": 1,
        "mcpServer": "sango",
        "toolName": "sango_novel_search",
        "argsSummary": "{\"source\":\"sanguo-yanyi\",\"query\":\"关羽 千里走单骑\"}",
        "callSentAt": 1789884003200,
        "callReturnedAt": 1789884003800,
        "resultSummary": "[{...}]",
        "status": "success",
        "errorMessage": ""
      }
    ]
  },
  "message": ""
}
```

**错误响应：**

| code | 场景 | message 示例 |
|------|------|-------------|
| 404 | traceId 不存在 | `日志不存在` |
| 400 | traceId 非法（非 UUID 格式） | `traceId 格式非法` |
| 500 | 查询内部错误 | `查询日志失败，请稍后重试` |

### POST /api/v1/logs/:traceId/frontend-end —— 前端补报

| 属性 | 值 |
|------|-----|
| 方法 | POST |
| 路径 | /api/v1/logs/:traceId/frontend-end |
| Content-Type | application/json |

前端收到响应后补报 t6，body 只接受 `clientReceivedAt`。**traceId 找不到时静默 200**，不打扰主流程；前端 fire-and-forget，不因补报失败报错。

**请求：**

```json
{ "clientReceivedAt": 1789884009000 }
```

**成功响应（无论 traceId 是否存在均为此结构）：**

```json
{ "code": 200, "data": null, "message": "" }
```

**错误响应：**

| code | 场景 | message 示例 |
|------|------|-------------|
| 400 | `clientReceivedAt` 缺失 / 非毫秒数字 | `clientReceivedAt 必填且为毫秒时间戳` |

### GET /api/v1/logs/token-stats —— Token 图表

| 属性 | 值 |
|------|-----|
| 方法 | GET |
| 路径 | /api/v1/logs/token-stats |

**请求参数（query）：**

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `startAt` | number（ms） | 是 | 区间起点 |
| `endAt` | number（ms） | 是 | 区间终点 |
| `granularity` | string | 否 | `day` \| `hour`，默认 `day`；`hour` 且区间 > 7 天自动降级 `day` |

按 `llm_call_logs.request_at` 分桶，桶内 `inputTokens` = SUM(prompt_tokens)、`outputTokens` = SUM(completion_tokens)（调用时刻在区间外不入桶）；分桶日界以 **Asia/Shanghai** 计算（与前端展示时区一致，与服务端 TZ 无关）；区间内无数据桶**补零**（连续时间轴，图表友好）。

**成功响应（`buckets[].bucket` 为桶起始时刻 Asia/Shanghai 本地时间字符串：day 例 `2026-09-20`，hour 例 `2026-09-20T14:00`；`granularity` 返回实际生效粒度）：**

```json
{
  "code": 200,
  "data": {
    "granularity": "day",
    "timezone": "Asia/Shanghai",
    "startAt": 1789833600000,
    "endAt": 1790006400000,
    "buckets": [
      { "bucket": "2026-09-20", "inputTokens": 1234, "outputTokens": 860 },
      { "bucket": "2026-09-21", "inputTokens": 2000, "outputTokens": 0 }
    ]
  },
  "message": ""
}
```

**错误响应：**

| code | 场景 | message 示例 |
|------|------|-------------|
| 400 | `startAt` / `endAt` 缺失或非法、`startAt` > `endAt`、`granularity` 非 day/hour | `startAt/endAt 必填且为毫秒时间戳` |
| 500 | 查询内部错误 | `查询统计失败，请稍后重试` |

**路由注册顺序**：`token-stats` 必须先于 `/:traceId` 注册，否则被通配参数吞掉（Express 按注册顺序匹配，`GET /api/v1/logs/token-stats` 会落入 `GET /api/v1/logs/:traceId`）。

## 分页与版本化

- 分页：`pageNo`（从 1 起）/ `pageSize`，响应元数据放 `data` 内 `{ list, total, pageNo, pageSize }`，所有列表页通用；已补登 `mcp-orchestrator/api/response-convention.md`「分页约定」
- 新增接口统一 `/api/v1/` 前缀；总台侧 v1 处理器独立存放（如 `src/api/v1/`），不混入存量 server.ts 路由
- 大版本升级整体换 `/api/v2/`（整前缀替换，不并存双版本）；本特性接口文档随版本号更新
- 存量接口（`/api/chat`、`/api/sango/random`、`/api/tools`、`/health`）暂不迁移；出现对外发布 / 多消费方 / 需并存旧行为时整体迁移（另立特性）

## 截断口径

- 内容字段（answer / citations / request_summary / response_summary / tool_calls / args_summary / result_summary）统一在**序列化后的字符串层面**截 ≤8000 字符，截断处追加标记「…（已截断）」，标记不计入 8000 上限
- 列表 `userInput` 只展示 ≤200 字符摘要，同样在截断处加标记
- `user_input` 本身受接口 300 字符上限约束（413），不另设截断
- 时间统一毫秒时间戳、UTC 存储（epoch ms）；前端本地时区展示：列表时间列 `YYYY-MM-DD HH:mm:ss`，明细时间点 `YYYY-MM-DD HH:mm:ss.SSS`，耗时列毫秒整数（前端可格式化为 `123ms` / `1.2s`）

## 存储与写缓冲

- 选型：`better-sqlite3`（已定，不再自选）；单文件 `data/logs.db`，归属总台 mcp-orchestrator，随总台部署；mcp-server / mcp-web 不接触数据库
- 同步 API 写主线程以「写缓冲批量落盘」控制：埋点先入内存队列，定时器 **1 秒** 或队列满 **50 条**触发，**单事务**批量执行；不起线程、不引 worker；日志查询相对实时写入最多延迟约 1 秒
- 幂等写入：骨架 `INSERT OR IGNORE`（trace_id 唯一）+ 回填 `UPDATE ... WHERE trace_id=?`，重复请求不重复插入
- 旁路原则：日志写入失败静默（try/catch + 告警日志），**不影响 `/api/chat` 主流程与响应**；日志接口自身不记日志（防递归）
- 保留与清理：默认保留 30 天（`LOG_RETENTION_DAYS` 可配），每日定时 `DELETE FROM request_logs WHERE created_at < 当前时刻 − 天数`，明细随主表级联删除（ON DELETE CASCADE）

## 前端对接（小叶）

- 路由 `/logs` 双 Tab「日志列表」/「Token 统计」，默认「日志列表」；列表用 antd Vue Table
- **上报**：发 `POST /api/chat` 时生成 UUID（`crypto.randomUUID()`）存会话级变量随 `X-Trace-Id` 发送，**重试沿用同一值**；`X-Client-Sent-At` = `Date.now()`；收到响应后补报 `POST /api/v1/logs/{响应头 X-Trace-Id}/frontend-end`，body `{ clientReceivedAt: Date.now() }`
- **列表列**（字段见「GET /api/v1/logs · 列表项字段」）：时间列 `serverReceivedAt` → `YYYY-MM-DD HH:mm:ss`（本地时区）；`logType` 直接展示；`userInput` 摘要 ≤200 字符；`domain` 空显 `—`；状态列 `status`（failed 红色 + `responseCode`）+ `errorMessage`；耗时列展示总 / 前端 / 总台 / LLM / 工具（队列等待可并入 tooltip），ms 格式化 `123ms` / `1.2s`，null 显 `—`；Token 列 `tokens.input / tokens.output`，≥1000 转千格式 1 位小数去尾 0（1234→`1.2k`、2000→`2k`），<1000 原样，null 显 `—`，示例 `1.2k / 860`
- **查询区**：类型下拉（v1 默认全部 = 不传 `logType`）/ 时间范围（`startAt`/`endAt`）/ `traceId` / `keyword` / `status` / `responseCode`；分页
- **行展开**：点操作列调 `GET /api/v1/logs/:traceId`，LLM / 工具两张子表（模型 / token / 时间 / 内容）；内容字段 JSON 格式化 + 语法高亮（`<pre>` + 轻量着色，不引额外库），含「…（已截断）」标记的字段明示「（已截断）」
- **错误展示**：`status=failed` 红色状态标签 + `responseCode` + `errorMessage` 原文直接可读
- **Token 统计**：echarts 输入 / 输出双系列柱状图；快捷区间（今天 / 近 7 天 / 近 30 天）+ 自定义起止；`granularity` 切换（跨天默认 day、当天内 hour、区间过大自动 day）；右上角刷新按钮
- 跨域 / 网关部署时需读取响应头 `X-Trace-Id`（服务端需 CORS 暴露该头）

## 验收标准（接口侧，对应需求「验收标准」）

| #（需求） | 验收点（可测） | 落点 |
|---|----------|----------|
| ① | 带 `X-Trace-Id` 调 `/api/chat` 一问一答后，列表出现一条记录；明细各时间点与需求链路阶段一致 | 主表时序 + 明细接口 |
| ② | 列表 `tokens` = 该 trace llm 明细 SUM；无 LLM 调用 → `tokens` 为 null | 列表接口 |
| ③ | token-stats 按 `request_at` 分桶，∑桶数据 = 明细 SUM；Asia/Shanghai 日界；空桶补零 | token-stats 接口 |
| ⑤ | `X-Client-Sent-At` 落 `clientSentAt`，补报落 `clientReceivedAt`（= t6）；未知 traceId 补报静默 200；兜底 traceId 随响应头返回 | 请求头 + 补报接口 |
| ⑥ | 两个并发请求时第二条 `durations.queueWait` > 0 | 列表 `durations` |
| ⑦ | 400 / 413 / 500 / 503 各失败场景 `responseCode` + `errorMessage` 正确；校验失败也落主表一条 | 埋点 + 列表 |
| ⑧ | 各过滤参数（logType / traceId / startAt / endAt / status / responseCode / keyword）+ 分页 + total 正确 | 列表接口 |
| ⑨ | 内容字段 8000 截断 +「…（已截断）」标记；列表 `userInput` ≤200 摘要 | 存储截断 + 列表 |
| ⑪ | 故障注入（DB 写抛错）后 `/api/chat` 仍正常返回 | 旁路原则 |
| ⑫ | 既有 A003~A006 相关测试全绿（埋点不改业务行为） | 回归 |
| 契约 | `GET /api/v1/logs/token-stats` 不被 `/:traceId` 吞掉（路由顺序） | 技术要点 |

## 技术要点

- 路由注册顺序：`/api/v1/logs` 与 `/api/v1/logs/token-stats` 在 `/:traceId` 之前注册
- v1 处理器独立存放（如 `src/api/v1/`），升级大版本整体换 `/api/v2/`
- 埋点中间件：HTTP 收（t1 落骨架）→ 队列出队（t2 回填）→ HTTP 响应（t5 回填）→ 补报（t6 回填）；`/api/v1/logs*` 路径排除在埋点之外（防递归）
- AsyncLocalStorage 贯穿 traceId（agent.ts LLM 明细 / transport.ts 工具明细，小胡落点）
- 派生值（耗时、token 聚合）查询层计算，不落库；LIKE 模糊匹配走不了索引，v1 数据量可接受，量级上来另议
- 列表默认按 `server_received_at` DESC，时间范围过滤同样落在该列（有索引）
- 同一 trace_id 重复请求按幂等处理（骨架 INSERT OR IGNORE + 回填 UPDATE），重试不产生重复记录

