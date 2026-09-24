# 风云三国 MCP 化（fengyunsanguo server + HTTP 接口契约）

> 作者：老陈
> 对应特性号：feat-A005
> 故事号：story-A005-02（接口文档；实现见后续故事）
> 涉及项目：mcp-orchestrator（server.ts / agent.ts / index.ts / transport 注册表）、mcp-server（新增独立 MCP server「fengyunsanguo」）、mcp-web（小叶对接，与 orchestrator 同发）
> 日期：2026-09-20

## 概述

把风云三国题库能力从 orchestrator 本地服务迁入新增的独立 MCP server「fengyunsanguo」：orchestrator 不再内置题库 / 会话状态，改为通过 MCP 工具调用。HTTP 层 `domain` 取值 `sango` 破坏性迁移为 `fengyunsanguo`（白名单变为 `['fengyunsanguo','sango-novel']`，旧值返回 400），orchestrator 与 mcp-web 必须同发；`/api/sango/random` 路径、信封、串行队列与 sessionId 语义保持现状，内部改调 MCP 工具 `fengyunsanguo_quiz_command`；orchestrator 总台不再有本地工具（`sango_query` 移除，由 MCP 工具 `fengyunsanguo_query` 承接）。演义侧（`sango-novel` / `sango_novel_search` / `sanguo-yanyi`）与天气侧均不动。

全部 HTTP 接口沿用 `{ code, data, message }` 信封（见 `mcp-orchestrator/api/response-convention.md`）。

## 独立 MCP server「fengyunsanguo」

| 属性 | 值 |
|------|-----|
| 服务名（MCP server name） | `fengyunsanguo` |
| 传输方式 | stdio 子进程（与 weather / sango 一致，注册表模式） |
| 注册表环境变量 | `MCP_FENGYUNSANGUO_SCRIPT`（可选：缺配 → fengyunsanguo 不可用；weather 仍必需） |
| 工具 | `fengyunsanguo_query` / `fengyunsanguo_quiz_command` / `fengyunsanguo_quiz_route` |
| 数据 | 题库（风云三国招募武将问答题）；quiz 会话 Map 在 quiz 子进程内存，TTL 30 分钟、重启即清 |

- 与 weather / sango 两个现有 server 隔离互不改；`sango` server（`sango_novel_search`）与 `sango-novel` 快路径行为不变。
- 缺配 / 启动失败 / 运行中退出 → fengyunsanguo 不可用：依赖它的能力返回 503，其余功能（天气、演义、通用问答）照常。
- 三个工具归属 fengyunsanguo server；工具名 → server 归属由 transport 注册表显式映射（沿用 A004 机制）。

### MCP 工具结果格式（三工具通用）

标准 `tools/call` 响应：

```json
{
  "content": [{ "type": "text", "text": "<业务文本>" }],
  "isError": false
}
```

- `isError: false`：正常出参，`text` 为业务结果，`content` 恒为单元素。
- `isError: true`：工具级错误，`text` 为错误说明；orchestrator 一律包装为 `ToolExecutionError` → HTTP 503（与「未连接 / 子进程退出 / 协议错误」同路径，HTTP 层不区分内部原因）。
- 连接级失败（MCP 未连接 / 子进程退出 / 协议错误 / 调用超时）同样抛 `ToolExecutionError` → HTTP 503。

## 工具契约

### 1. `fengyunsanguo_query(text, limit?)` —— 题库候选召回

| 属性 | 值 |
|------|-----|
| 用途 | 风云三国题库招募武将问答题候选召回；供 LLM 按语义自主调度与 `domain=fengyunsanguo` 快路径 |
| 参数 | `text`（string，必填）：用户原始问法（不做前置归一化）；`limit`（number，可选）：候选条数上限，默认 `1`，范围 `1–8`，越界裁剪为边界值 |
| 返回文本 | 按相关度排序的候选行 `序号. 题干 → 答案`；无候选返回 `未召回到任何候选题目` |
| 错误 | `text` 非字符串 / 空 → `isError: true` |

description（供 /api/tools 与 system prompt）：

