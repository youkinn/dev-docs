# 问题排查手册（traceId 定位法）

> 用途：负责人给出 traceId 后，按本手册读日志、归因、给结论。
> **维护责任人：Coco** —— 本手册的准确性由 Coco 负责；它不是一次性文档，随架构与日志契约演进而持续完善。
> 依据：已定稿需求文档（`requirements/`）+ 代码实现；**只写已实测 / 已确认的口径**，不确定的内容一律放 `docs/troubleshooting-notes.md`。
> 更新触发（出现即改，不等提醒，见 `AGENTS.md` 第 8 条）：日志字段 / `log_type` / 工具 / 入口埋点 / 路由层 / 诊断结构 / 链路阶段有增删改；新增或退役服务与端口。
> 更新纪律：**改前先用真实数据实测取证**（不凭代码推理）；每次改动记入文末「维护记录」。

---

## 1. 手册怎么用

### 1.1 我需要什么输入

| 输入 | 必填 | 说明 |
|------|------|------|
| `traceId` | 是 | UUID v4。没有 → 按「命令速查」的「C. 反查」找回；仍没有 → 请负责人复现一次（浏览器 Network → 响应头 `X-Trace-Id`） |
| 现象描述 | 是 | 一句话：答非所问 / 没引用 / 太慢 / 报错 500 / 结果为空 |
| 期望结果 | 否 | 用于区分「答错」与「答对但不符合预期」 |
| 复现步骤 | UI 类必填 | 第 11 条：UI / 交互问题必须真浏览器复现，不接受只凭代码推理 |

### 1.2 我要产出什么

一段结论，四要素齐全：

1. **现象归类**：哪条链路（对话 / 答题）、哪一层（前端 / 总台 / 编排 / MCP / 语料）
2. **根因判断**：已知 bug 号，或「新问题，需报 bug-XXXXX」，或「读数正常，非缺陷」
3. **证据读数**：关键字段与数值（如 `funnel.injected=5 < topN=10`）
4. **后续动作**：谁做什么（报票 / 复现 / 无需处理）

结论同时登记到 `docs/troubleshooting-notes.md` 的「已排查 trace 索引」（避免重复排查、上下文压缩后结论不丢）。

---

## 2. 环境、入口与证据源

| 项 | 值 |
|----|-----|
| 总台 API | `http://localhost:3000`（探活 `GET /health`） |
| 日志页 | `http://localhost:8001/logs`（无鉴权，内网口径） |
| 日志库 | `D:\workplace\mcp-orchestrator\data\logs.db`（better-sqlite3，保留 30 天，`LOG_RETENTION_DAYS`） |
| 明细接口 | `GET /api/v1/logs/{traceId}` |

排查前先探活：

```powershell
Invoke-WebRequest http://localhost:3000/health -UseBasicParsing
```

- 总台不在线 → 日志页也读不到；请负责人先起总台（`mcp-orchestrator`：`npm run dev`）
- 明细 404（`日志不存在`）→ 三种可能：超保留期 / 该入口未埋点（见「未埋点入口」）/ traceId 抄错

### 2.1 证据源地图（日志只是其中之一）

| 证据源 | 能看到什么 | 取法 |
|--------|-----------|------|
| 日志库 / 日志接口 | 链路时间点、LLM 明细、工具明细、检索诊断 | 「排查流程」步骤 1–6 |
| 日志页 | 人眼浏览、行展开明细、Token 图表、复制 traceId | `http://localhost:8001/logs` |
| 总台进程 stdout | 埋点旁路失败、MCP 连接告警、未捕获异常（`Failed to process request:`）、启动 / 退出 | 运行总台的终端窗口 —— **不落盘，重启即丢** |
| 浏览器 DevTools | 前端异常、请求 / 响应原文、真实 UI 表现 | Network / Console（UI 类问题必用，第 11 条） |
| 直连 DB | 接口未暴露的字段、原始行、跨表 join | 「命令速查」的「D. 直连日志库」 |
| `llmCalls.requestSummary / responseSummary` | 生成轮完整入参（**含注入片段全文**）与模型**原始输出**（含 `[Qn]` / `[片段N]` 指针） | 步骤 1 命令取 `llmCalls`；值为 JSON 字符串（`[{type,text}]`）。判「自律拒答 vs 护栏误裁」必须看这里（2026-09-26 实录） |

