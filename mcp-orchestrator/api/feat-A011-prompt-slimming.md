# feat-A011: 提示词瘦身 + 天气下线 + auto 轻量分类 + cachedTokens —— 接口文档

> 作者：老陈
> 对应特性号：feat-A011
> 故事号：story-A011-02
> 涉及项目：mcp-orchestrator（总台）、mcp-web（小叶对接）；mcp-server 仅天气下线涉及总台装配，器坊代码不动
> 日期：2026-09-22
> 前置：feat-A003（统一路由提示词 / 工具自主决策）、feat-A004（sango RAG / 引用校验）、feat-A005（fengyunsanguo 三工具契约）、feat-A006（answer/citations 形状）、feat-A007（日志查询 / llm_call_logs / token 埋点）、feat-A009（快路径预调 / 检索诊断）、feat-A010（模型可见工具白名单 / 域提示注入）

## 概述

本特性针对单次对话输入 token 居高（3.3K+，`auto` 7.2K）做四项瘦身，`/api/chat` 请求 / 响应形状（`answer` / `citations`）零变更：

1. **静态文本瘦身**：分类 / 生成轮提示词分离；快路径命中（域锁定 + 检索结果已注入）不携带工具定义；提示词写成缓存友好形态（静态前缀逐字节稳定、变化内容靠后）。
2. **天气能力下线**：总台不再注册 weather MCP server，路由、提示词、domain 校验同步移除；器坊 weather 代码保留不删；历史日志保留可查。
3. **`auto` 第 1 次调用改轻量分类**：由「带工具自主决策」改为「无 tools 轻量分类出编号」，服务端按编号预调工具并注入，生成轮不再携带工具定义。
4. **日志采集 `cached_tokens`**：`llm_call_logs` 增列，`/api/v1/logs/:traceId` 明细 `llmCalls[].cachedTokens` 供前端日志页「缓存命中」列消费。

不改：注入片段预算（2000 字符 / 10 段 / 前 5 段保底）、L1 域标签白名单（除移除 weather）、L3 题库向量识别、题库「随机一题」状态机、模型 / provider / `max_tokens` / `temperature`、召回算法 / 语料 / 切分 / 标签体系、提示词外部化（保持 TS 常量）。

### 达标口径（验收硬指标，token 以 `usage.prompt_tokens` 实测为准）

| # | 口径 | 基线 | 目标 |
|---|------|------|------|
| 1 | 域锁定快路径单轮静态文本（sango-novel 域提示） | 317 | ≤250 |
| 2 | `auto` 分类轮静态文本（请求体无 `tools`） | 2794 | ≤400 |
| 3 | 原著域快路径单次调用（均值） | 3460 | ≤2400 |
| 4 | 题库域单次调用 | 1520 | ≤400 |
| 5 | `auto` 两轮合计 | 7205 | ≤2800 |

静态文本口径：system 提示词 + 域提示 + 工具定义（如携带），不含用户问题与注入片段。

## 一、工具描述契约（模型可见）

### 1.1 工具集变化

| 变化 | 工具 | 说明 |
|------|------|------|
| 移除（天气下线） | `get-forecast` / `get-alerts` | 总台不注册 weather server，白名单同步移除 |
| 保留（4 个） | `sango_novel_search` / `fengyunsanguo_query` / `fengyunsanguo_quiz_command` / `fengyunsanguo_quiz_route` | 模型可见 description 瘦身 |

**关键设计**：瘦身只发生在总台「模型可见渲染」层（`resolveModelTools()` 白名单过滤后按映射表替换 description）。MCP 传输层与 mcp-server 侧工具定义（name / description / inputSchema 原文）**一字不动**，器坊零改动、MCP 契约文档与既有测试不受影响。

### 1.2 瘦身后模型可见 description 全文（总台映射表，`MODEL_VISIBLE_DESCRIPTIONS`）

| 工具 | 瘦身后 description（全文，实现时逐字节采用） |
|------|-----------------------------------------------|
| `sango_novel_search` | `检索《三国演义》原著原文。仅当用户询问原著情节/人物/事件等需要原文依据的问题时调用；返回结构化条目数组，禁止凭记忆作答。` |
| `fengyunsanguo_query` | `风云三国题库候选召回：text 传用户原始问法，返回候选题目（题干→答案），供 LLM 判定对应题。` |
| `fengyunsanguo_quiz_command` | `风云三国随机一题状态机（本地规则，不经 LLM）：随机出题/判题/查答案，按 sessionId 维持会话。` |
| `fengyunsanguo_quiz_route` | `风云三国 L3 高置信识别（不经 LLM）：判定 text 是否为题库内问题，返回 JSON true/false。` |