```
风云三国题库检索：仅当用户询问风云三国游戏内招募武将问答题时调用；参数 text 传用户原始问法，limit 为候选条数上限（默认 1），返回候选题目（题干 → 答案）
```

正常返回示例：

```json
{
  "content": [{ "type": "text", "text": "1. 夏侯惇的字是什么？ → 元让" }],
  "isError": false
}
```

无候选：

```json
{ "content": [{ "type": "text", "text": "未召回到任何候选题目" }], "isError": false }
```

### 2. `fengyunsanguo_quiz_command(message, sessionId?)` —— 随机一题状态机

| 属性 | 值 |
|------|-----|
| 用途 | 确定性「随机一题」命令流：出题 / 判题 / 查答案，不经 LLM（`/api/sango/random` 内部调用） |
| 参数 | `message`（string，必填，≤300 非空白）；`sessionId`（string，可选）：会话键，语义与现状完全一致 |
| 会话 | 子进程内存 `Map<sessionId, { question, createdAt }>`，TTL 30 分钟（过期即清）；**进程重启即清空**；出题成功时刷新该键 |
| 返回文本 | 与现状 `SangoService.handleRandom` 输出完全一致（见下） |
| 错误 | `message` 非字符串 / 空 → `isError: true` |

指令顺序（同现状）：**随机一题 → 无会话判定 → 查答案 → 判题**。

| 输入 | 返回文本 |
|------|----------|
| 「随机一题」/「来一题」 | `题目：夏侯惇的字是什么？\nA. 元让\nB. 妙才\nC. 子龙\nD. 云长`（随机取一题不标注答案；有 sessionId 则写入 / 刷新会话） |
| 选项字母 `A-D`（忽略全角 / 大小写）或选项文本 | 答对：`答对了！正确答案：元让（A）`；答错：`答错了，正确答案：元让（A）` |
| 判题未命中（非选项字母 / 非选项文本） | `答错了，正确答案：元让（A）`（现状语义） |
| 「答案」/「这题选什么」 | `正确答案：元让（A）` |
| 无有效会话时判题 / 查答案 | `请先发送“随机一题”开始` |
| 题库为空 | `题库为空，暂时无法出题` |

`sessionId` 语义（与现状一致）：

- 不传 → 只出题、不记会话，之后判题 / 查答案一律返回「无会话」提示；
- 传 → 出题写入会话，TTL 30 分钟；过期或子进程重启后按无会话处理；
- 格式不校验：非空字符串即合法（沿用现状）。

`/api/sango/random` 取 `content[0].text` 原样放入 `data.answer`，不做改写。

### 3. `fengyunsanguo_quiz_route(text)` —— L3 高置信识别

| 属性 | 值 |
|------|-----|
| 用途 | orchestrator L3 路由注入：对问法做风云三国题库高置信正向识别（语义沿用现状 `isHighConfidenceSangoQuery`：题库向量相似度 ≥ 阈值，或与某题题干词面相似 ≥ 阈值） |
| 参数 | `text`（string，必填）：用户原始问法 |
| 返回文本 | `true`（高置信命中）/ `false`（未命中） |
| 错误 | `text` 非字符串 / 空 → `isError: true` |

```json
{ "content": [{ "type": "text", "text": "true" }], "isError": false }
```

- 消费方仅 orchestrator（`agent` L3 注入点）；**不进 `/api/tools`、不注入 system prompt**，模型不可见、不可调。
- 识别阈值与边界条件由 mcp-server 侧实现，语义对齐现状，指标含义不因迁移变化。

## POST /api/chat（domain 白名单迁移）

| 属性 | 值 |
|------|-----|
| 方法 / 路径 | POST /api/chat |
| Content-Type | application/json |
| 请求体白名单 | `message`、`domain` |
| domain 白名单 | **`fengyunsanguo`、`sango-novel`**（旧值 `sango` 已移除） |

### 请求参数

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| message | string | 是 | 用户输入，≤300 字符 |
| domain | "fengyunsanguo" \| "sango-novel" | 否 | 缺省走统一 Agent 自主路由；`fengyunsanguo` = 风云三国题库快路径，`sango-novel` = 演义快路径（不变） |