日志系统**看不到**的：前端异常、思考文本、错误栈、代码 / 语料版本、`sessionId`（注入片段全文与模型原始输出可经 `requestSummary` / `responseSummary` 查——旧口径「注入文本不可见」作废）。缺证据时的登记与补数建议见 `docs/troubleshooting-notes.md`。

---

## 3. 链路与埋点覆盖面

### 3.1 全链路时间轴

```text
前端发起 t0 ──上行──> 总台收到 t1 ──串行队列等待──> 出队处理 t2
  ──> [分类轮 LLM] ──> [工具调用：L3 预检 / 域快路径预调 / 分类轮预调]
  ──> [生成轮 LLM] ──> 总台返回 t5 ──下行──> 前端收到 t6（前端补报）
```

### 3.2 埋点覆盖面

| 入口 | `log_type` | `domain` | LLM 明细 | 工具明细 | 检索诊断 |
|------|-----------|----------|----------|----------|----------|
| `POST /api/chat`（对话） | `chat` | 请求体 domain，缺省为 null（auto 路由） | 有 | 有 | 仅 `sango_novel_search` 有 |
| `POST /api/sango/random`（随机一题） | `quiz` | 固定 `fengyunsanguo` | 无（不经 LLM） | 有 | 无 |

### 3.3 未埋点入口（查不到日志属正常）

- `GET /api/tools`（工具列表）
- `GET /api/v1/logs*`（排查接口自身不落日志，防递归）
- `GET /api/sango/chapters/:chapter`（原文阅读器，feat-A010）
- 流式输出（未立项）

### 3.4 定层 → 定人（结论怎么指派）

| 层 | 证据落点 | 负责人 |
|----|----------|--------|
| 前端 | t0 / t6、`durations.frontend`、浏览器 DevTools | 小叶 |
| 总台 / Transport / 存储 | 主表 `status` / `responseCode`、`queueWait`、工具明细、HTTP 路由 | 老陈 |
| Agent 编排 / 路由 / 提示词 | LLM 明细 `stage` / `finishReason`、`domain`、stage 序列 | 小胡 |
| MCP / 语料 / 检索算法 | 工具出参、`funnel` / `candidates` / `env` | 老陈 |
| 需求符合度 / 端到端 | 需求文档验收项 | 负责人 |

---

## 4. 排查流程

### 步骤 0 · 分级取数（省上下文，按需下钻）

| 级别 | 取什么 | 什么时候用 |
|------|--------|-----------|
| L1 概览 | 步骤 1 的一条命令 | 每次都先做，多半已能定性 |
| L2 深挖 | 步骤 6 诊断全文、入参 / 出参 JSON | 只有 L1 指向「召回 / 引用 / 排序」时才拉 |
| L3 线下 | 直连 DB、线下重放、真浏览器 | L2 仍不足，或日志本身缺证据（`docs/troubleshooting-notes.md`） |

不要一上来就把 8000 字符出参、20 条候选全文拉进上下文。

### 步骤 1 · 取全链路概览

```powershell
$t='<traceId>'
$d=((Invoke-WebRequest "http://localhost:3000/api/v1/logs/$t" -UseBasicParsing).Content|ConvertFrom-Json).data
$l=$d.log
"type=$($l.logType) domain=$($l.domain) status=$($l.status) code=$($l.responseCode) err=$($l.errorMessage)"
"t1=$($l.serverReceivedAt) t2=$($l.handleStartedAt) t5=$($l.serverRespondedAt) t6=$($l.clientReceivedAt)"
"queueWait=$(if($l.handleStartedAt){$l.handleStartedAt-$l.serverReceivedAt}) server=$(if($l.serverRespondedAt){$l.serverRespondedAt-$l.serverReceivedAt})"
$d.llmCalls|%{"llm#$($_.seq) $($_.stage) $($_.model) $($_.status) finish=$($_.finishReason) in=$($_.promptTokens) out=$($_.completionTokens) cached=$($_.cachedTokens) ms=$($_.responseAt-$_.requestAt) err=$($_.errorMessage)"}
$d.toolCalls|%{"tool#$($_.seq) $($_.mcpServer)/$($_.toolName) caller=$($_.caller) stage=$($_.stage) $($_.status) ms=$($_.callReturnedAt-$_.callSentAt) diag=$(if($_.diagnostics){'Y'}else{'N'}) err=$($_.errorMessage)"}
```

