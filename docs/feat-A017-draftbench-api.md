# FEAT-A017 草稿台接口契约（story-A017-01）

> 用途：小胡按此实现 CLI + 编排侧管线（traceId 拉取 / 手动生成 / 本次参数覆盖）；小叶按此实现 mcp-web 草稿台弹框、来源筛选与差异展示。契约定稿人：Coco；契约变更先问 Coco，不得自行改接口 / 字段。
> 需求依据：`requirements/feat-A017-draftbench-temperature.md`（已定稿）；口径冲突以需求文档为准。
> 代码锚点：以 origin/main 为锚（2026-09-27 核对），本文「现实锚点」逐条指向源码；在途分支影响见 §9。
> 契约状态：定稿（2026-09-27，Coco 定答 §10 五项决策）。

## 1. 总体约束

- 草稿台 = 3 组后端能力：① 新辅助接口（traceId 拉取 / 草稿台记录列表与详情）；② 发送复用生产 `POST /api/chat`（带「来源=草稿台」标记 + 请求级参数覆盖）；③ 日志查询接口加「来源」筛选。全部挂在 mcp-orchestrator（与 `/api/v1/logs*` 同级、同一 Express 进程）。
- 信封沿用 mcp-web `api/client.ts` 惯例：成功 `{ code: 200, message: '', data }`；失败 `{ code: 4xx/5xx, message }`，前端以 `code === 200` 判成功；`data` 出错时为 `null`。
- 时间：全部为毫秒时间戳（含 `X-Client-Sent-At`）；分页口径与 `/api/v1/logs` 一致（`pageNo` 从 1 起、`pageSize` 缺省 20、上限 100）。
- traceId：沿用 UUID（正则 `/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i`）。发送请求带 `X-Trace-Id`（前端预生成）或服务端兜底生成，一律以响应头 `X-Trace-Id` 为准（既有 `tracingMiddleware` 行为）。
- **一次点击 = 一次 `POST /api/chat` = 一个新 traceId**：无程序自动调用、无批量、无新增重试（需求「LLM 调用口径」）。管线内建兜底与草稿台的关系见 §10 决策 1（保留，不新增重试层）。
- **零配置改动**：本次温度 / topK / 保底 / 预算覆盖仅请求内生效，禁止写任何配置文件 / 环境变量 / 生产默认路径；验收 4「git 检查确认线上配置零改动」由本条保证。
- CLI 与页面共用同一组 HTTP 接口（需求「与 CLI 同一后端接口」）；CLI 不得另开一套编排实现，差分展示口径也以服务端为准（§4.4 单一实现点）。

## 2. 现实锚点（写契约前核对的生产事实，随代码演进更新）

