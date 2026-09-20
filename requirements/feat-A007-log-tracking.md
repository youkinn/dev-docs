# feat-A007: 链路日志追踪列表（后台管理页）

> 特性号：feat-A007
> 状态：定稿（负责人 2026-09-20 评审通过）
> 作者：Coco
> 涉及项目：mcp-orchestrator（总台）, mcp-web（前厅）
> 日期：2026-09-20
> 关联：feat-A003（统一对话入口 / 串行队列）、feat-A004（三国演义 RAG 快路径）、feat-A005（fengyunsanguo MCP 化）

## 背景

监控问答的整个链路，方便排错和后续优化（优化需要数据做支撑，知道系统短板在哪里）。现状：从前厅输入到总台返回响应的全链路没有任何落库记录，出问题只能现场复现，优化无数据可依。

本次做后台管理的「日志追踪列表页」：记录一次问答请求全链路的各阶段时间点与内容，前端以列表 + 行展开明细展示。

**范围与命名**：
- 链路入口是 `POST /api/chat`（`GET /api/tools` 是工具列表接口，与链路无关）
- 「SangoMcp」即 MCP 注册名 `sango`、工具 `sango_novel_search`（三国演义 RAG，feat-A004）
- 本期先做三国演义（`domain=sango-novel`），记录结构通用化：MCP 名 / 工具名 / 模型名都是字段，接入 weather / fengyunsanguo 或新 MCP 零改结构

## 目标

- [ ] 全链路埋点：主表一次请求一条 + LLM 明细 / 工具明细一对多（HTTP 收/发、队列等待、LLM 调用、MCP 工具调用）
- [ ] 前端新增「日志追踪页」（`/logs`）双标签：「日志列表」antd Vue Table + 查询过滤 + 分页 + 行展开明细，「Token 统计」图表（样式美观）
- [ ] '/' 首页左上角 MCP WORKSPACE 区块整体加链接，点击跳转日志页
- [ ] 首页聊天区增加 keep-alive（切到日志页再回来不丢输入与消息）
- [ ] 通用化留口子：接入新 MCP 零改结构，只加注册

## 非目标

- 不做登录鉴权（前台无登录体系，日志含用户输入文本 → 风险登记，v1 内网使用；需要时另立特性）
- 不做日志详情独立页（v1 用行展开）
- 不做无限全文入库：内容字段统一截断 8000 字符（覆盖 sango 返回上限 10 条 × 400 汉字 + JSON 结构余量）；确需全文存储另议
- 不做统计报表 / 耗时告警（数据字段已留口子，完整耗时 / 成本画像后续优化特性另立）；token 柱状图属列表页直观展示，在本条内
- 本期只注册 `chat` 类型（`POST /api/chat`）；`/api/sango/random`（确定性、不经 LLM）与 `GET /api/tools` 不属于本条，记录器按「类型 / 入口接口」注册表登记、后续可加
- 不记流式输出（BL-014 未立项）；不改任何现有 `/api/chat` 契约与行为

## 链路阶段（一次 /api/chat 请求）

```text
前端发起 t0 ──上行──> 总台收到 t1 ──队列等待──> 出队开始处理 t2
  ──> LLM 调用 #1（t3a→t3b，可能 tool_call）──> MCP 工具调用 #1（t4a→t4b）
  ──> LLM 调用 #2 ...（tool-use 循环，可多轮）
  ──> 总台返回 t5 ──下行──> 前端收到 t6（前端补报）
```

注：总台 `/api/chat` 与 `/api/sango/random` 共用串行队列，t1→t2 的队列等待必须单列，否则耗时归因会误导优化方向。

## 数据模型（老陈出接口文档时直接引用）

### 主表 request_logs（一次请求一条）

| 字段 | 类型 | 口径 |
|------|------|------|
| `log_type` | string，必填 | 记录类型。本期注册 `chat`（/api/chat 问答链路）；后续追踪其它内容（如 `random` / 流式等）只加注册，结构不变 |
| `trace_id` | string，必填 | 前端生成 UUID，`X-Trace-Id` 请求头透传，全链路关联键 |
| `user_input` | string | 用户输入文本；接口已有 ≤300 字符上限（413），不另设截断；校验失败（如空 message）可为空 |
| `domain` | string \| null | 如 `sango-novel`；chat 类型正常请求必填，校验失败可空，其它类型可空 |
| `status` | enum | `success` / `failed`，请求整体成败 |
| `response_code` | number | 信封 `code`（= HTTP 状态码），如 200 / 400 / 413 / 500 / 503 |
| `error_message` | string | 失败原因（信封 `message`；无信封时为内部错误摘要），成功为空 |
| `client_sent_at` | ms 时间戳 \| null | 前端发起时刻（t0），随 `X-Client-Sent-At` 请求头上报 |
| `server_received_at` | ms 时间戳 | 总台收到请求（t1） |
| `handle_started_at` | ms 时间戳 \| null | 出队开始处理（t2）；与 t1 之差 = 队列等待；校验失败未入队时为空 |
| `server_responded_at` | ms 时间戳 \| null | 总台返回响应（t5）；异常中断无响应时为空 |
| `client_received_at` | ms 时间戳 \| null | 前端收到响应后补报（t6） |
| `answer` | string ≤8000 \| null | 最终返回内容（`data.answer`），超限截断；失败时为空 |
| `citations` | string ≤8000 \| null | 响应 `data.citations`（A006 引用卡片，JSON 序列化截断）；成功无引用恒 `[]`，失败时为空 |
| `created_at` | 时间 | 落库时间；默认保留 30 天（`LOG_RETENTION_DAYS` 可配），每日清理 |