实测输出（正常样本 `f21dd6be-...`，演义快路径）：

```text
type=chat domain=sango-novel status=success code=200 err=
t1=1790076757789 t2=1790076757789 t5=1790076759549 t6=1790076759551
queueWait=0 server=1760
llm#1 generation deepseek-v4-1-flash-260901 success finish=stop in=1841 out=110 cached=1792 ms=1696 err=
tool#1 sango/sango_novel_search caller=server stage=fastpath success ms=63 diag=Y err=
```

### 步骤 2 · 判失败面（`status` / `responseCode` / `errorMessage`）

| 读数 | 含义 | 下一步 |
|------|------|--------|
| `failed` + `400` | 请求体校验失败：`message` 空 / 字段越界 / `domain` 非法 | 读 `errorMessage` 原文；属前端传参或调用方问题 |
| `failed` + `413` | `message` 超 300 字符 | 前端未做长度校验 |
| `failed` + `500` + `请求中断未完成回填` | 骨架未回填：进程崩溃 / 重启，非业务错误 | 核对总台是否重启过 |
| `failed` + `500`（其它） | 编排 / LLM 异常 | 看 LLM 失败行的 `errorMessage` |
| `failed` + `503` | **只由 `ToolExecutionError` 触发**：MCP 工具执行失败（server 未配置 / 子进程报错） | 看工具明细 `status=failed` 的 `errorMessage` |
| `success` + `200` 但答案不对 | 业务质量问题 | 走步骤 3 / 6 / 7 |

### 步骤 3 · 耗时归因（`durations`）

| 字段 | 公式 |
|------|------|
| `frontend` | `(t1 − t0) + (t6 − t5)`，上行 + 下行 |
| `queueWait` | `t2 − t1`（校验失败未入队为 null） |
| `server` | `t5 − t1`（**含** `queueWait`） |
| `llm` | `Σ(responseAt − requestAt)` |
| `tool` | `Σ(callReturnedAt − callSentAt)` |
| `total` | `t6 − t0` |

归因规则：

- **`queueWait` 显著** → 串行队列被前一请求占住（`/api/chat` 与 `/api/sango/random` **共用同一队列**）；并发下第二条必然等待
- **`llm` 占大头** → 模型侧；配合 `cachedTokens` 判断是否缓存未命中
- **`tool` 占大头** → MCP 子进程（演义检索 / 题库状态机）
- **`frontend` 大而 `server` 小** → 网络或前端渲染
- **余量 `server − queueWait − llm − tool`** → 总台自身（拼接 / 组装 / 序列化），明显偏大才可疑

### 步骤 4 · 判 LLM 明细

| 字段 | 判读 |
|------|------|
| `stage` | `classify` = auto 路由的无 tools 轻量分类轮；`generation` = 生成轮；`fallback` = 引用校验兜底结论归纳轮 |
| `stage` = `novel_boundary_check` | 演义域句-片段重叠门边界语义复核（bug-00032/33/34 起）：仅「重叠 < 0.5 待裁叙述句」触发，`responseSummary` 即 supported / unsupported 判定；正常样本不出现该 stage |
| `seq` | 同 `stage` 多条 = **重试**（当前实现为「空答案变参重试」）；不同 `stage` = 正常多轮 |
| `finishReason` | `stop` 正常；`length` = 被 `max_tokens` 截断（思考 token 吃满即空答案）；`tool_calls` = 模型要求调工具（A011 后生成轮已无 tool-use 循环，出现即异常） |
| `cachedTokens` | 接近 `promptTokens` = 提示词缓存命中；骤降 = 缓存失效（提示词改动） |
| `promptTokens` 异常膨胀 | 提示词体积问题（A011 提示词瘦身口径） |
| `status=failed` | 读 `errorMessage`，编排侧抛错原文 |
| 无 LLM 明细 | `quiz` 正常（不经 LLM）；`chat` 缺失 = 埋点旁路丢失 |