### 1.3 schema 字段表（inputSchema 原样透传，不瘦身）

| 工具 | 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|------|
| `sango_novel_search` | `source` | string enum | 是 | `sanguo-yanyi` / `sanguozhi`（预留） |
| | `query` | string | 是 | 检索关键词或句子 |
| | `limit` | number int | 否 | 默认 5，最大 10 |
| `fengyunsanguo_query` | `text` | string | 是 | 用户原始问法 |
| | `limit` | number int | 否 | 默认 1，最大 8 |
| `fengyunsanguo_quiz_command` | `message` | string | 是 | 随机一题指令 / 作答 / 查答案 |
| | `sessionId` | string | 否 | 判题会话标识（前端 UUID） |
| `fengyunsanguo_quiz_route` | `text` | string | 是 | 用户问句 |

### 1.4 瘦身前后字符 / token 对照

| 项 | 瘦身前（实测 2026-09-22） | 瘦身后（估算口径，实现后实测回填） |
|----|---------------------------|-------------------------------------|
| 模型可见工具数 | 6 | 4 |
| description + schema 总字符 | 2876（天气 2 个 796 字符，其余 4 个 2080 字符） | ≤1200（description 部分约 190 字符，schema 原样） |
| 总 token | 1364 | ≤600（折算口径 0.47 token/字符，实测回填） |

### 1.5 兼容结论

- **MCP 契约文档（feat-A004 / feat-A005）**：工具名、inputSchema 字段、返回结构、行为零变化 → 契约文档无需改动。
- **器坊测试**：mcp-server 侧 description / schema 原文保留 → 既有测试不受影响。
- **总台既有测试**：断言工具名 / schema / 返回的不受影响；断言模型可见 description 原文的用例随本特性同步更新（属文档同步范围）。
- `GET /api/tools` 返回瘦身后模型可见 description（仍是白名单过滤后全量，前端无消费影响）。

## 二、`auto` 轻量分类与编号表

### 2.1 触发时机

`route === "auto"` 且 L3 题库向量识别未命中时，第 1 次调用改为轻量分类（无 `tools`）：只发 `[system: 分类提示] + [user: 用户问题]`，模型仅输出编号。域锁定（`domain` 参数 / L1 / L2 命中）直接走快路径，不经过分类轮。

### 2.2 编号表（`CLASSIFY_ROUTE_IDS`）

| 编号 | 域 | 服务端预调 | 注入 | 生成轮 |
|------|-----|-----------|------|--------|
| `1` | 原著检索域 | `sango_novel_search`（source=sanguo-yanyi, query=用户问句, limit=10） | 【已检索到的《三国演义》原文片段】 | sango-novel 域提示 |
| `2` | 题库问答域 | `fengyunsanguo_query`（text=用户问句） | 【已检索到的题库候选】 | fengyunsanguo 域提示 |
| `99` | 自由模式兜底 | 无 | 无 | 自由对话提示 |

- 编号约定：`1`~`98` 预留给能力域（加能力 = 加编号分支，架构不变）；`99` 恒为自由兜底。
- 分类兜底取向：**不确定时倾向选 `1` / `2`**，不轻易落 `99`；宁可多一次服务端预调，不错失能力域。
- 输出解析：取回复文本**首个数字**（`/^\d+/` 提取首个匹配）；无法解析 / 解析出非 `1`/`2`/`99` 的编号 → 按 `99` 处理，且不重试。

### 2.3 分类轮 system 提示词全文（估算 ≤400 token）

```
你是路由分类器，只输出一个数字编号，不要任何解释、标点或多余文字。
1 = 《三国演义》原著检索域
2 = 风云三国题库问答域
99 = 其他（自由对话）
不确定时倾向选 1 或 2。
```

估算：约 90 字符 ≈ 60 token（≤400 达标；请求体无 `tools`）。分类轮日志 `stage = "classify"`（新增枚举值，`LlmStage` 扩为 `"classify" | "generation"`）。

