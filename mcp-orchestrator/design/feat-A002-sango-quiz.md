# feat-A002 风云三国知识问答：Agent 编排层扩展（小胡）

## 背景
A001 Agent 只支持「transport 提供工具 → 远端调用」单一链路。A002 需要：general 场景无工具、知识问答走本地函数（不经过 MCP server），故 Agent 构造函数升级为 options 对象，并保持 A001 调用兼容。

## 方案
1. 构造函数第 3 参 `options?: AgentOptions | string`：`{ systemPrompt?, tools?, localTools?, modelCaller? }`；传字符串按旧签名视为 systemPrompt，`undefined` 时行为与 A001 完全一致。
2. 工具列表：`options.tools !== undefined` 时直接用（general 传 `[]`），否则维持 `transport.listTools()`（weather 链路不变）。用 `!== undefined` 而非 `??`，保证空数组能覆盖远端列表。
3. tool-use 路由：命中 `localTools[toolName]` 直调本地函数（返回 `ToolCallResult`），未命中回退 `transport.callTool`；OpenAI（tool 消息）与 Anthropic（tool_result 消息）回填共用既有代码，零分叉。
4. 导出 `SANGO_KNOWLEDGE_SYSTEM_PROMPT`（单行、结论优先）：强制调用 `sango_query(text=用户原问)`、只输出题干+答案、`hit=false` 时回复「题库未收录该题，请换个问法」。由外层在 sango 场景选用，default 提示不动。
5. 可测性：options 注入 `modelCaller`（默认走 `callModel` 现实现，不注入零行为差异）+ `callModel` 改 protected，测试零网络、零新依赖（node:test）。

## 验收
- `npm run build` 通过
- `node --test build/agent.test.js`：6 用例覆盖 general 零工具 / 本地命中（双 provider 回填格式）/ 本地未命中回退（天气回归）/ prompt 常量 / 向后兼容

## 影响面
仅 `src/agent.ts` + `src/agent.test.ts`；server/transport/types/index/sango/data 不动；外层（server 路由层）按需传 `{ tools: [], localTools: { sango_query }, systemPrompt: SANGO_KNOWLEDGE_SYSTEM_PROMPT }`。