| 事实 | 值 / 出处 |
|---|---|
| `/api/chat` 请求体白名单 | `message`、`domain`（`src/server.ts` `CHAT_ALLOWED_KEYS`），多余键 400；`message` 必填非空 ≤300 字（400 / 413）；`domain` ∈ {`fengyunsanguo`, `sango-novel`} |
| `/api/chat` 响应 | `data = { answer, citations }`；`citations[] = { text, chapter?, title? }`，无引用恒 `[]`；错误 500「处理请求失败，请稍后重试」/ 503「工具服务暂不可用，请稍后重试」（503 仅 `ToolExecutionError`） |
| 生成温度 | 生成轮缺省 `temperature ?? 0.7`（`src/agent.ts` `callOnce`）；分类轮 `disableThinking` 同缺省 0.7；引用复核轮固定 `temperature: 0`（管线内建，非可覆盖项） |
| 注入常量 | `INJECT_FRAGMENT_LIMIT = 10`、`INJECT_HEAD_GUARANTEE = 5`、`INJECT_TOTAL_BUDGET = 2000`（字）、`INJECT_TAIL_FALLBACK_ENABLED = true`（`src/citation.ts`） |
| 检索 | 生产快路径调 `sango_novel_search`（`source: 'sanguo-yanyi'`, `limit: 10`；sango 侧 `MAX_LIMIT = 20`），50 路向量候选 + BM25 + 标签合并；出参条目 `{ id, text, chapter, title, type, segFrom, segTo, quoteBalanced, quotes[] }`，`quotes[] = { offset, len }` 瘦身（bug-00010） |
| 检索诊断落库 | 工具出参 `_meta.diagnostics`（sango 产出）→ orchestrator 回填 `candidates[].injected / cited`、`funnel.injected / cited` → 落 `tool_retrieval_logs.diagnostics`（键 `trace_id, seq, diagnostics, created_at`）；`tools/call` 在 trace 上下文内才产出诊断 |
| `tool_retrieval_logs.diagnostics` | `{ truncated, truncatedCount, query{raw,normalized,rewrites?,tokens}, env{...}, funnel{corpusChunks,lexicalHits,vectorTop50,labelHits,mergedCandidates,topN,injected,cited}, timing{bm25,vector,label,merge}, candidates[], nextRank, deathIntent }`；`candidates[]` ≤20 条，含 `chunkId / rank / chapter / title / bm25 / cosine / labelHit / hitLabels? / finalScore / sources / injected / cited`；**不放 chunk 原文与段位**（64KB 预算，只放结构化小数据） |
| 主表 `request_logs` | `log_type('chat'/'quiz')`、`user_input`、`domain`、`status`、`response_code`、`error_message`、t1–t6 时间戳、`answer`、`citations`、`route_source`（label/keyword/vector/classify/free）、`created_at`；保留期 30 天（`DEFAULT_RETENTION_DAYS = 30`，轮转 / 清库会删除旧行） |
| `llm_call_logs` | 含 `stage('classify'/'generation'/'novel_boundary_check'...)`、`temperature`（每次调用实测实参，feat-A013 起落库）、`attempt(1/2)`；`temperature` 是「该请求线上实际温度」的唯一可读凭证 |
| 缓存（feat-A013） | sango-novel 域 `processQueryData` 在检索预调前查语义缓存、收尾写缓存（`cache_logs` / `cache_entries`）；命中即 0 次 LLM 返回缓存答案（无生成轮、无 `llm_call_logs` 行） |
| 引用校验 / 结构保险丝 | 生成后走 `applyNovelCitationGuard`（别名表断言硬校验 0 LLM + 指针合法性 + 句-片段重叠结构门 + 低重叠句边界语义复核至多 1 次 + 兜底结论轮 0–1 次 LLM）；`citations` 文本逐字还原自注入片段（服务端渲染），**引用 → 片段归属精确可知** |
| mcp-web 既有 | `apiClient` 基址 `/api`（vite 代理 → `http://localhost:3000`）；`fetchLogList / fetchLogDetail / fetchSangoChapter`；`LogsView` 有「日志列表 / Token 统计」双 tab + 行内详情面板（答案 / 引用 / LLM 调用表 / 工具明细 `RetrievalDiagnosticsPanel` 输入 `diagnostics: RetrievalDiagnostics`）；`SangoChapterReader`（chapter 必填 + chunkId 选填定位） |
| 启动 | orchestrator `npm run dev`（构建 → `node build/index.js`，`PORT` 缺省 3000，`WEB_ORIGIN` 缺省 `http://localhost:8001`） |

## 3. 接口

Base：mcp-orchestrator 根（与 `/api/v1/logs*` 同级）。