### 步骤 5 · 判工具明细

| 字段 | 判读 |
|------|------|
| `caller` | `model` = 模型自主调用；`server` = 服务端发起（预检 / 预调 / 后台直调） |
| `stage` | `l3` = L3 题库高置信识别预检；`fastpath` = 域内快路径预调；`classify` = 分类轮判定后预调；`generation` = 生成轮模型调用；`admin` = 后台直调（`/api/sango/random`） |
| `mcpServer` / `toolName` | 见下方工具对照表 |
| `status=failed` | `errorMessage` 为工具错误原文；对应主表 503 |
| `callReturnedAt=null` | 未返回（超时 / 中断） |
| 入参 / 出参 | 点「入参」「出参」看 JSON（均 8000 截断）；出参**不含**诊断（诊断单独落库） |

工具对照表：

| 工具 | 能力 |
|------|------|
| `sango/sango_novel_search` | 演义原著检索（唯一带检索诊断） |
| `fengyunsanguo/fengyunsanguo_query` | 题库候选召回 |
| `fengyunsanguo/fengyunsanguo_quiz_command` | 随机一题状态机（出题 / 判题 / 查答案） |
| `fengyunsanguo/fengyunsanguo_quiz_route` | L3 题库高置信识别（返回 true/false） |

> 注意：工具明细 `stage` 与 LLM 明细 `stage` **同名不同义**。前者指「哪个阶段发起这次工具调用」，后者指「本次 LLM 调用属于哪个阶段」。日志页展示为「分类轮预调 / 生成轮调用 / 后台直调」。

### 步骤 6 · 判检索诊断（仅 `sango_novel_search`）

```powershell
$t='<traceId>'
$d=((Invoke-WebRequest "http://localhost:3000/api/v1/logs/$t" -UseBasicParsing).Content|ConvertFrom-Json).data
$g=$d.toolCalls[0].diagnostics
"env: scheme=$($g.env.vectorScheme) degraded=$($g.env.degradedBm25Only) chunks=$($g.env.corpusChunks)"
"funnel: corpus=$($g.funnel.corpusChunks) lexical=$($g.funnel.lexicalHits) vector=$($g.funnel.vectorTop50) label=$($g.funnel.labelHits) merged=$($g.funnel.mergedCandidates) topN=$($g.funnel.topN) injected=$($g.funnel.injected) cited=$($g.funnel.cited)"
"query: raw=$($g.query.raw) | normalized=$($g.query.normalized)"
$g.candidates|%{"  #$($_.rank) $($_.chunkId) ch$($_.chapter) final=$($_.finalScore) bm25n=$($_.bm25Norm) cos=$($_.cosine) label=$($_.labelHit) src=$($_.sources -join '+') inj=$($_.injected) cited=$($_.cited)"}
"nextRank: $(if($g.nextRank){"#$($g.nextRank.rank) $($g.nextRank.chunkId) final=$($g.nextRank.finalScore) gap=$($g.nextRank.gapToTopN)"}else{'null'})"
```

判读：