### LLM 明细 llm_call_logs（每次大模型调用一条，一对多）

| 字段 | 口径 |
|------|------|
| `trace_id` + `seq` | 关联主表，调用序号 |
| `stage` | `routing`（路由判断）/ `generation`（答案生成） |
| `model` | 模型名；看模型与 token 成本必备 |
| `request_at` / `response_at` | 发出 / 返回时间点 |
| `request_summary` / `response_summary` | 请求 / 响应内容，各 ≤8000 字符截断 |
| `tool_calls` | string ≤8000 | LLM 响应中声明的工具调用（name + arguments，JSON 截断）；无则为空；与工具明细呼应（模型想调什么 vs 实际调了什么） |
| `prompt_tokens` / `completion_tokens` | LLM usage；缺省为 null，不缺失字段 |
| `finish_reason` | string | LLM 停止原因：stop / tool_calls / length / error 等；length 表示输出被截断，排错必查 |
| `status` / `error_message` | 单次调用成败 |

### 工具明细 tool_call_logs（每次 MCP 工具调用一条，一对多）

| 字段 | 口径 |
|------|------|
| `trace_id` + `seq` | 关联主表，调用序号 |
| `mcp_server` | MCP 注册名（`sango` / `weather` / `fengyunsanguo`，新 MCP 直接落字段） |
| `tool_name` | 工具名，如 `sango_novel_search` |
| `args_summary` | 调用参数 ≤8000 字符截断（排错需看参数，仅工具名不够） |
| `call_sent_at` | 总台发出时间 = MCP 收到时间（两视角同一时刻，只记一次） |
| `call_returned_at` | MCP 返回时间 |
| `result_summary` | 返回内容 ≤8000 字符截断（覆盖 10 条 × 400 汉字上限 + JSON 结构） |
| `status` / `error_message` | 单次调用成败（如 isError / 超时 / server 不可用） |

### 口径约定

- `trace_id` 必填、贯穿全链路：前端生成，所有阶段埋点挂同一值
- 主表写入时序：请求进入即落骨架（log_type / trace_id / user_input / domain / t1）→ 处理结束回填（t2 / t5 / answer / citations / response_code / status / error_message）→ 前端补报回填 t6；按 trace_id 更新。进程崩溃等异常时保留骨架记录（status=failed、error_message 标注中断）
- 类型扩展：主表以 `log_type` 区分记录类型（本期 `chat`）；明细表（LLM / 工具）对未涉及的类型为空即可，记录器按「类型 / 入口接口」注册表登记，新增类型只加注册、不改结构
- 校验失败也落库：参数无效（400）/ 超长（413）等未进入编排的请求同样落主表一条（`trace_id` 已透传），保证链路完整可查
- 时间点只记一次：「大模型发出工具请求」与「MCP 收到请求」是同一时刻，只记 `call_sent_at`
- 明细一对多：tool-use 是循环，一次请求可能多次调 LLM / 工具
- 内容截断：统一在序列化后的字符串层面截 8000 字符，截断处标记；列表列只展示 200 字符摘要
- 内容展示：通讯内容多为 JSON，前端以 JSON 格式化 + 语法高亮呈现（美观且便于查看）
- 通用化：阶段字段与具体 MCP 解耦，新 MCP 接入只加注册
- 时间：统一毫秒时间戳、UTC 存储、前端本地时区展示（具体格式接口文档定）
- 派生值不落库：耗时由时间点相减、token 聚合（输入 / 输出）由 llm 明细 SUM，均在查询 / 展示层计算；需要按 token 排序或做统计画像时再落冗余列（v1 不加）

## 接口契约（老陈出接口文档时直接引用）