| 方法 | 路径 | 用途 | 数据源 |
|---|---|---|---|
| GET | `/api/v1/draftbench/trace/:traceId` | 拉取该请求候选 / 注入 chunks + 线上实际参数（弹框左栏只读源 + 默认带出） | `request_logs` + `tool_retrieval_logs` + `llm_call_logs` |
| POST | `/api/chat`（扩展，§3.2） | 草稿台手动发送（来源标记 + 请求级覆盖 + 清单） | 生产生成 / 校验管线同源 |
| GET | `/api/v1/draftbench/records` | 草稿台记录列表（仅草稿台，时间倒序） | 草稿台发送记录（§4.3 新落库） |
| GET | `/api/v1/draftbench/records/:traceId` | 记录详情 = 载入（清单 + 本次参数）+ 差异三态 + 结果，供继续编辑 | 同上 |
| GET | `/api/v1/logs`（改造） | 新增 `source` 筛选，**缺省仅生产** | `request_logs` |
| GET | `/api/v1/logs/:traceId`（改造） | 详情 `log` 新增 `source` 字段 | `request_logs` |

### 3.1 GET `/api/v1/draftbench/trace/:traceId` —— 左栏只读源 + 线上实际参数

- path 参数 `traceId`：必填，UUID 正则；格式非法 → `400 { code:400, message:'traceId 格式非法' }`。
- 主表无该行 → `404 { code:404, message:'未找到该 traceId 的日志记录（可能已按保留期轮转或清库），无法拉取注入数据' }`（需求验收 4「traceId 拉不到 → 明确错误提示」；不做归档兜底，需求风险节口径）。
- 有行但不是 sango-novel 域原文请求（`log_type !== 'chat'` / `domain !== 'sango-novel'` / 无 `tool_retrieval_logs` 行）→ `404 { code:404, message:'该请求未发生三国演义原文检索（非 sango-novel 域或检索未产出诊断），无法拉取注入数据' }`（同 404 资源不可得语义，message 区分原因；前端按 message 提示，不做额外分支逻辑）。
- 成功 `200 data`：

```jsonc
{
  "traceId": "uuid",
  "userQuery": "string",                // 该请求主表 user_input（弹框 query 编辑的默认值）
  "routeSource": "label|keyword|vector|classify|free|null",  // 展示用
  "serverReceivedAt": 1234567890123,    // 毫秒
  "params": {                           // 弹框本次参数默认值，打开即带出（验收 1 / 验收 4「默认带出线上值」）
    "temperature": 0.7,                 // 该请求生成轮实测（llm_call_logs stage='generation'，按 attempt 取最后一条成功值的 temperature）；
                                        // 无生成轮（缓存命中 / 失败 / 运维）→ 生产缺省 0.7
    "topK": 10,                         // 注入条数上限 = INJECT_FRAGMENT_LIMIT（当前生产常量，非按请求记录）
    "guarantee": 5,                     // 保底段数 = INJECT_HEAD_GUARANTEE
    "budget": 2000,                     // 注入总预算（字）= INJECT_TOTAL_BUDGET
    "tailFallback": true                // 尾部兜底开关 = INJECT_TAIL_FALLBACK_ENABLED（只读展示，不可覆盖）
  },
  "chunks": {
    "candidates": [                     // 该请求召回候选全量（≤20，按 rank 升序 = 工具返回序）；含未注入候选（只读源全展示）
      {
        "chunkId": "sanguo-yanyi:0085:c0011",
        "rank": 1,
        "chapter": 85,
        "title": "刘先主遗诏托孤儿 诸葛亮安居平五路",
        "segFrom": 3,                   // 段位（服务端按 chunkId 经 sango_novel_chapter 合成，§10 决策 2）
        "segTo": 4,
        "preview": "string",            // 原文预览（≤120 字，§10 决策 2）
        "injected": true,               // 是否进注入视图（orchestrator 回填后的值；历史无回填行按 false 处理）
        "cited": false,
        "sources": ["lexical", "vector"],
        "finalScore": 12.34
      }
    ],
    "injectedCount": 6,                 // funnel.injected 回填值；无回填为 0
    "citedCount": 1
  }
}
```

- 边界：检索无命中（`NO_HIT_TEXT` 兜底条目）时 `candidates: []`、`injectedCount: 0`，弹框左栏空态提示，仍可手增片段后发送。

### 3.2 POST `/api/chat`（扩展）—— 草稿台手动发送

