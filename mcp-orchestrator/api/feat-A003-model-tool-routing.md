# 统一对话入口（POST /api/chat）+ 随机一题（POST /api/sango/random）+ GET /api/tools

> 作者：老陈
> 对应特性号：feat-A003
> 涉及项目：mcp-orchestrator（server.ts / index.ts / cli.ts）、mcp-server（工具描述）、mcp-web（小叶对接）
> 日期：2026-09-15

## 概述

对话侧只保留一个统一 Agent：工具集 = MCP 天气工具（`get-forecast` / `get-alerts`）+ 本地题库工具 `sango_query`，调不调、调哪个由模型按语义自主决定，HTTP 层不再出现 `scenario` / `service` 等业务概念。`POST /api/chat` 请求体只接受 `message`；确定性命令「随机一题」拆到 `POST /api/sango/random`（本地规则，不经 LLM）。`GET /api/tools` 改为上报模型实际可见的全部工具（含 `sango_query`）。响应 `data` 结构不变（仍为 `{ answer }`），不新增响应字段；全部接口沿用 `{ code, data, message }` 信封（见 `mcp-orchestrator/api/response-convention.md`）。

**破坏性变更**：旧字段 `scenario` / `service` 一律 400，前后端必须同时上线，无灰度。

## 请求

### POST /api/chat

| 属性 | 值 |
|------|-----|
| 方法 | POST |
| 路径 | /api/chat |
| Content-Type | application/json |

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| message | string | 是 | 用户输入，trim 后非空、原始长度 ≤300 字符 |

请求体严格白名单：只允许 `message`。出现任何其他键（含 `scenario` / `service` / `sessionId`）→ 400。

### POST /api/sango/random

| 属性 | 值 |
|------|-----|
| 方法 | POST |
| 路径 | /api/sango/random |
| Content-Type | application/json |

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| message | string | 是 | 随机一题指令 / 作答内容 / 查答案指令，规则同 /api/chat |
| sessionId | string | 否 | 判题会话标识，前端用 UUID 生成，同一轮出题—作答期间保持不变 |

白名单为 `{ message, sessionId }`。`sessionId` 非字符串或 trim 后为空 → 视为未传（等价无会话）。后端不返回、不下发 sessionId。

### GET /api/tools

无请求参数。返回统一 Agent 实际可见的工具列表（MCP 工具 + 本地工具）。

### 请求示例

```json
{ "message": "纽约今天适合坐地铁出门吗？" }
{ "message": "夏侯惇的字是什么？" }
{ "message": "随机一题", "sessionId": "8f4b0e2a-..." }
{ "message": "A", "sessionId": "8f4b0e2a-..." }
```

## 路由归属（模型自主决定，不由请求字段决定）

| 用户输入语义 | 期望行为 | 验收 |
|--------------|----------|------|
| 美国天气 / 地铁出行 | 调 `get-forecast` / `get-alerts`，按天气播报格式作答 | ① |
| 题库内三国题目（问法与题干不同、含义相同） | 调 `sango_query`，答案取题库原文 | ② |
| 语义指向三国但题库未收录 | 固定回复「题库未收录该题，请换个问法」，不用题库外知识 | ③ |
| 涉及天气但非美国地区（如「北京今天天气」） | 不调天气工具，明确告知仅支持美国天气，不编造数据 | ④ |
| 其余问题（含「你好」） | 不调任何工具，自由作答，不套天气 / 题库模板 | ⑤ |

以上在**不传任何路由字段**时全部成立（⑥，请求体本来也没有路由字段可传）。「随机一题」类指令不走 /api/chat，走 /api/sango/random。

## 随机一题指令表（POST /api/sango/random，沿用 feat-A002）