- 信封：三个新接口（列表 / 明细 / 补报）沿用统一响应结构 `{ code, data, message }`（遵循 `mcp-orchestrator/api/response-convention.md`），不另立包装；成败语义同约定（`code`=200 成功 / 失败 `data`=null + `message`）
- 分页约定：分页参数与响应元数据统一 `pageNo`（从 1 起）/ `pageSize`，放 `data` 内（`{ list, total, pageNo, pageSize }`），所有列表页通用；老陈出接口文档时同步补登 `response-convention.md`
- 请求头：`X-Trace-Id`（前端生成 UUID，幂等重试沿用同一值；缺失时服务端兜底生成并随响应头 `X-Trace-Id` 返回，前端补报用响应头里的值）、`X-Client-Sent-At`（毫秒时间戳）
- 前端补报：`POST /api/v1/logs/:traceId/frontend-end`（body 带 `client_received_at`；成功返回 `{ code: 200, data: null, message: "" }`；traceId 找不到时静默 200，不打扰主流程）
- 列表：`GET /api/v1/logs` —— 分页（`pageNo` / `pageSize`）+ 过滤（`log_type` / `traceId` / 时间范围 / `status` / `response_code` / `keyword` 匹配 user_input）；列表项含派生耗时（前端 / 队列等待 / 总台 / LLM / 工具 / 总耗时）与 token 聚合（输入 / 输出，由 llm 明细 SUM，不落库），**不含明细**
- 明细：`GET /api/v1/logs/:traceId` —— 主表 + LLM 明细 + 工具明细，行展开时按需拉取
- 图表：`GET /api/v1/logs/token-stats` —— 参数 `startAt` / `endAt` / `granularity=day|hour`；返回按时间分桶的输入 / 输出 token 聚合（llm 明细按时间 SUM）；**路由顺序**：`token-stats` 注册先于 `/api/v1/logs/:traceId`，避免被通配参数吞掉
- 版本化：新增接口统一 `/api/v1/` 前缀，总台侧 v1 处理器独立存放；升级大版本整体换 `/api/v2/`。存量接口（`/api/chat`、`/api/sango/random`、`/api/tools`、`/health`）暂不迁移，出现对外发布 / 多消费方 / 需并存旧行为时整体迁移（另立特性）
- 旁路原则：埋点失败必须静默（不影响 `/api/chat` 主流程与响应）；日志接口自身不记日志（防递归）；`/api/chat` 现有契约零变化
- 存储：SQLite（`better-sqlite3`，已定，不再自选）；单文件零运维、分页过滤够用；同步 API 的主线程阻塞以「写缓冲批量落盘」控制：埋点先进内存队列（如 1 秒 / 50 条一刷、单事务），单批毫秒级、可忽略（日志查询相对实时写入最多延迟约 1 秒）；不起线程、不引 worker；表结构由接口文档定；数据库与存储层归属总台（mcp-orchestrator），SQLite 单文件随总台部署（如总台仓库 `data/logs.db`），器坊 / 前厅不接触数据库

## 展示规则（前端，小叶实现）

1. 新增路由 `/logs` 日志追踪页：顶部 antd Tabs 双标签「日志列表」/「Token 统计」，默认「日志列表」；列表 Tab 用 antd Vue Table：时间 / log_type / user_input 摘要（200 字符）/ domain / 状态 + 响应码 / 耗时列（总、前端、总台、LLM、工具）/ Token 列（输入 / 输出，如 `1.2k / 860`）/ 操作列
2. 顶部查询区：类型（v1 默认全部）/ 时间范围 / traceId / 关键字 / 状态 / 响应码；分页
3. 行展开：LLM 明细 + 工具明细两张子表（模型 / token / 时间 / 内容）
4. 内容展示：JSON 格式化 + 语法高亮（`<pre>` + 轻量语法着色，不引额外库）；截断处明示「（已截断）」
5. 错误展示：`status=failed` 红色状态 + `response_code` + `error_message` 原文可直接读
6. '/' 首页左上角 MCP WORKSPACE 区块整体改为可点击链接，跳转 `/logs`
7. 首页聊天组件用 keep-alive 缓存（切到 `/logs` 再回来不丢输入与消息列表）
8. 样式美观即可，着色以状态列为主
9. token 可视化（图表，位于「Token 统计」Tab）：输入 / 输出 token 双系列柱状图，按时间聚合
   - 时间段查询：预设快捷区间（今天 / 近 7 天 / 近 30 天）+ 自定义起止日期；按天 / 按小时聚合以 Asia/Shanghai 为日界（与展示时区一致）
   - 粒度切换：按天 / 按小时（跨天用按天，当天内用按小时；区间过大时自动按天，避免小时桶过多）
   - 刷新按钮：卡片右上角，手动重新拉取图表数据
   - 图表库：echarts（已定，不再自选）

## 验收标准