生产请求（不带 `source` 或 `source='production'`）行为与现契约**逐字节不变**（白名单 / 400 / 413 / 500 / 503 / 队列全部沿用）。

请求体扩展（白名单扩为 `message / domain / source / chunks / params`，`CHAT_ALLOWED_LABEL` 同步）：

| 字段 | 类型 | 必填 | 默认 | 校验收敛 |
|---|---|---|---|---|
| `source` | string | 否 | `'production'` | ∈ {`'production'`, `'draftbench'`}；非法 → 400 `'source 只支持 production/draftbench'` |
| `message` | string | 是 | — | 非空、≤300（400 / 413，同生产） |
| `domain` | string | draftbench 必填 | production 缺省可省 | draftbench 时仅 `'sango-novel'`，否则 400 `'domain 字段仅支持 sango-novel（草稿台发送锁定原著域）'` |
| `chunks` | array | draftbench 必填 | — | 1..20 条；每项 `{ chunkId?: string; text: string; chapter?: number; title?: string }`；`text` 非空且 ≤2000 字；非法 → 400（明细见 §4.1）；空数组 → 400 `'发送清单不能为空'`（验收 4）。仅 `source='draftbench'` 合法，否则 400 |
| `params` | object | 否 | 缺省 = 生产常量（§3.1 `params` 同口径） | `{ temperature?: number ∈ [0,1]; topK?: integer 1..20; guarantee?: integer 0..topK; budget?: integer ≥1 }`；非法 → 400 明细。仅 `source='draftbench'` 合法，否则 400 |

- 服务端分发：`source='draftbench'` 时走草稿台管线——**不检索**（不经 `sango_novel_search`）、**不查缓存、不写缓存**（内存判定与 cache_logs 均跳过；理由：同 query 命中生产缓存会返回缓存答案，使注入实验失真；草稿台结果也不得污染生产缓存条目），其余复用生产 sango-novel 域生成 / 校验管线同源实现：`buildInjectionView(清单, query)`（服务端重编号 `[片段N]` / `⟨Qn⟩`、引语还原）→ 生成轮 LLM（`temperature` 覆盖生效；有注入即 `disableThinking`，同生产口径）→ `applyNovelCitationGuard`（引用校验 / 结构保险丝）→ 渲染 `answer + citations`。清单空文本片段不进注入视图（同生产空条目跳过口径）。
- `params` 与 `chunks` 的对应：`topK` 取代 `INJECT_FRAGMENT_LIMIT` 作截断上限（`chunks.slice(0, topK)`）；`guarantee` 取代保底段数；`budget` 取代总预算；尾段预算丢失整段、不段内裁剪（生产注入策略语义不变）。
- 成功 `200 data`：

```jsonc
{
  "traceId": "uuid",                    // 本次新 traceId（以响应头 X-Trace-Id 为准）
  "answer": "string",
  "citations": [ { "text": "string", "chapter": 85, "title": "string" } ],   // 同生产形状，无引用 []
  "params": { "temperature": 0.7, "topK": 10, "guarantee": 5, "budget": 2000 },  // 本次实际生效值（验收 4「日志/诊断可读证实际用值」的响应侧凭证）
  "diff": { "consistent": [], "missing": [], "extra": [] }                   // §4.4
}
```

- 失败：LLM / 通道异常 → 500 / 503（同生产 message）；校验失败 → 400 明细（§4.1 / §4.2）。失败也落一条草稿台记录（`status='failed'` + `errorMessage`）。
- 落库（实现侧，小胡）：发送请求经既有 `tracingMiddleware` 落 `request_logs` 主表（新增来源列，§4.3）；草稿台清单 + 本次参数快照 + 结果摘要落新记录（§4.3）。两份落库均旁路静默、不得影响响应（同现有旁路原则）。

### 3.3 GET `/api/v1/draftbench/records` —— 草稿台记录列表