### 2.4 分类 / 域锁定后的生成轮契约

生成轮消息固定为 `[system: 域提示] + [user: 用户问题] + [system: 注入片段]`（99 无注入），**一律不携带工具定义**。域提示全文（缓存友好：静态前缀逐字节稳定，注入内容恒在末尾）：

**sango-novel 域提示**（目标 ≤250 token，基线 317）：

```
当前为「三国演义原著解读」场景。系统已检索《三国演义》原文并附在问题下方【已检索到的原文片段】中；请直接依据片段作答，不要再调用检索工具。
1. 先给一句直接回答用户问题主体的结论，人名以召回原文为准（关羽、云长、关公均可）。
2. 结论后引用原文：引语只输出 [Qn]，严禁夹带引语正文，严禁输出 ⟨Qn⟩ 编号；无引号叙述句输出 [片段N] 且 [片段N] 后必须紧跟该句正文，禁止裸指针；引语原文与出处由服务端按字段渲染，你不得抄写，严禁输出回目、出处、段号。
3. 片段中确实没有相关内容时回复「演义中未涉及」，禁止用先验知识补全。
4. 不以「按原文，」开头，不输出解释、总结或格式以外的内容；提问明显不属于原著（如问候、天气）时按普通对话处理。
5. 回答前，你必须先思考以下问题：
 5-1 用户问题中的事件结构是：(施事者=?, 动作=?, 受事者=?)
 5-2 检索文档中的事件结构是：(施事者=?, 动作=?, 受事者=?)
 5-3 两者方向是否一致？如果不一致，禁止用该文档回答。
```

估算：约 400 字符 ≈ 190~250 token（≤250 目标临界；验收以日志实测回填）。

**fengyunsanguo 域提示**：

```
当前为「风云三国题库」场景。系统已预先检索题库，候选题目附在问题下方【已检索到的题库候选】中；请直接依据候选作答，不要再调用检索工具：候选中含义相同的那道题只输出该题答案原文；候选为「未召回到任何候选题目」时只回复「题库未收录该题，请换个问法」。
```

估算：约 110 字符 ≈ 70 token。

**自由对话提示（99）**：

```
你是统一对话助手，用简体中文回答用户问题。问候、闲聊与通用问题直接自由作答，简洁清楚，不加模板、不提及工具名。
```

## 三、模型调用口径（bug-00018）

> 同步自 `bugs/bug-00018-empty-answer-thinking-loop.md`（2026-09-22 负责人确认），本特性各轮次调用按此口径设置思考开关与空答案兜底。

### 3.1 关思考判据

**只要 messages 里有服务端注入的依据、或本轮输出已被锁成编号 / 单句 → 关闭思考；只有「无注入的自由模式 99 生成轮」保留思考。**
判据不是「我们有没有给答案」，而是「任务是否已确定 + 输出是否已被约束」。

| 轮次 | 关思考 |
|------|--------|
| 域锁定快路径（原著 / 题库）生成轮 | 关 |
| 指针校验失败的兜底结论轮 | 关 |
| `auto` → 1 / 2 的分类轮 | 关 |
| `auto` → 1 / 2 的生成轮（已注入） | 关 |
| `auto` → 99 的分类轮 | 关 |
| `auto` → 99 的生成轮（无注入） | 不关 |

### 3.2 空答案兜底口径

触发面**只限**「`content` 为空 / `finish_reason=length`」；超时、限流、工具不可用不在其列（重试会放大故障）。

1. **第一层：变参重试 1 次**。变参写死为「`temperature → 0` 必做；该轮若开着思考则一并关闭」。注意：按 §3.1，除「自由模式 99 生成轮」外均默认已关思考，这些轮次的实际变参只剩 `temperature=0`——实现时不得视为空操作而不变参。
2. **第二层：仍失败 → 报错**。500 + 固定文案「处理请求失败，请稍后重试」，不透传模型原文；日志 `status=failed`、`response_code=500`、`error_message` 写明「生成轮两次空答案」。不新造状态码。

### 3.3 `/api/chat` 请求与响应形状不变

本次**不新增任何字段**，请求 / 响应形状与既有契约（`answer` / `citations`）保持一致。

## 四、日志 `cachedTokens`

### 4.1 存储层（`src/storage/logs.ts`）