| 读数 | 含义 |
|------|------|
| `env.degradedBm25Only=true`（`vectorScheme` / `vectorDim` 为 null） | 向量路挂掉，**静默降级纯 BM25** → 召回质量下降的常见环境根因 |
| `lexicalHits=0` 且 `vectorTop50=0` | 候选为空：分词 / 归一化 / 语料问题 |
| `mergedCandidates` 大但 `topN` 小 | 排序问题，看 `candidates` 分数分布 |
| `injected < topN` | 注入视图截断（快路径口径：top5 整段保底 + 第 6–10 段预算兜底） |
| `cited < injected` | 召回了但模型没引用（提示词 / 指针通道） |
| `candidates[].sources` | 被哪一路召回：`lexical` / `vector` / `label` |
| `candidates[].hitLabels` | 命中的标签原文（仅展示，不参与计分） |
| `nextRank.gapToTopN` 极小（< 0.001） | 第 N+1 名与末位几乎同分，排序脆弱（阈值 / 分差问题） |
| `deathIntent.detected` / `pinned` | 死亡意图是否生效 / 是否置顶 |
| `truncated=true` + `truncatedCount` | 诊断超 64 KB 预算被截断 |
| `diagnostics=null` | 非检索工具（正常）/ 诊断落库旁路丢失 |

分数复算：`finalScore = 0.3 × bm25Norm + 0.6 × (cosine+1)/2 + 0.1 × labelHit`，三项均在 `[0,1]`，`null` 项按 0 计。

### 步骤 7 · 核对路由

| `domain` 读数 | 实际走法 |
|---------------|----------|
| `sango-novel` | 演义域：域内快路径预调（`stage=fastpath`）+ 生成轮 |
| `fengyunsanguo` | 题库域：`fengyunsanguo_query` 召回（`stage=fastpath` 或 `classify`）+ 生成轮 |
| `weather` | **仅历史数据**（A011 天气下线，新请求直接 400） |
| `null`（日志页显 `—`） | auto 路由：看工具明细 `stage` 反推 —— `l3` 命中题库 / `classify` 判定（1 = 演义、2 = 题库）/ 无工具 = 直接生成 |

`domain` 与用户实际意图不符 → 路由层问题（L1 标签 → L2 关键词 → L3 题库识别 → 分类轮）。

### 步骤 8 · 对照（单条 trace 不足以定性时）

| 手法 | 做法 | 用途 |
|------|------|------|
| 同问句多次对比 | 「命令速查」的「C. 反查」按 `keyword` 拉同问句列表 → 逐条取概览 | 判断「偶发」还是「稳定复现」 |
| 成功 vs 失败对照 | 同问句一条 `success` 一条 `failed` 对比读数 | 隔离变量（缓存 / 排队 / 模型波动） |
| 同域看分布 | 列表按 `domain` 过滤，看 `durations` / `tokens` 分布 | 判断是个例还是系统性问题 |

### 步骤 9 · 线下重放（日志不足以定性时）

```powershell
Invoke-WebRequest -Uri http://localhost:3000/api/chat -Method POST -ContentType 'application/json' `
  -Headers @{'X-Trace-Id'=[guid]::NewGuid().ToString();'X-Client-Sent-At'="$([DateTimeOffset]::Now.ToUnixTimeMilliseconds())"} `
  -Body '{"message":"三英战吕布","domain":"sango-novel"}' -UseBasicParsing
```

- 自定 traceId → 重放结果与原 trace 直接对照
- 会真调 LLM：单次复现可以；**批量重放 / 批量评测必须先报备负责人**（Token 控制第 4 条）
- 需改前端行为才能复现的 → 走真浏览器，不靠 API 重放（第 11 条）

---

## 5. 怎么判

### 5.1 快慢怎么判

- 对照**基线读数**（实测样本记在 `docs/troubleshooting-notes.md` 的「基线读数」），不凭感觉下结论
- 明显偏离基线 → 回到步骤 3 归因到具体一段，再决定是否继续深挖
- 具体阈值属经验值、随提示词 / 模型 / 语料漂移 → 只记在笔记里；验证充分后再谈是否固化进本手册

### 5.2 是否缺陷怎么判

**唯一可信依据是需求文档**（`requirements/feat-XXX-*.md`）：拿需求文档的「目标 / 验收标准 / 非目标 / 接口影响」对齐本次读数，**不符合需求才是缺陷**。