- query：`pageNo / pageSize`（同日志列表校验与钳制）。仅返回 `source='draftbench'` 记录，时间（`serverReceivedAt`）倒序；**无来源参数**（本接口天然只含草稿台，验收 7）。
- 成功 `200 data`：

```jsonc
{
  "list": [
    {
      "traceId": "uuid",
      "time": 1234567890123,            // serverReceivedAt（毫秒）
      "query": "string",
      "status": "success|failed",
      "errorMessage": "string",
      "params": { "temperature": 0.7, "topK": 10, "guarantee": 5, "budget": 2000 },  // 本次生效值
      "chunkCount": 6,
      "result": { "answer": "string|null", "citationCount": 1 } | null   // failed 行 null
    }
  ],
  "total": 0, "pageNo": 1, "pageSize": 20
}
```

### 3.4 GET `/api/v1/draftbench/records/:traceId` —— 记录详情（载入 + 差异 + 结果）

- `traceId` 格式非法 → 400；不是草稿台记录（或不存在）→ `404 { code:404, message:'草稿台记录不存在' }`。
- 成功 `200 data`：

```jsonc
{
  "traceId": "uuid",
  "time": 1234567890123,
  "query": "string",                    // 载入后 query 编辑默认
  "status": "success|failed",
  "errorMessage": "string",
  "params": { "temperature": 0.7, "topK": 10, "guarantee": 5, "budget": 2000 },  // 载入后本次参数默认
  "chunks": [ { "chunkId": "string|null", "text": "string", "chapter": 85|null, "title": "string|null" } ],  // 发送清单快照（载入继续编辑）
  "result": { "answer": "string|null", "citations": [ ... ] } | null,
  "diff": { "consistent": [], "missing": [], "extra": [] }           // 服务端按 §4.4 重算（单一实现点）
}
```

### 3.5 日志查询来源筛选（改造既有接口）

- `GET /api/v1/logs` 新增 query 参数 `source`：`'production'`（**缺省**）| `'draftbench'`；缺省即仅生产（验收 7 数据隔离）；非法值 → 400 `'source 只支持 production/draftbench'`。`source` 与 `logType / traceId / domain / keyword` 等既有参数正交可叠加。
- 列表行新增字段 `source: 'production' | 'draftbench'`（来自主表新增来源列，§4.3）。
- `GET /api/v1/logs/:traceId` 详情 `log` 新增 `source` 同口径；草稿台 traceId 详情复用既有分析视图（答案 / 引用 / LLM 调用 / 工具明细 / 缓存判定，`cache` 对草稿台恒 null——草稿台不查缓存）。
- `GET /api/v1/logs/token-stats` 与统计类接口同口径新增 `source` 筛选：缺省仅生产、非法值 400（同 §3.5 文案）；默认仅生产（§10 决策 3）。

## 4. 数据契约（字段级）

### 4.1 发送清单 `chunks[]` 校验

| 规则 | 错误 |
|---|---|
| 非数组 / 空数组 | 400 `'发送清单不能为空'` |
| 条数 > 20 | 400 `'发送清单最多 20 条'` |
| 元素非对象 | 400 `'清单条目格式非法'` |
| `text` 缺失 / 非字符串 / trim 后空 | 400 `'片段文本不能为空'` |
| `text` 长度 > 2000 | 400 `'单条片段不能超过 2000 字'` |
| `chunkId` 存在但非字符串 | 400 `'chunkId 格式非法'` |
| `chapter` / `title` 存在但类型错误（非 number / 非 string） | 400 `'清单条目元数据格式非法'` |

### 4.2 本次参数 `params{}` 校验

| 字段 | 类型 / 值域 | 默认 | 错误 |
|---|---|---|---|
| `temperature` | number ∈ [0, 1] | 拉取带出值（§3.1），缺省 0.7 | 400 `'temperature 需为 0~1 的数字'` |
| `topK` | integer ∈ [1, 20] | 10 | 400 `'topK 需为 1~20 的整数'` |
| `guarantee` | integer ∈ [0, topK] | 5 | 400 `'guarantee 需为 0~topK 的整数'` |
| `budget` | integer ∈ [1, 20000] | 2000 | 400 `'budget 需为 1~20000 的整数'` |