| 输入 | 行为 |
|------|------|
| “随机一题” / “来一题” | 随机返回一题 + A-D 选项（不含答案），记为当前题 |
| 选项字母（A/a/ａ）或选项文本 | 判定对错，答错附正确答案 |
| “答案” / “这题选什么” | 返回当前题正确答案 |
| 无有效会话时作答 | 返回“请先发送‘随机一题’开始”提示 |
| 会话过期（TTL 30 分钟） | 视同无会话，返回同上提示 |
| 题库为空 | 返回“题库为空，暂时无法出题” |

行为与 feat-A002 的 `scenario=sango & service=random` 完全一致：本地 `SangoService` 规则出题 / 判题 / 查答案，不经 LLM、不经 MCP（⑨）。指令识别顺序不变：随机一题 → 查答案 → 判题 → 无会话提示。会话仍为进程内 `Map<sessionId, { question, createdAt }>`，重启清空。

## 响应

### 成功响应 (200)

`data` 结构不变，前端 `ChatData` 可复用：

| 字段 | 类型 | 说明 |
|------|------|------|
| answer | string | 纯文本回复，选项分行展示 |

POST /api/chat（①–⑤ 各域示例）：

```json
{ "code": 200, "data": { "answer": "9 月 16 日纽约晴，24℃，适合出行。出门必备：手机、乘车码、证件、钥匙" }, "message": "" }
{ "code": 200, "data": { "answer": "元让" }, "message": "" }
{ "code": 200, "data": { "answer": "题库未收录该题，请换个问法" }, "message": "" }
{ "code": 200, "data": { "answer": "天气数据仅覆盖美国境内，暂不支持北京的天气查询。" }, "message": "" }
{ "code": 200, "data": { "answer": "你好，有什么可以帮你的？" }, "message": "" }
```

POST /api/sango/random：

```json
{ "code": 200, "data": { "answer": "题目：夏侯惇的字是什么？\nA. 元让\nB. 妙才\nC. 子龙\nD. 云长" }, "message": "" }
{ "code": 200, "data": { "answer": "答对了！正确答案：元让（A）" }, "message": "" }
{ "code": 200, "data": { "answer": "答错了，正确答案：元让（A）" }, "message": "" }
{ "code": 200, "data": { "answer": "正确答案：元让（A）" }, "message": "" }
{ "code": 200, "data": { "answer": "请先发送“随机一题”开始" }, "message": "" }
```

GET /api/tools：

| 字段 | 类型 | 说明 |
|------|------|------|
| tools | array | 模型实际可见的工具，元素结构不变：`name` / `description` / `inputSchema` |

```json
{
  "code": 200,
  "data": {
    "tools": [
      { "name": "get-alerts", "description": "获取美国某个州的当前天气预警……", "inputSchema": { "type": "object" } },
      { "name": "get-forecast", "description": "获取美国境内某个经纬度位置的天气预报……", "inputSchema": { "type": "object" } },
      { "name": "sango_query", "description": "风云三国题库检索：仅当用户询问风云三国游戏内招募武将问答题时调用……", "inputSchema": { "type": "object", "properties": { "text": { "type": "string" } } } }
    ]
  },
  "message": ""
}
```

示例中 `inputSchema` 已截断；MCP 工具的实际 schema 由 mcp-server 决定（本期不动）。MCP 工具在前、`sango_query` 在后只是 index.ts 的拼接顺序，前端不要依赖顺序（⑧）。

### 错误响应

失败一律 `{ code, data: null, message }`，`message` 前端可直接展示（⑩）。