- 找需求文档：按现象定位能力（域 / 工具 / 页面）→ 在 `requirements/INDEX.md` 找到对应特性号 → 打开 `requirements/feat-XXX-*.md`
- 需求文档里写成「非目标 / 本次不做」的，不算缺陷
- **bug 清单、历史结论只作参照**：bug 修过、实现改过之后未必还成立，可能过期
- 找不到对应需求（新能力 / 无票场景）→ 按「闭环口径」报票，不自行认定

---

## 6. 现象 → 先看哪个读数

本表只回答「先看哪里」，**不下结论**（读数怎么读，见「排查流程」步骤 2–7）：

| 现象 | 先看 | 读数特征 |
|------|------|----------|
| 原文有答案却答「演义中未涉及」 | `funnel` + `candidates` | 目标 chunk 不在 `candidates` / `lexicalHits` 偏少 |
| 召回对但答案没用到 | `funnel.injected` / `cited` | `injected < topN` 或 `cited < injected` |
| 引用原文与结论不相关 | `candidates[].cited` + 工具出参 | 引用片段 `cited=false` |
| 问「第几回」答不出 | 工具入参 `query` + 诊断 `query.normalized` | 回号被剥离 |
| 空答案 / 答一半 | LLM `finishReason` + `completionTokens` | `length`，思考 token 吃满 |
| 响应慢 | `durations` | 归因到 `queueWait` / `llm` / `tool` |
| 报 500 | 主表 `errorMessage` + LLM 失败行 | `请求中断未完成回填` = 进程重启 |
| 报 503 | 工具明细 `failed` | MCP 未配置 / 子进程报错 |
| 选中标签后路由错 | `domain` + 工具 `stage` | 与预期域不同 |
| 页面抖动 / 弹框跳动 / 滚动异常 | **不看日志** | UI 类：真浏览器复现 + 复测读数（第 11 条） |

> 疑似根因、历史 bug 对照（**可能过期，只作参照**）记在 `docs/troubleshooting-notes.md`。

---

## 7. 命令速查

**A. 概览**：见步骤 1。

**B. 检索诊断**：见步骤 6。

**C. 只有现象、没有 traceId → 反查**

```powershell
# 按关键字（模糊匹配 user_input）
((Invoke-WebRequest "http://localhost:3000/api/v1/logs?keyword=三英战吕布&pageSize=5" -UseBasicParsing).Content|ConvertFrom-Json).data.list|%{"$($_.traceId) $($_.logType) $($_.domain) $($_.status) $($_.responseCode) $($_.userInput)"}
# 只看失败
((Invoke-WebRequest "http://localhost:3000/api/v1/logs?status=failed&pageSize=10" -UseBasicParsing).Content|ConvertFrom-Json).data.list|%{"$($_.traceId) $($_.logType) $($_.domain) $($_.responseCode) $($_.errorMessage)"}
```

可用过滤：`logType`（`chat`/`quiz`）、`domain`、`traceId`、`startAt`/`endAt`（毫秒，过滤 t1）、`status`、`responseCode`、`keyword`、`pageNo`/`pageSize`（≤100）。排序固定 t1 倒序。

**D. 直连日志库**（接口不可用 / 想直接 SQL 时）

```powershell
cd D:\workplace\mcp-orchestrator
node -e 'const D=require("better-sqlite3");const db=new D("data/logs.db",{readonly:true});console.log(db.prepare("select trace_id,log_type,domain,status,response_code,error_message from request_logs where trace_id=?").get(process.argv[1]))' <traceId>
```

四张表：`request_logs`（主表）、`llm_call_logs`、`tool_call_logs`、`tool_retrieval_logs`（诊断，主键 `trace_id + seq`）。

**E. Token 统计**（成本 / 用量画像）

```powershell
$now=[DateTimeOffset]::Now.ToUnixTimeMilliseconds(); $from=$now-7*86400000
(Invoke-WebRequest "http://localhost:3000/api/v1/logs/token-stats?startAt=$from&endAt=$now&granularity=day" -UseBasicParsing).Content
```

**F. 整链路快照导出**（**执行人：负责人，Coco 不自跑**；按 traceId 导出单条链路（约 500 行）；chunkId 反查用 `--list` 只列 traceId、不批量导出；落为单文件直接分析并随 bug 票归档；与日志页「一键导出」同构、schema v1）