- [ ] 三国演义一问一答后，列表出现一条记录：各阶段时间点正确，展开可见 LLM 明细与 `sango_novel_search` 工具明细、返回内容（answer + citations）
- [ ] 列表 Token 列正确：记录的输入 / 输出 token 与 llm 明细之和一致（无 LLM 调用时为空）
- [ ] token 柱状图：输入 / 输出双系列按时间聚合，数据与明细一致
- [ ] token 图表交互：「Token 统计」Tab 内时间段查询（快捷区间 + 自定义）、按天 / 按小时切换、右上角刷新按钮均生效；双标签切换正常、默认落在「日志列表」
- [ ] 前端两时间有效：`client_sent_at`（请求头）与 `client_received_at`（补报）各就各位，前端耗时可算
- [ ] 队列等待可见：两个并发请求下，第二条的 `handle_started_at - server_received_at > 0`
- [ ] 失败场景可查：sango 未配置（503）/ LLM 失败（500）/ 参数无效（400）/ 超长（413）→ `response_code` + `error_message` 正确记录并展示
- [ ] 查询：类型 / traceId / 时间范围 / 关键字 / 状态 / 响应码过滤 + 分页均生效
- [ ] JSON 内容格式化 + 语法高亮可读，截断处有「已截断」标记
- [ ] '/' 左上角链接跳转 `/logs`；keep-alive 生效（切页回来聊天状态不丢）
- [ ] 日志写入失败不影响 `/api/chat` 主流程（故障注入验证）
- [ ] 既有 A003~A006 相关测试全绿（埋点不改业务行为）

## 任务与负责人

| 任务 | 负责人 | 依赖 |
|------|--------|------|
| 接口文档（X-Trace-Id / 补报头、`/api/v1/logs` 列表与明细、分页 `pageNo`/`pageSize` 与版本化约定、表结构、截断口径、SQLite 写缓冲方案） | 老陈 | 需求定稿 |
| 总台埋点：存储层 + 查询接口 + server.ts 中间件埋点（HTTP 收/发、队列出队、trace 上下文贯穿） | 老陈 | 接口文档 |
| 编排埋点：agent.ts LLM 明细（stage/model/token/耗时）+ transport.ts 工具明细（AsyncLocalStorage 携带 traceId） | 小胡 | 接口文档 |
| 前端：日志页（Table / 查询 / 展开 / JSON 高亮）+ traceId/时间上报与补报 + '/' 链接 + keep-alive | 小叶 | 接口文档 |
| 需求 / INDEX 定稿、审查提测 | Coco | — |

## 分支计划

- dev-docs：`coco/feat-A007_log-tracking`
- mcp-orchestrator：Coco 拉需求分支 `coco/feat-A007_log-tracking`，老陈 / 小胡基于它拉个人分支（`chen/feat-A007_*`、`hu/feat-A007_*`），自合入需求分支
- mcp-web：单人（小叶）直拉 `ye/feat-A007_log-page`

## 故事号（Coco 生产）

| 故事号 | 内容 | 负责人 | 状态 |
|--------|------|--------|------|
| story-A007-01 | 需求文档定稿与故事号 / INDEX 登记 | Coco | 已完成（2026-09-20 定稿） |
| story-A007-02 | 接口文档：埋点 / 查询 / 补报契约 + 表结构（老陈先出） | 老陈 | 已完成（2026-09-20 审查通过） |
| story-A007-03 | 实现：总台 + 编排埋点（HTTP / 队列 / LLM / 工具明细 + 存储 + 查询接口） | 老陈 + 小胡 | 已完成（2026-09-20 审查通过） |
| story-A007-04 | 前端：日志页 + traceId/时间上报与补报 + '/' 链接 + keep-alive | 小叶 | 已完成（2026-09-20 审查通过） |

> 注：本特性按 需求 / 接口 / 实现 / 前端 4 粒度规划故事号（大功能：新存储 + 三侧改动），各粒度开发期间复用对应故事号，不为每个任务 / 提交新建。

## 风险 & 开放问题

- 前台无登录 + 日志含用户输入 → 权限与隐私风险（v1 不鉴权、内网使用；加登录另立特性）
- `client_sent_at` / `client_received_at` 依赖前端上报，未上报 / 未补报时前端耗时空，列表不报错
- 截断 8000 字符：对超过上限的极端内容，行展开也只到 8000（v1 接受；需全文时放开存储或另议）
- 日志增长：默认保留 30 天 + 每日清理（`LOG_RETENTION_DAYS` 可配）；后续需要永久存储时另议存储方案
- 同步存储阻塞：better-sqlite3 同步 API 写主线程，靠写缓冲批量落盘控制（单批毫秒级）；写延迟明显时换异步方案（`sqlite3` 包 / 独立进程），另议
- 统计报表 / 耗时画像留待后续优化特性（数据字段已留口子）

## 合并记录

| 成员 | 分支名 | 审查结果 | 合并日期 |
|------|--------|----------|----------|
| — | — | — | — |











