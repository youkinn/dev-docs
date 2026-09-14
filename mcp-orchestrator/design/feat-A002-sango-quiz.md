# feat-A002 风云三国知识问答：Agent 编排层扩展（小胡）

## 背景
A001 Agent 只支持「transport 提供工具 → 远端调用」单一链路。A002 需要：general 场景无工具、知识问答走本地函数（不经过 MCP server），故 Agent 构造函数升级为 options 对象，并保持 A001 调用兼容。

## 方案
1. 构造函数第 3 参 `options?: AgentOptions | string`：`{ systemPrompt?, tools?, localTools?, modelCaller? }`；传字符串按旧签名视为 systemPrompt，`undefined` 时行为与 A001 完全一致。
2. 工具列表：`options.tools !== undefined` 时直接用（general 传 `[]`），否则维持 `transport.listTools()`（weather 链路不变）。用 `!== undefined` 而非 `??`，保证空数组能覆盖远端列表。
3. tool-use 路由：命中 `localTools[toolName]` 直调本地函数（返回 `ToolCallResult`），未命中回退 `transport.callTool`；OpenAI（tool 消息）与 Anthropic（tool_result 消息）回填共用既有代码，零分叉。
4. 知识问答 system prompt（`SANGO_KNOWLEDGE_SYSTEM_PROMPT`，实现位置由 agent.ts 移到 sango.ts）：强制调用 `sango_query(text=用户原问)` 取回候选；LLM 先理解问法含义，再判定候选中的对应题，只输出该题答案原文；候选中无对应题时回复「题库未收录该题，请换个问法」。答案只取题库原文，禁止编造。
5. 可测性：options 注入 `modelCaller`（默认走 `callModel` 现实现，不注入零行为差异）+ `callModel` 改 protected，测试零网络、零新依赖（node:test）。
6. 知识问答按「召回 + 判定」分层（本版修订）：`SangoService.candidates(text, limit=8)` 用字符 bigram 重合度（Dice 系数）召回 Top-K 候选，`sango_query` 工具只返回候选清单（序号. 题干 → 答案），不返回唯一答案；是否含义对应由 LLM 判定。召回不做判定、LLM 不生成答案。原「全量题库注入 prompt」方案已废弃：每请求 token 随题库线性增长，不可持续。

## 验收
- `npm run build` 通过
- `node --test build/agent.test.js build/sango.test.js`：27 用例全部通过（agent 向后兼容 / 本地工具命中与回退 / 候选召回 / prompt 规则 / server 分发 / 随机一题链路）

## 影响面
- `src/sango.ts` + `src/sango.test.ts`：题库加载、候选召回 `candidates`、知识问答 prompt
- `src/index.ts`：sango 场景装配 `{ systemPrompt: SANGO_KNOWLEDGE_SYSTEM_PROMPT, tools: [sango_query], localTools: { sango_query } }`
- `src/agent.ts` + `src/agent.test.ts`：options 扩展与 `localTools` 路由，本版未改动
- server/transport/types/data 不动

## 修订记录
- 2026-09-14：知识问答由「全量题库注入 prompt」改为「本地 bigram 召回 Top-K + LLM 语义判定」；`SANGO_KNOWLEDGE_SYSTEM_PROMPT` 移入 sango.ts；删除无调用方的 `SangoService.search()`。