```powershell
cd D:\workplace\mcp-orchestrator
node scripts/probe/trace-export.mjs <traceId> [输出路径]            # 导出单条（缺省 data/trace-exports/；LOGS_DB 可覆盖库路径）
node scripts/probe/trace-export.mjs --list <chunkId>                # 反查 chunk 命中链路，只列 traceId（不导出）
# 例：node scripts/probe/trace-export.mjs 5ce3c583-6a50-4745-8b2a-fa0db1afbba5
# 相对输出路径固定落 data/trace-exports/；终端报行数/KB；chunkId 批量勾选下载由日志页「一键导出」承载
# 只读打开 data/logs.db，不落任何业务表
```

**Coco 读取口径**：只按需取字段（Select-String / 片段抽取），不整读文件。

**取数优先级**：① 负责人导出的 traceId 快照 → ② `--list <chunkId>` 反查 traceId → ③ 只读直连日志库（命令速查 D；小结果集 + `LIMIT`，遵守 AGENTS.md 第 8 条输出护栏）。

---

## 8. 读数陷阱与已知边界

| 边界 | 影响 |
|------|------|
| 内容字段统一 8000 字符截断 | `answer` / `citations` / 入参 / 出参 / LLM 请求响应摘要；看不到尾部时需线下重放，不靠日志 |
| 诊断 64 KB 预算截断 | `truncated` / `truncatedCount` 标注 |
| 历史行 `caller` / `stage` 为 NULL | 加这两个字段之前落库的工具明细没有调用方信息，**不代表「没调用方」** |
| `quiz` 无 LLM 明细、`tokens=null` | 正常（不经 LLM），不是埋点缺失 |
| 无 LLM 调用时 `tokens` 为 null | 不返回 0 |
| 同一 traceId 幂等 | 重试 / 超时重发沿用同一 traceId，主表只有一条（骨架复用 + 回填） |
| traceId 兜底 | 请求头缺失时服务端生成，以响应头 `X-Trace-Id` 为准 |
| 埋点旁路 | 日志写失败不影响业务；表现为「业务正常但明细缺行」 |
| 测试噪声 | A003 测试 harness 会写开发库：**domain 空 + 无耗时** 的「随机一题」记录可能是测试数据（已知问题，见笔记「已知问题参照」） |
| 保留期 30 天 | 更早的 traceId 查不到 |
| 日志页无鉴权 | 含用户输入，v1 内网口径 |
| 总台进程日志不落盘 | `console.*` 只到终端 stdout；重启后历史丢失，「请求中断未完成回填」无法与重启时刻对齐 |
| 前端异常无采集 | 前端未捕获异常、请求根本没发出（无 trace 记录）在日志里看不到，须 DevTools |
| 思考文本不落库 | 只有 `finishReason` / token 计数，思考内容本身看不到（GAP-03） |

---

## 9. 闭环口径

- **无票不动代码**（第 1 条）：排查结论落成 bug 票后才动代码；Coco 不改业务代码（第 3 条）
- **小 bug 从简**（2026-09-21 决策）：根因显然、改动一两行 → 只在 `bugs/INDEX.md` 登记一行；长期课题 / 需承载排查过程 → 建 `bugs/bug-XXXXX-*.md`
- **已归档需求文档冻结**：不得回填 bug、不得补记结论；后续问题一律走 bug 票
- **UI / 交互类**（第 11 条）：真浏览器复现 → 改 → 同手段复测读数；缺环境时明确告知负责人
- **汇报格式**（第 7 条）：现象 + 根因层 + 证据读数 + 后续动作；文档变更只报路径，不复述内容

---

## 10. 维护记录