> `budget` 上限 20000 字（§10 决策 4）：防清单超大与 LLM 输入超限。

### 4.3 落库（mcp-orchestrator 存储侧，小胡实现；字段契约在此，表设计细节开放）

- `request_logs` 新增来源标记列（如 `request_source`，NULL=历史行按 production 处理，`'draftbench'` = 草稿台；ALTER 幂等仿 `route_source` 先例）。**不占用 `route_source` 枚举**（那是路由来源，语义不同）。
- 草稿台发送记录新表（或等价格式）：`trace_id` 主键；`time`；`query`；`params`（四值 JSON）；`chunks` 清单快照（逐条 chunkId / text / chapter / title）；`status`；`error_message`；`result`（answer + citations 摘要或完整；完整量 ≤ 响应同源量）。保留期与 `request_logs` 同（随 30 天轮转，§10 决策 5）。
- 落库写入全部旁路静默；失败不回填的历史行在界面按 null / 缺省展示（前端不推断，仿 `attempt` 先例）。

### 4.4 差异三态（一致 / 缺失 / 多余）口径

- **判定在服务端生成管线内完成**（单一实现点，CLI 与页面同源）：引用校验渲染期已知每个引用（`citations`）归属的注入片段（`[片段N]` 编号 / 引语 `⟨Qn⟩` → 片段映射，feat-A006 渲染链路），无需事后文本比对，无跨片段文本歧义。
- `diff.consistent: number[]`：发送清单中被结果引用（citations 归属）的条目序号（1 基，对应 `chunks` 下标 + 1）。
- `diff.missing: number[]`：清单中未被引用的条目序号。
- `diff.extra: Citation[]`：结果引用但不属于清单的引用。**正常恒空**（引用硬校验保证引文逐字来自注入片段；兜底 / 复核片段也取自清单）——非空即异常信号（模型违规引用 / 渲染失配），页面高亮警示、CLI 打 `!` 标注，不作静默吞掉。
- 空结果边界：拒答「演义中未涉及」或 `citations: []` → `consistent: []`、`missing` = 全部序号、`extra: []`。空片段文本（发送 400，防呆）与清单空（发送 400）在发送侧拦截，差异计算不产生空片段条目。

## 5. 页面（mcp-web，小叶；仅输入契约，不含实现）

- 日志页：新增「来源」筛选下拉（默认 `production`，可切 `draftbench`；`fetchLogList` 增传 `source`）+「草稿台」按钮（弹框入口，验收 5「日志页按钮 → 弹框入口」）。
- 弹框操作流（≤5 步）：输入 traceId → `GET /api/v1/draftbench/trace/:traceId` 拉取（左栏只读源，展示回目 / 段位 / 原文预览 / 注入标记）→ 构造右栏发送清单（左拖右添加 / 右内拖拽排序 / 右侧手增与移除）→ 发送确认弹框（query 可编辑、片段数、总字数、本次参数一次过目，默认值 = `params` 带出值）→ `POST /api/chat` 发送 → **发送成功弹框就此结束**：不做结果内联展示、不做差异对比视图；可轻提示「已发送，可在日志页 来源=草稿台 查看」；发送后本次记录与正常日志完全一致，在日志页按正常日志查看（2026-09-27 需求修订口径）。
- 无需用户拼接 chunkId：chunkId 由清单携带（验收 5）。原文核对复用既有 `SangoChapterReader`（`chapter` 必填 + `chunkId` 定位，feat-A010 契约）；左栏 `preview / segFrom / segTo` 由接口携带（§10 决策 2），弹框内直接可读，点条目跳 `SangoChapterReader` 看整回。
- 记录与复现：弹框内 `GET /api/v1/draftbench/records` 列表（时间 / traceId / query / 本次参数 / 片段数 / 结果）；点击行 → `GET /api/v1/draftbench/records/:traceId` 载入（回填编辑框继续编辑，结果可回读）；「查看记录」跳日志页（来源=草稿台）详情，复用既有日志页分析视图（`fetchLogDetail` + `RetrievalDiagnosticsPanel`；草稿台行 `cache` 恒 null 时卡片不渲染，已有空态）。页面不消费 `diff` 字段（2026-09-27 需求修订：不做结果对比视图；`diff` 保留供 CLI / 审核）。
- 前端新增 `client.ts` 类型与函数（`fetchDraftbenchTrace / fetchDraftbenchRecords / fetchDraftbenchRecordDetail` + `DraftbenchTrace / DraftbenchRecord / DraftbenchDiff` 等，字段逐字对齐 §3）；发送复用 `sendChatMessage` 通道扩展 payload（`source / chunks / params`）。
- 无新增 vite 代理（草稿台接口走既有 `/api` → `http://localhost:3000`）。CLI 不归页面。