- `llm_call_logs` 增列：`cached_tokens INTEGER`（建表语句同步加列；既有库 `ALTER TABLE llm_call_logs ADD COLUMN cached_tokens INTEGER`，SQLite 支持缺省 NULL）。
- `LlmCallPayload` / `LlmCallLog` 增 `cachedTokens?: number | null`。

### 4.2 采集点（`src/agent.ts` `callModel` 成功分支）

`cachedTokens: response.usage?.prompt_tokens_details?.cached_tokens ?? null`。类型 `number | null`；`null` = provider 未返回或失败调用不采集（与 `promptTokens` 同口径）。

### 4.3 `/api/v1/logs/:traceId` 响应（前端日志页「缓存命中」列消费）

`llmCalls[]` 每项新增字段（camelCase，与既有 `promptTokens` / `completionTokens` 同风格）：

| 字段 | 类型 | 说明 |
|------|------|------|
| `cachedTokens` | number / null | 本次调用缓存命中 token 数；`null` 表示无数据（旧记录 / provider 未返回） |

- 列表接口 `/api/v1/logs` 列表项结构不变（不加字段）。
- 前端展示口径：`null` 显示 `—`，`0` 显示 `0`（有数据但未命中缓存）。
- `0` 的常见成因（2026-09-22 探针实测，均属正常，**不作缺陷判据**）：① 冷启动——该 prompt 前缀首次出现；② 跨问句——共享前缀只有域提示 ~250 token，低于 provider 最小可缓存前缀（实测 210 token 共享前缀命中 0，1613 token 命中 1536，按 64 块对齐）；③ provider 侧 TTL / 驱逐 / 账号级共享缓存干扰（同问句重复实测 6 秒命中 1792/1841，20 分钟后同问句可能仍为 0）。**只有整段 prompt 逐字节重复时才可能出现 >0 的命中**。
- 另注：provider 在 messages 之外会拼入思考脚手架（同 messages 思考关 210 / 思考开 235，差 25 token，计入 `promptTokens`），思考口径变更会使历史缓存整体失效。

### 4.4 旧数据兼容

旧行缺列 → 读取为 `null` → 响应 `cachedTokens: null`；不迁移、不回填历史数据。

## 五、天气下线契约

| # | 契约 | 具体口径 |
|---|------|----------|
| 1 | 总台不注册 weather MCP server | `resolveMCPServerConfigs` 不再读取 `MCP_WEATHER_SCRIPT`；`index.ts` 移除「weather 必需否则 exit(1)」校验；残留 `MCP_WEATHER_SCRIPT` 配置直接忽略、不报错 |
| 2 | `GET /api/tools` 不含天气工具 | 白名单 `MODEL_VISIBLE_TOOLS` 移除 `get-forecast` / `get-alerts`；weather server 不装配即无工具来源 |
| 3 | `/api/chat` 传 `domain=weather` → 400 | `CHAT_ALLOWED_DOMAINS` 改为 `['fengyunsanguo', 'sango-novel']`；错误 message 原文：`domain 字段仅支持 fengyunsanguo、sango-novel`（与既有校验同口径，仅枚举变化） |
| 4 | 统一提示词去掉天气条款 | `UNIFIED_SYSTEM_PROMPT` 拆分重构后不再含天气能力 / 判断次序 / 分域兜底天气条款；`DOMAIN_ROUTES` / `WEATHER_KEYWORDS` / `RouteTarget` 移除 `weather` |
| 5 | 历史 `domain=weather` 日志保留可查 | 主表数据不清理；`GET /api/v1/logs` 的 `domain` 过滤枚举**保留** `weather`（`domain 只支持 weather/fengyunsanguo/sango-novel` 不变）→ 日志页「项目」筛选保留「天气」选项 |
| 6 | weather MCP server 代码保留不删 | `mcp-server/weather` 全部代码 / README / package.json 不动，仅总台不再装配 |

**注意（两处枚举不同源）**：`/api/chat` 的 `CHAT_ALLOWED_DOMAINS` 移除 weather；`/api/v1/logs` 的 domain 过滤枚举保留 weather。二者解耦，勿在实现时统一改掉。

## 六、feat-A003 演进说明（待改要点，供后续同步）

### 6.1 `docs/sango-mcp-routing-design.md`