### 正常流示例（domain=fengyunsanguo）

请求：

```json
{ "message": "夏侯惇的字是什么？", "domain": "fengyunsanguo" }
```

成功响应（`data` 仍为 `{ answer }`，无新增字段）：

```json
{ "code": 200, "data": { "answer": "元让" }, "message": "" }
```

未收录：

```json
{ "code": 200, "data": { "answer": "题库未收录该题，请换个问法" }, "message": "" }
```

行为说明：

- `domain=fengyunsanguo` 快路径：服务端预先调 `fengyunsanguo_query` 召回候选并注入，单次 LLM 生成（沿用现状 sango 快路径结构，仅工具来源变为 MCP；快路径内部可传 `limit=8`，契约只定默认 1）。
- 其余场景（无 domain / 天气 / 演义）行为与现状一致；无 domain 时模型按语义自主调 `fengyunsanguo_query`（语义等价旧 `sango_query`）。

### 旧值 domain=sango → 400

请求：

```json
{ "message": "夏侯惇的字是什么？", "domain": "sango" }
```

响应：

```json
{ "code": 400, "data": null, "message": "domain 字段仅支持 fengyunsanguo、sango-novel" }
```

- 旧值 `sango` 不单独枚举文案，与其它非法值共用同一白名单校验分支；提示文案已同步为新区间。
- 前端展示 `res.message` 即可；两端同发后线上不应再出现该请求（见「破坏性变更与两端同发」）。

### 错误响应（其余沿用现状）

| code | 场景 | message |
|------|------|---------|
| 400 | message 为空 / 请求体含白名单外键 / domain 非法（含旧值 sango） | `message 不能为空` / `请求体只支持 message、domain 字段，收到无效字段：<键名>` / `domain 字段仅支持 fengyunsanguo、sango-novel` |
| 413 | message 超过 300 字符 | `消息不能超过 300 字符` |
| 503 | 模型调任一 MCP 工具失败（fengyunsanguo 未连接 / 子进程退出 / 协议错误 / isError） | `工具服务暂不可用，请稍后重试` |
| 500 | 其余处理失败（LLM 调用失败等） | `处理请求失败，请稍后重试` |

## POST /api/sango/random（路径不变，内部改调 quiz_command）

| 属性 | 值 |
|------|-----|
| 方法 / 路径 | POST /api/sango/random（**不变**） |
| 请求体白名单 | `message`、`sessionId`（不变） |
| 执行 | 与 /api/chat 共用同一串行队列（不变）；内部改为调用 `fengyunsanguo_quiz_command(message, sessionId)`，取 `content[0].text` 作为 `data.answer` |
| 信封 | `{ code, data: { answer }, message }`（不变） |

### 全流程示例

出题（带 sessionId）：

```json
{ "message": "随机一题", "sessionId": "8f4b0e2a-1234" }
```

```json
{
  "code": 200,
  "data": { "answer": "题目：夏侯惇的字是什么？\nA. 元让\nB. 妙才\nC. 子龙\nD. 云长" },
  "message": ""
}
```

判题（答对 / 答错）：

```json
{ "message": "A", "sessionId": "8f4b0e2a-1234" }
```

```json
{ "code": 200, "data": { "answer": "答对了！正确答案：元让（A）" }, "message": "" }
```

```json
{ "message": "子龙", "sessionId": "8f4b0e2a-1234" }
```

```json
{ "code": 200, "data": { "answer": "答错了，正确答案：元让（A）" }, "message": "" }
```

查答案：

```json
{ "message": "答案", "sessionId": "8f4b0e2a-1234" }
```

```json
{ "code": 200, "data": { "answer": "正确答案：元让（A）" }, "message": "" }
```

无会话提示（未出题即判题 / 不传 sessionId 判题 / 会话过期）：

```json
{ "message": "A" }
```

```json
{ "code": 200, "data": { "answer": "请先发送“随机一题”开始" }, "message": "" }
```