| 端点 | code | 触发条件 | message（原文） |
|------|------|----------|-----------------|
| /api/chat | 400 | 请求体出现 `message` 以外的键 | 请求体只支持 message 字段，收到无效字段：scenario |
| /api/sango/random | 400 | 请求体出现 `message` / `sessionId` 以外的键 | 请求体只支持 message、sessionId 字段，收到无效字段：service |
| 两个 POST | 400 | `message` 非字符串，或 trim 后为空 | message 不能为空 |
| 两个 POST | 413 | `message.length > 300`（原始长度，沿用 A002 判定） | 消息不能超过 300 字符 |
| /api/chat | 503 | 捕获到 `ToolExecutionError`（MCP 工具调用失败：未连接 / 子进程退出 / 协议错误） | 工具服务暂不可用，请稍后重试 |
| /api/chat | 500 | 其余异常（LLM 调用失败、`sango_query` 本地工具失败、未预期错误） | 处理请求失败，请稍后重试 |
| /api/sango/random | 500 | 本地规则执行异常（不依赖 MCP，本端点没有 503） | 处理请求失败，请稍后重试 |
| /api/tools | 503 | `Agent.listTools()` 抛错（Agent 未注入 tools 时透传 transport 错误） | MCP Server 未连接 |

- 无效字段有多个时全部列出，按请求体键出现顺序（`Object.keys` 顺序）以「、」分隔：`请求体只支持 message 字段，收到无效字段：scenario、service`
- 503 判定改为按错误类型，不再由 `scenario === 'weather'` 反推；server.ts 不解析 `error.message`、不按工具名分支，内部错误详情与堆栈不外泄（沿用 feat-A001 约定）
- 非美国坐标**不是错误**：`get-forecast` 对非美国坐标返回英文说明文本（正常工具结果，不抛异常），不会落 503；④ 由工具描述 + 统一提示词在调用前拦下
- A002 的 `scenario 不合法` / `service 不合法` / `天气服务暂不可用` 三条随字段与反推逻辑一并删除
- feat-A001 定义的 401 / 408 细分在 orchestrator 侧至今未实现（现状落 500），本期不扩大范围

## 校验规则

- 白名单：/api/chat = `{ message }`；/api/sango/random = `{ message, sessionId }`。按「键是否存在」判定（`Object.keys`），值为 `null` / 空串同样算出现该键
- 校验顺序：白名单 → message 非空 → message 长度 → sessionId 归一化；任一步失败立即返回，不入队、不触达 Agent
- `message`：`typeof !== 'string' || !message.trim()` → 400；`message.length > 300` → 413（原始长度判定，下游收到 trim 后的值）
- `sessionId`：仅 `typeof === 'string' && trim() !== ''` 时生效，取 trim 值传给 `handleRandom`；否则传 `undefined`
- 队列：两个 POST 端点共用同一条串行队列（`requestQueue`），避免 LLM 调用与会话读写并发；代价是随机一题会排在慢的 LLM 请求之后
- 现状说明（本期不改，与 A002 一致）：非法 JSON、body 超 32kb、未匹配路由由 `express.json` / Express 默认错误处理返回，不是信封格式

## mcp-server 工具描述变更（新旧对照）

文件：`mcp-server/src/weather/index.js`。**只改 `registerTool` 的 `description` 字段**；`inputSchema`、Zod `describe` 文案、实现逻辑与返回文本全部不动。

| 工具 | 旧描述 | 新描述 |
|------|--------|--------|
| `get-alerts` | 获取某个州的天气预警 | 获取美国某个州的当前天气预警（数据源：美国国家气象局 NWS）。仅覆盖美国境内，state 必须是美国两字母州代码；非美国地区不要调用本工具。 |
| `get-forecast` | 获取某个位置的天气预报 | 获取美国境内某个经纬度位置的天气预报（数据源：美国国家气象局 NWS）。仅覆盖美国境内；非美国地区（如中国北京）不要调用本工具，应直接告知用户仅支持美国天气，不要编造数据。 |

理由：NWS 只覆盖美国，非美国坐标当前拿到的是一段英文 “only US locations are supported”，且它是**正常工具结果不是异常**，模型看不到边界就会无谓调用、输出中英混杂。描述写清覆盖范围后，④ 在调用前就被拦下。该改动同时影响 feat-A001 的天气场景（描述只影响模型选择、不影响调用结果），需回归验证。

## 技术要点（老陈技术方案合并在此）

### server.ts

