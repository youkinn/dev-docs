# feat-A003 统一路由提示词与 Agent 契约（小胡）

> 作者：小胡
> 对应特性号：feat-A003
> 日期：2026-09-15

> **演进注记（feat-A005，2026-09-20）**：`sango_query` 本地工具已由 MCP `fengyunsanguo_query` 承接（题库迁入 `mcp-server/fengyunsanguo/`；domain `sango` → `fengyunsanguo`；总台无本地工具，快路径经 MCP 转发）。本文为 A003 时点设计记录。

## 涉及文件

| 文件 | 操作 | 说明 |
|------|------|------|
| src/agent.ts | 改 | 新增导出 `UNIFIED_SYSTEM_PROMPT` 并作为未传 systemPrompt 时的默认值；删除孤儿常量 `DEFAULT_SYSTEM_PROMPT` / `GENERAL_SYSTEM_PROMPT`；`listTools()` 与 `processQuery` 的 `availableTools` 同源；MCP 工具失败包装 `ToolExecutionError` |
| src/sango.ts | 改 | 只删 `SANGO_KNOWLEDGE_SYSTEM_PROMPT`（规则并入统一提示词），SangoService 加载 / 召回 / 判题 / 会话逻辑不动 |
| src/index.ts | 改 | 装配处把临时注释换成显式 `systemPrompt: UNIFIED_SYSTEM_PROMPT`（接线，逻辑不动） |
| src/test/feat-A003/agent-routing.test.ts | 新增 | 16 用例：提示词内容与次序 / 默认值 / 工具同源 / 错误包装 / tool-use 路由 |
| src/test/feat-A002/agent.test.ts | 改 | 默认提示词断言由 `/地铁通勤天气助手/` 改为 `=== UNIFIED_SYSTEM_PROMPT` |
| src/test/feat-A002/sango.test.ts | 改 | 删 `SANGO_KNOWLEDGE_SYSTEM_PROMPT` 用例及其 import，其余用例不动 |

## 核心流程

```
POST /api/chat { message } → server.ts（无业务 if-else）→ Agent.processQuery
  system prompt = UNIFIED_SYSTEM_PROMPT
  tools = options.tools = [get-forecast, get-alerts, sango_query]（= listTools() 上报的列表）
  ↓ 模型按提示词「判断次序」自主决定调不调、调哪个
  ├ 命中题库域 → tool_use sango_query → localTools（不经 MCP）→ 只输出答案原文；候选无对应题 → 固定话术
  ├ 命中美国天气域 → tool_use get-forecast / get-alerts → transport.callTool → 按 5 条格式播报
  └ 未命中 → 不调工具，按分域兜底（非美国天气明确告知不支持 / 其余自由作答）

  transport.callTool 失败 → ToolExecutionError(toolName, { cause }) → server 判 503
  localTools 失败 → 原样上抛（不包装）→ server 判 500
```

## 选型 & 注意

- 提示词 5 段：身份与总原则 → 能力清单（每项写「什么时候调 + 调了之后怎么答」）→ 判断次序（自上而下、命中即停）→ 分域兜底 → 输出格式约束。分域规则全部落在提示词里，server.ts 无需任何配合判定，也不存在「若请求带某字段」的措辞。
- 天气 5 条格式规则、题库 5 条规则**逐字沿用 A002 原文**（已脚本比对 10 行完全一致），只改「什么时候适用」：天气能力显式限定「仅适用于美国境内」，题库能力限定「仅限风云三国游戏内的招募武将问答题」，避免普通三国常识误调 `sango_query`。
- 兜底不做成笼统的「否则自由回答」，而是三条并列分域：题库未收录 → 固定话术；非美国天气 → 明确告知仅支持美国境内、严禁编造温度 / 降水 / 预警数值；其余（含「你好」）→ 自由作答且不套天气格式与题库话术。
- `listTools()` 与 `availableTools` 统一用 `this.options.tools ?? (await this.transport.listTools())` 同一表达式（A002 的 `!== undefined ? :` 三元等价收敛为 `??`，空数组仍能覆盖远端列表），杜绝「上报能力 ≠ 模型可见能力」漂移（验收 ⑧）。
- 错误包装只集中在私有 `callTransportTool` 一处，`cause` 透传；**绝不 catch 后转成文本喂回模型**，否则 server 的 503 判定被吞。
- CLI 不注入 tools → 工具集只有 MCP 工具（无 `sango_query`），提示词走默认值即统一版；CLI 非验收路径。
- 非目标：不改 transport.ts、题库文件与召回算法，不引入多轮记忆，tool-use 循环路由逻辑不动。

## 验收

- `npm run build` 通过（TypeScript 严格模式）
- `node --test "build/test/feat-A002/*.test.js" "build/test/feat-A003/*.test.js"`：53 用例全绿（老陈 38 → 删 1 个 A002 提示词用例 = 37，小胡新增 16）
- 全部用 mock（`modelCaller` 注入伪造 `tool_use` + MockTransport），零网络、不调真实 LLM、不启服务
- 覆盖验收标准 ①②③④⑤（提示词分域与工具调用）与 ⑧（`listTools()` 含 `sango_query` 且与模型可见列表一致）