### 错误响应

| code | 场景 | message |
|------|------|---------|
| 400 | message 为空 / 请求体含白名单外键 | `message 不能为空` / `请求体只支持 message、sessionId 字段，收到无效字段：<键名>` |
| 413 | message 超过 300 字符 | `消息不能超过 300 字符` |
| 503 | **fengyunsanguo（quiz server）缺配 / 不可用**：`MCP_FENGYUNSANGUO_SCRIPT` 未配置、子进程启动失败 / 退出、协议错误、`quiz_command` 返回 `isError` | `工具服务暂不可用，请稍后重试` |
| 500 | 其余未预期异常（兜底） | `处理请求失败，请稍后重试` |

- 503 是本次为该端点新增的失败模式（现状本地实现无 503）；除 quiz 能力外其余功能不受影响。

## 503 统一说明

| 端点 | 触发条件 | 响应 |
|------|----------|------|
| /api/sango/random | fengyunsanguo 缺配 / 未连接 / 子进程退出 / 协议错误 / quiz_command isError | `{ "code": 503, "data": null, "message": "工具服务暂不可用，请稍后重试" }` |
| /api/chat | 模型调任一 MCP 工具失败（fengyunsanguo_query / sango_novel_search / get-forecast / get-alerts） | 同上 |
| /api/tools | 工具列表获取失败（server 均不可用） | `{ "code": 503, "data": null, "message": "MCP Server 未连接" }` |

503 仍按错误类型判定（`ToolExecutionError`），不由请求字段反推（沿用 A003 约定）。

## GET /api/tools（来源变化：总台无本地工具）

`/api/tools` 上报模型实际可见的工具 = 三个 MCP server 上报工具合并，**orchestrator 不再内置任何本地工具**：`sango_query` 移除，由 `fengyunsanguo_query` 承接（来源从本地变 MCP）。

```json
{
  "code": 200,
  "data": {
    "tools": [
      { "name": "get-alerts", "description": "获取美国某个州的当前天气预警（数据源：美国国家气象局 NWS）……" },
      { "name": "get-forecast", "description": "获取美国境内某个经纬度位置的天气预报（数据源：美国国家气象局 NWS）……" },
      { "name": "fengyunsanguo_query", "description": "风云三国题库检索：仅当用户询问风云三国游戏内招募武将问答题时调用；参数 text 传用户原始问法，limit 为候选条数上限（默认 1），返回候选题目（题干 → 答案）" },
      { "name": "sango_novel_search", "description": "《三国演义》原著检索：仅当用户询问《三国演义》原著情节、人物、事件时调用……" }
    ]
  },
  "message": ""
}
```

| 工具 | 来源 | 状态 |
|------|------|------|
| get-forecast / get-alerts | MCP server `weather` | 不变 |
| fengyunsanguo_query | MCP server `fengyunsanguo`（原本地工具 sango_query 迁移） | 新增 |
| sango_novel_search | MCP server `sango` | 不变 |
| fengyunsanguo_quiz_command / fengyunsanguo_quiz_route | MCP server `fengyunsanguo` | **不进 /api/tools**（orchestrator 内部调用 / L3 路由，模型不可见） |

- 响应结构不变（`name` / `description` / `inputSchema`，`inputSchema` 随 MCP 原样返回）；顺序不保证。
- 失败：`{ "code": 503, "data": null, "message": "MCP Server 未连接" }`。

## 破坏性变更与两端同发（mcp-web）

| 层 | 变更 | 影响 |
|----|------|------|
| HTTP /api/chat | domain 白名单 `['sango','sango-novel']` → `['fengyunsanguo','sango-novel']`；旧值 `sango` 返回 400 | **破坏性**；orchestrator 与 mcp-web 必须同发 |
| HTTP /api/tools | 移除本地工具 `sango_query`，新增 MCP 工具 `fengyunsanguo_query` | 工具列表变化；若前端展示工具列表需同步文案 |
| HTTP /api/sango/random | 内部改调 `fengyunsanguo_quiz_command`；新增 503（quiz server 缺配 / 不可用） | HTTP 契约不变；失败模式新增 |
| mcp-server | 新增独立 server `fengyunsanguo`（三工具，stdio 子进程） | weather / sango 两个既有 server 不动，无破坏 |
| mcp-orchestrator | 注册表新增 `MCP_FENGYUNSANGUO_SCRIPT`（可选）；总台去除本地题库逻辑 | 部署配置变化；weather 仍必需 |