- 签名变更：`createServer(agent: Agent, sangoService: SangoService, options: { port: number; allowedOrigin: string })`
- 删除 `ServerAgents` 接口与 `SCENARIOS` 常量，scenario / service 分发 if 链整块移除，不留孤儿代码
- 新增两个模块内私有校验函数，两个 POST 端点共用：`findInvalidKeys(body, allowedKeys)` 与 `validateMessage(message)`（返回 400 / 413 的 code + 文案）
- `/api/chat` → `agent.processQuery(message.trim())`；`/api/sango/random` → `sangoService.handleRandom(message.trim(), sessionId)`
- 错误判定链路（替代 scenario 反推）：

  ```ts
  } catch (error) {
    const isToolDown = error instanceof ToolExecutionError;
    const status = isToolDown ? 503 : 500;
    // message: 工具服务暂不可用，请稍后重试 / 处理请求失败，请稍后重试
  }
  ```

- `/api/tools` → `await agent.listTools()`，catch 仍返回 503「MCP Server 未连接」（Agent 注入 tools 后该分支实际不可达，保留作为默认配置路径的兜底）
- 中间件不变：`cors(origin)` + `express.json({ limit: '32kb' })`；`/health` 不动

### index.ts

- 启动时 `const mcpTools = await transport.listTools()`，与本地工具定义合成 `const tools = [...mcpTools, SANGO_QUERY_TOOL]`
- 构造单个 Agent：`new Agent(transport, llmConfig, { systemPrompt: UNIFIED_SYSTEM_PROMPT, tools, localTools: { sango_query } })`；`sango_query` handler 仍调 `sangoService.candidates(text)` 拼「题干 → 答案」，无候选返回「未召回到任何候选题目」
- `SANGO_QUERY_TOOL.description` 本期同步收紧适用域（/api/tools 会原样上报）：
  - 旧：`风云三国知识问答：按用户原始问法召回候选题目（题干 → 答案）`
  - 新：`风云三国题库检索：仅当用户询问风云三国游戏内招募武将问答题时调用；参数 text 传用户原始问法，返回候选题目（题干 → 答案）`
- 不再 import `GENERAL_SYSTEM_PROMPT` / `SANGO_KNOWLEDGE_SYSTEM_PROMPT`，不再构造三个 Agent；LLM 配置仍在启动时从环境变量读取

### cli.ts

- 保持 `new Agent(transport, llmConfig)`：不注入 tools → 工具集 = MCP 工具（无 `sango_query`），systemPrompt 取 agent.ts 默认值（即 `UNIFIED_SYSTEM_PROMPT`）
- 边界：CLI 是开发调试入口，不是验收路径——无 HTTP、无信封、无 /api/sango/random；题库问答在 CLI 下不可用（模型即使想调 `sango_query` 也没有该工具）

### 与小胡的接口边界（agent.ts / types.ts）

| 契约 | 写在哪里 | 谁写 | 老陈的依赖方式 |
|------|----------|------|----------------|
| `UNIFIED_SYSTEM_PROMPT` | `src/agent.ts` 导出常量，并作为 Agent 未传 systemPrompt 时的默认值 | 小胡 | index.ts import 后作为 systemPrompt 传入；cli.ts 依赖其默认值；老陈不复制提示词文本 |
| `Agent.listTools()` | `src/agent.ts`，改为 `return this.options.tools ?? (await this.transport.listTools())` | 小胡 | server.ts 的 /api/tools 直接调用；必须与 `processQuery` 内的 `availableTools` 同源，避免「上报的能力」与「模型可见的能力」漂移 |
| `ToolExecutionError` | `src/types.ts` 导出 `class ToolExecutionError extends Error`，携带 `readonly toolName: string` | 类定义老陈出（server.ts 要 import 判定），抛出点小胡写 | server.ts `instanceof` 判定 → 503 |