1. 路由判定流程更新：L1 → L2 → L3（题库高置信，仅 auto）→ **新增「轻量分类出编号」**替代「统一 Agent 带工具自主决策」；补编号表（1 / 2 / 99）与预调注入时序。
2. 路由目标枚举变化：`weather | fengyunsanguo | sango-novel | auto` → `fengyunsanguo | sango-novel | auto`（移除 weather）。
3. 快路径说明更新：域锁定快路径不再携带工具定义（原「模型可见工具 = 白名单」仅剩 `GET /api/tools` 展示面）。
4. 工具自主决策路径删除 → 相应段落标注废止（避免与现状混读）。

### 6.2 `mcp-orchestrator/api/feat-A003-model-tool-routing.md`

1. 第 1 次调用语义变更：auto 首轮从「带工具自主决策（routing）」改为「无 tools 轻量分类（classify）」；`LlmStage` 枚举与日志 `stage` 值同步。
2. 工具可见性章节：白名单保留但语义收窄（模型可见工具仅在 `GET /api/tools` 与未来兜底路径出现；LLM 请求不再携带 tools）。
3. 天气能力下线相关段落标注移除；domain 校验枚举变更。
4. 域提示语义不变（预调注入后只按域提示作答），仅文本瘦身与拆分为「分类提示 + 域提示 + 自由提示」三常量。

## 七、接口侧验收清单（覆盖达标硬指标 + 契约）

| # | 条目 | 验证方法 |
|---|------|----------|
| 1 | 域锁定快路径单轮静态文本 ≤250 | 构造 `domain=sango-novel` 请求，取生成轮 `llmCalls[].promptTokens` 减去注入片段 / 问题后静态文本，或直接对域提示常量数 token；断言 ≤250 |
| 2 | auto 分类轮静态文本 ≤400 且无 tools | 构造 auto 用例，抓取首轮请求体：无 `tools`、promptTokens ≤400 |
| 3 | 原著域快路径单次调用 ≤2400（均值） | 抽样真实 trace：`llmCalls[].promptTokens` 均值 ≤2400 |
| 4 | 题库域单次调用 ≤400 | 抽样 `domain=fengyunsanguo` trace：`promptTokens` ≤400 |
| 5 | auto 两轮合计 ≤2800 | 抽样 auto trace：同 trace 两轮 `promptTokens` 之和 ≤2800 |
| 6 | cachedTokens 采集 | `GET /api/v1/logs/:traceId` 明细 `llmCalls[].cachedTokens` 为 number / null；有缓存命中时 >0 |
| 7 | 旧数据兼容 | 存量库升级后旧明细 `cachedTokens: null`，接口 200 不报错 |
| 8 | 天气下线 | `/api/tools` 无 `get-forecast` / `get-alerts`；`/api/chat` 传 `domain=weather` → 400 且 message 为 `domain 字段仅支持 fengyunsanguo、sango-novel` |
| 9 | 历史天气日志可查 | `GET /api/v1/logs?domain=weather` 返回历史记录 |
| 10 | 工具描述瘦身 | `GET /api/tools` 的 description 与 §1.2 全文一致；mcp-server 侧 description 原文未变 |
| 11 | 生成轮不携带 tools | auto 生成轮请求体无 `tools`；快路径生成轮无 `tools` |
| 12 | 分类轮输出解析 | 模拟回复 `2.xxx` → 2；`99` → 99；空 / 非数字 → 99 |

## 风险 & 开放问题

1. **token 估算为折算口径**：§1.4 / §2 的估算按 0.47~0.63 token/字符折算，验收以日志实测回填；cachedTokens 上线后即可核对。
2. **分类轮误判成本**：兜底倾向 1/2 → 误判成本 = 一次空预调 + 域提示不适配，远低于误判 99 漏掉能力域；若误判率偏高另开 bug 票跟踪。
3. **`stage` 新增 `classify`**：日志明细与前端若按枚举渲染需兼容（未知值回退字符串直显）；`/api/v1/logs` 无 stage 过滤参数，不影响接口。
4. **两处 domain 枚举解耦**：chat 校验移除 weather、日志过滤保留 weather，已写明（§五注），防实现时统一误删。
5. **`UNIFIED_SYSTEM_PROMPT` 拆分**：拆为 `CLASSIFY_SYSTEM_PROMPT` + 域提示常量 + 自由提示常量，保持 TS 常量不外部化；原常量删除，无孤儿引用。