| 日期 | 变更 | 触发来源 | 验证方式 |
|------|------|----------|----------|
| 2026-09-22 | 初版：链路与埋点覆盖面、排查流程（步骤 0–9）、怎么判、现象 → 先看哪个读数、命令速查、读数陷阱、闭环口径 | 负责人要求：用现有日志系统规范化排查流程 | 总台 :3000 + 日志页 :8001 在线，全部命令以真实 trace 实测（样本 `f21dd6be-27c1-45dc-aa84-7da74e33d78a`） |
| 2026-09-22 | 会过期的内容（bug 号结论、已知问题对照、经验阈值）移出到 `docs/troubleshooting-notes.md`；`§N` 引用改为节名 | 负责人：本手册必须准确、不误导；唯一可信是需求文档 | 逐节复核引用与节名 |
| 2026-09-24 | LLM 明细新增 `stage=novel_support_check`（演义域生成轮后的引用支撑复核轮，bug-00028 长期机制）；拒答口径：复核判不支撑 / `uncertain` / 解析失败重试后仍失败 → 答案「演义中未涉及」+ 空引用、`funnel.cited=0` | bug-00028 定稿设计 `docs/novel-answer-support-check.md` | 全量测试 349 绿 + 真实 trace 实测 |
| 2026-09-24 | 撤销 `novel_support_check` 复核轮 stage（负责人否决二次 LLM 调用，成本 / 延迟翻倍）；演义域改为单轮生成 + 结构保险丝（生成轮通用语义指令 + 句-片段文本重叠结构门），拒答口径不变，见 `docs/novel-answer-support-check.md` 新版 | bug-00028 设计改版 | 全量测试绿 + 三例 trace 复测 |
| 2026-09-25 | §7 增补 F「整链路快照导出」：`scripts/probe/trace-export.mjs <chunkId|traceId>`（mcp-orchestrator）只读导出全字段 JSON 快照；排查改直接分析快照文件，不再逐条走同流程；日志页「一键导出」交付后与脚本同构 | 负责人拍板双轨机制（自查轨即刻可用 / 页面轨供团队成员） | 脚本实测：`sanguo-yanyi:0050:c0011` 命中 65 条链路导出成功 |
| 2026-09-25 | §7 F 执行人修正：导出由负责人执行、Coco 不自跑（token 控制）；体量：1 条 trace ≈ 500 行；Coco 收到文件按需取字段、不整读 | 负责人拍板 | 负责人实测体量后确认 |
| 2026-09-25 | §7 F 补护栏：默认只导前 10 条命中链路（`--limit N` / `--all` 覆盖）；相对输出路径固定落 `data/trace-exports/`；终端报行数/KB 与扫描行数 | 负责人（防 3W 行大文件）+ Coco（实现） | `node --check` + `--limit 1` 冒烟：65 命中→1 条、465 行/35 KB |
| 2026-09-25 | §7 F 精简：剔除 chunkId 批量导出（负责人试跑后拍板：5000 行不可取）；只留 traceId 单条导出 + `--list <chunkId>` 反查列 traceId；chunkId 批量勾选下载归页面轨 | 负责人 + Coco | 冒烟：traceId 465 行/35 KB；`--list` 65 命中列前 10 条 |
| 2026-09-25 | §7 F 明确取数优先级：快照文件 → `--list` 反查 → 只读直连查表（小结果集 + 输出护栏） | 负责人（确认够用）+ Coco（落口径） | — |
| 2026-09-26 | §2.1 证据源地图补 `llmCalls.requestSummary / responseSummary`（生成轮入参含注入片段全文 + 模型原始输出含指针）；「日志系统看不到」清单删除注入文本、改为可经 summary 查 | A016 验收三票排查（bug-00032/33/34）实测发现旧口径不符 | 四 trace（c549084b / ca7d9c6a / 67119582 / 275551c3）实取 responseSummary 与 final 对照，护栏误裁定案 |
| 2026-09-26 | 步骤 4 判 LLM 明细补 `stage=novel_boundary_check`：演义域重叠门边界语义复核，仅低重叠待裁叙述句触发、responseSummary 即判定、正常样本不出现 | bug-00032/33/34 修复（护栏重叠门改边界复核）随 hu/feat-A016_term-normalization a121557 合入需求分支 | 小胡全量测试 348/348 绿（mock 两路，零真实 LLM 调用） |