- 抛出点：agent.ts 的 tool-use 循环里 `await this.transport.callTool(...)` 失败时包装成 `ToolExecutionError(toolName, cause)`；`localTools`（`sango_query`）失败**不包装**，原样向上抛 → 落 500
- agent.ts 不得在内部 catch 后把错误转成文本喂回模型，否则会吞掉 503 判定
- 统一提示词需覆盖的兜底分域（属 prompt 措辞，server.ts 不得出现对应 if-else）：先判断是否命中专用能力 → 命中则调用；否则按域兜底——美国天气走工具、三国未收录固定话术、非美国天气明确告知不支持、其余自由作答。天气播报格式块与题库规则块沿用 A002 已验证原文，避免格式回归
- 旧常量 `DEFAULT_SYSTEM_PROMPT` / `GENERAL_SYSTEM_PROMPT` / `SANGO_KNOWLEDGE_SYSTEM_PROMPT` 的去留由小胡在 agent.ts / sango.ts 内处理（避免孤儿代码）；老陈侧只保证 index.ts / cli.ts 不再引用
- 测试分工：老陈用 mock transport 记录实际调用的工具名断言路由结果，并覆盖白名单 / 400 / 413 / 503 / 500 / 队列串行（`src/test/feat-A003/`）；小胡用 `AgentOptions.modelCaller` 注入伪造 `tool_use` 覆盖「调了某工具该走什么格式」

### 与小叶的接口边界（mcp-web）

- `/api/chat` 只发 `{ message }`：`src/api/client.ts` 删除 `scenario` / `service` / `sessionId` 组装，`src/stores/chat.ts` 的 `mode` / `sangoService` 降级为纯前端 UX（标签保留用于能力可发现性与后续模板挂靠，默认不选标签，不改请求体）
- 「随机一题」标签下的输入发 `POST /api/sango/random`，body `{ message, sessionId }`；`sessionId` 由前端 UUID 生成，在同一轮出题—作答—查答案期间保持不变，切换标签或新开会话时重新生成
- 其余标签（天气 / 问题查询）一律发 `/api/chat` 且不带任何附加字段——带了就是 400
- 响应处理不变：`res.code === 200` 用 `res.data.answer`，否则展示 `res.message`；`data` 无新增字段
- `/api/tools` 现在含 `sango_query`，前端若展示工具列表按 `name` 自行过滤或原样展示（顺序不保证）
- 上线顺序：前后端同时发布（旧字段 400，无灰度、不能分段发版）

## 验收标准对照

| # | 验收标准 | 契约落点 |
|---|----------|----------|
| ① | 美国天气 → 调天气工具 | 「路由归属」表 + 统一提示词（小胡）+ 老陈 mock transport 断言工具名 |
| ② | 题库内三国题 → 调 `sango_query` | 「路由归属」表 + `sango_query` 描述收紧 + /api/tools 可见 |
| ③ | 题库未收录 → 固定话术 | 「路由归属」表 + 统一提示词沿用 A002 第 4 条原文 |
| ④ | 非美国天气 → 不调工具且明确告知 | mcp-server 新描述（本节新旧对照）+ 统一提示词兜底分域 |
| ⑤ | 其余问题 → 不调工具自由作答 | 「路由归属」表 + 统一提示词 |
| ⑥ | 不传路由字段时 ①–⑤ 成立 | /api/chat 白名单只有 `message`，结构上无路由字段可传 |
| ⑦ | 携带 `scenario` / `service` → 400 | 错误响应表第 1、2 行 + 「校验规则」白名单与顺序 |
| ⑧ | /api/tools 含本地工具 | GET /api/tools 成功响应示例 + `Agent.listTools()` 契约 |
| ⑨ | /api/sango/random 与 A002 一致 | 「随机一题指令表」原样沿用 + `SangoService.handleRandom` 不改 |
| ⑩ | 统一信封 | 全部成功 / 错误示例均为 `{ code, data, message }`，失败 `data` 为 `null` |