## 6. CLI（小胡）

- 同一组 HTTP 接口为唯一后端契约：`trace` 拉取 → 清单本地编辑（增删 / 排序 / 插片段，文件中转）→ `POST /api/chat`（`source='draftbench'`）→ 输出注入清单（片段序号 + 回目 + 原文预览）、`answer`、`citations`、本次生效参数、差异符号表（一致 `=` / 缺失 `-` / 多余 `!`，符号自定但语义对齐 §4.4）。
- 单次命令 = 单次 `POST /api/chat`；无循环 / 批量 / 自动重试（需求红线口径）。结果为 failed 时输出服务端 `message` 并给出记录 traceId。

## 7. 验收映射（需求 7 条 → 契约）

- 验收 1（CLI）→ §3.1 拉取 + §3.2 发送 + §6 输出项（含默认带出与生效参数可读）。
- 验收 2（页面版）→ §3 + §5 全流程；真浏览器实测按 AGENTS.md 第 11 条执行。
- 验收 3（差异三态）→ §4.4 服务端 diff + §5 三态高亮 / §6 符号表。
- 验收 4（本次参数请求级）→ §3.2 `params` 覆盖仅本次生效、§1 零配置改动、`llm_call_logs.temperature` + 响应 `params` 双凭证、§3.4 记录可回读。
- 验收 5（便利性）→ §3.1 打开即带出默认值 + §5 拖拽 / 手增 / 排序 / ≤5 步（交互实现属小叶，真浏览器实测验收）。
- 验收 6（记录与筛选）→ §3.3 / §3.4 记录接口（时间 / traceId / query / 参数 / 片段数 / 结果）+ §3.5 来源筛选 + §5 载入继续编辑。
- 验收 7（数据隔离）→ §3.5 默认仅生产 + §3.3 弹框列表只含草稿台 + 详情 `cache` 口径；真浏览器实测。

## 8. 联调运行

```powershell
# orchestrator（需 .env 含 API_KEY / API_BASE_URL / LLM_MODEL 与 MCP_SANGO_SCRIPT）
cd D:\workplace\mcp-orchestrator
npm run dev   # 构建 + node build/index.js，监听 http://localhost:3000

# web
cd D:\workplace\mcp-web
npm run dev   # vite，日志页 / 草稿台弹框，/api 代理到 3000
```

- 手工验证路径：复制一条 sango-novel 域 traceId（日志页详情取）→ 弹框拉取 → 对照左栏与「该请求注入」一致 → 发送 → 三态高亮 → 日志页切「草稿台」筛选可见该记录 → 点击载入复现。
- 拉取不到（轮转 / 清库）与空清单发送的报错路径按 §3.1 / §3.2 文案核对。

## 9. 冲突与风险