**同发约束**：orchestrator 与 mcp-web 必须同一发布窗口上线，无兼容期（不双白名单、不双前端判定）：

- 后端先行 → 旧前端 `domain=sango` 请求全部 400；
- 前端先行 → 新 `domain=fengyunsanguo` 被旧白名单打回 400。

**mcp-web 改动点（小叶）：**

- `mcp-web/src/api/client.ts`：`sendChatMessage` 的 `domain` 参数类型 `"sango" | "sango-novel"` → `"fengyunsanguo" | "sango-novel"`；`sendSangoRandom` 不动（`/api/sango/random` 路径与参数不变）。
- `mcp-web/src/stores/chat.ts`：`ChatMode` 中 `'sango'` 成员 → `'fengyunsanguo'`；`mode === 'sango'` / `!== 'sango'` 判定与 `sendChatMessage(trimmed, "sango")` → `"fengyunsanguo"`。
- `mcp-web/src/views/WeatherView.vue`：所有 `mode === 'sango'` / `setMode('sango')` 判定同步为 `'fengyunsanguo'`（`sangoPanelOpen`、服务选择守卫、模式标签逻辑、输入区标识等）；「风云三国」标签文案保留，仅 domain 值变化；随机一题按钮仍走 `sendSangoRandom`。
- 演义侧（`sango-novel` 标签、`sendChatMessage(trimmed, "sango-novel")`）与天气侧不动。

## orchestrator 落点（实现故事）

- `server.ts`：`CHAT_ALLOWED_DOMAINS` = `['fengyunsanguo','sango-novel']`，校验 message 文案同步；`/api/sango/random` handler 改调 transport 的 `fengyunsanguo_quiz_command` 并解包 `content[0].text`；信封 / 串行队列 / sessionId 透传不变。
- `index.ts`：移除本地 `SANGO_QUERY_TOOL` 与 `localTools`；Agent 工具集 = 三个 MCP server 合并；L3 matcher 改调 `fengyunsanguo_quiz_route`。
- `.env`：新增 `MCP_FENGYUNSANGUO_SCRIPT`（可选）；`MCP_WEATHER_SCRIPT` 仍必填，`MCP_SANGO_SCRIPT` 不变。
- 会话状态不再存 orchestrator 内存（随机一题会话迁出；知识问答召回逻辑迁入 fengyunsanguo server）。

## 验收标准对照

| # | 验收标准 | 契约落点 |
|---|----------|----------|
| ① | fengyunsanguo_query 候选召回：text + limit（默认 1、范围 1–8） | 「工具契约 · 1」 |
| ② | quiz_command 随机一题状态机，输出文案与现状一致，会话 TTL 30min、重启即清 | 「工具契约 · 2」 |
| ③ | quiz_route L3 高置信识别，语义对齐 isHighConfidenceSangoQuery，不进 /api/tools | 「工具契约 · 3」 |
| ④ | /api/chat domain 新白名单；sango → 400 且文案同步 | 「POST /api/chat」 |
| ⑤ | /api/sango/random 信封 / 串行队列 / sessionId 语义不变，内部走 quiz_command | 「POST /api/sango/random」 |
| ⑥ | quiz server 缺配 / 不可用 → 503，其余功能正常 | 「503 统一说明」+ 破坏性变更表 |
| ⑦ | /api/tools 无本地工具，含 fengyunsanguo_query / sango_novel_search / get-forecast / get-alerts | 「GET /api/tools」 |
| ⑧ | 两端同发；mcp-web 三文件 domain 判定同步 | 「破坏性变更与两端同发」 |
| ⑨ | 全部响应统一信封 `{ code, data, message }` | 全部示例 |