- **A016 在途（本契约以 origin/main 为锚，不合并口径）**：orchestrator `hu/feat-A016_term-normalization`（当前分支）改 `agent.ts / cache.ts / citation.ts`——查询归一化移交 `sango_query_embed`，**未改 `/api/chat` 请求字段、未改日志表结构**；web `ye/feat-A016_normalization-observability` 仅给 `RetrievalDiagnostics` 增可选字段（`query.rewrites?`、`env.normVersion?`）。A017 依赖的 `candidates / funnel / llm_call_logs.temperature / request_logs` 结构不受影响；A016 合入后 §2 锚点 `query.normalized` 等语义以 A016 接口文档为准，A017 不引用归一化语义。若 A016 后续改动了上述结构，本契约对应字段需 Coco 复核。
- 需求以「复用生产 `/api/chat`」为发送口径；若 Coco 判断为保生产端点零改动、改独立发送端点，属契约变更，需回退本文 §3.2（本文按需求原文成稿，已把「生产请求逐字节不变」写入契约）。
- **缓存绕过**（§3.2）：草稿台不查 / 不写语义缓存是本契约硬规则——命中生产缓存会返回缓存答案、注入实验失真；草稿台结果也不得污染生产缓存。Coco 2026-09-27 定：保留硬规则。
- traceId 依赖日志留存：30 天保留期轮转 / 清库后拉取 404（§3.1），不另做归档（需求风险节口径）。
- 草稿台生成有 LLM 成本：全手动触发，预算天然有界（手动点击次数）；任何批量实验另行报备（AGENTS.md Token 控制第 4 条）。

## 10. 契约决策（Coco 定答，2026-09-27，决策即契约）

1. **保留管线内建兜底，草稿台不新增重试层**：`attempt=2` 空答案变参重试、引用复核轮（至多 1 次）、兜底结论轮（0–1 次）是生产生成管线的既有语义，草稿台复用同一管线必须一并保留，「结论可外推」才成立；「单次点击 = 1 次生成、无重试设计」指草稿台不新增循环 / 批量 / 自动重发，成本仍以手动点击次数为界。
2. **原文预览与段位 = 方案 A（服务端合成）**：`GET /api/v1/draftbench/trace/:traceId` 由 orchestrator 经既有 `sango_novel_chapter` 通道按 chunkId 取原文合成 `preview / segFrom / segTo`（多回合并多次通道调用属实现细节）；`preview ≤ 120 字`。理由：契约自包含、页面零拼装、左栏直读不打断便利性（验收 5）；不新增 sango 批量工具（§11 边界保持）；页面点条目仍复用 `SangoChapterReader` 看整回原文。
3. **统计类接口同口径来源筛选**：`/api/v1/logs/token-stats` 与其余统计接口均新增 `source` 参数，缺省仅生产、非法值 400（文案同 §3.5）；默认仅生产（验收 7 数据隔离覆盖全部展示面）。
4. **`budget` 设上限 20000 字**：值域 [1, 20000]、超限 400（§4.2）；与生产默认 2000 留 10 倍实验空间，防误操作超大注入撑爆 LLM 输入。
5. **草稿台记录随 30 天保留轮转，不独立延长**：与 `request_logs` 同表周期（`logs.db` 轮转）；traceId 即用例的沉淀靠复现路径（载入继续编辑），长期留档需要时另立课题，不入本特性（需求风险节口径：轮转后拉不到即提示用户）。

## 11. 边界（不做）

- 不改生产注入选择逻辑、不做线上温度配置生产化（需求非目标 D10）；不做生成模型切换。
- 不做程序自动 / 批量 LLM 调用；不做失败模式回归集管理（traceId 即用例天然沉淀）。
- 不改 `sango` 检索 / 切片 / 评分工具本身；不新增 sango 侧接口（§10 决策 2：仅 orchestrator 侧组合既有通道）。
- 不动 `route_source` 枚举与既有日志字段语义；历史行（无来源列）一律按 production 展示。
