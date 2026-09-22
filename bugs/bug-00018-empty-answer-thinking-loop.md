# bug-00018：域锁定生成轮返回空答案（思考模型推理不收敛 + 空答案当成功直通 200）

> Bug 号：bug-00018
> 状态：修复中（2026-09-22 负责人已验收；本地提交 `6361974`，待推送 + 发起 PR 合并——`github.com:443` 连不通，按约定搁置重试）
> 关联特性：feat-A011（提测验收中发现；**非 A011 引入**，改动前已有同类偶发）
> 涉及项目：mcp-orchestrator
> 登记：Coco ／ 报告：负责人 ／ 登记日期：2026-09-22

## 现象

```
POST /api/chat  {"message":"虎牢关之战","domain":"sango-novel"}
→ 200 {"code":200,"data":{"answer":"","citations":[]},"message":""}
```

traceId `80544fe4-2835-484f-9f04-c49678a8f6cc`：`request_logs.status=success`、`response_code=200`、`answer=""`、`citations=[]`；`llm_call_logs` 仅 1 条（`stage=generation`、`prompt_tokens=1869`、`completion_tokens=1000`、`finish_reason=length`、`response_summary=[]`）；`tool_call_logs` 检索成功（`sango_novel_search`，出参 4813 字符），即**检索有命中、注入也进了上下文，只是生成轮没吐出正文**。

## 根因

三层叠加，缺一层都不至于空答案：

1. **`max_tokens` 与思考预算共享**：模型 `deepseek-v4-1-flash-260901`（火山方舟 plan 端点）是思考模型，`usage.completion_tokens_details.reasoning_tokens` 计入 `completion_tokens`；`src/agent.ts:344` 的 `max_tokens: 1000` 同时约束「思考 + 正文」。
2. **该输入下推理不收敛**：把预算放大到 3000 仍是 `finish_reason=length`、3000 全记在 `reasoning_tokens`、`content` 仍为 `""` → **不是预算不够，是这一输入下思考不收敛**。推理尾部是模型在反复自我校验指针口径（「规则2：引语输出 [Qn]…可以…但规则…可以」），问句「虎牢关之战」是整回目级宽问题、无单一引语可指，指针决策无解 → 死循环。
3. **空答案被当成功直通**：`callModel` 不看 `finish_reason`、也不看 `content` 是否为空（`src/agent.ts:406` 恒记 `status: "success"`）；`processQueryData`（`src/agent.ts:856`）拿到空 `answer` 后进 `applyNovelCitationGuard`，因「片段非空 + 空答案不含人名/指针/按原文」判定 `isNovelAnswer=false`（`src/agent.ts:599`），走**软性域直通分支**原样返回（`src/agent.ts:604`），空串绕过 `NOVEL_NO_HIT_ANSWER` 兜底 → 200 空答案。

## 复现数据（2026-09-22 实测）

`llm_call_logs.request_summary` 无截断，可原样重放同一请求：

| 探针 | finish_reason | completion_tokens | reasoning_tokens | content |
|------|---------------|-------------------|------------------|---------|
| 线上 trace 原样重放（`max_tokens=1000`） | `length` | 1000 | 1000 | `""` |
| 放大预算（`max_tokens=3000`） | `length` | 3000 | 3000 | `""` |
| **对照：加 `thinking: {type:'disabled'}`** | `stop` | **150** | 0 | 正常答案（含 `[片段1]` / `[Q2]` / `[Q17]` 指针） |

稳定复现 2/2；对照实验说明「关闭思考」既解决问题又省 850 token。

## 影响面

- 触发面 = **域锁定快路径的生成轮**（`sango-novel` 最重：长宽问句 + 指针契约诱导长思考）。题库域答案短、闲聊域约束少，风险低但同一条 `max_tokens` 通道。
- 严重度：**用户可见的空答案 + 日志显示 success**，监控/日志页看不出异常（本次靠负责人人工发现）。
- 同类前例：`41ad4e28`（2026-09-21，域锁定快路径、旧 477 字符域提示词、「关于的武器叫什么」，同样 1000/空）。重放该旧 messages 本次为 `stop` 正常答出 → 旧例属**偶发**（温度 0.7 + 推理发散），今日这例**稳定复现**。
- 结论：**A011 未引入该缺陷**，只是换了域提示词文本；缺陷在「思考预算共享 + 空答案直通」。

## 修复候选

1. **生成轮关闭思考**（推荐）：`thinking: {type:'disabled'}`。生成轮职责是「按已注入原文写一句结论 + 指针」，不需要长思考；实测有效且 token 从 1000 降到 150。需负责人确认是否接受（涉及模型行为口径，属对外可感变化）。
2. **空答案不得当成功**（必须做，与 1 独立）：`finish_reason==='length'` 或 `content` 为空时，不得 200 直通——重试一次 / 走 `concludeFallback` 兜底 / 明确报错，三选一由负责人定；日志 `status` 同步不得记 success。
3. 顺带清理：`src/agent.ts` 残留调试输出 `console.error('[callModel]', 'messages:', messages)` 与 `console.time('callModel')`，把完整 messages 打到 stderr。

## 验证口径（修复后）

- 同一 traceId 的 messages 重放：`finish_reason=stop`、`content` 非空、含合法指针；`/api/chat` 返回非空 `answer`。
- 负向用例：构造 `finish_reason=length` + 空 `content` 的模型响应，断言**不返回 200 空答案**（走兜底或报错），且日志 `status` 不为 success。
- 固定问句集回归：域锁定快路径（原著 / 题库）与闲聊各 1 条，格式与改动前一致。

## 修复口径（2026-09-22 负责人确认）

判据：**只要 messages 里有服务端注入的依据、或本轮输出已被锁成编号 / 单句，就关闭思考；只有「无注入的自由模式生成轮」保留思考。**
判据不是「我们有没有给答案」，而是「任务是否已确定 + 输出是否已被约束」。

| 路径 | 调用点（mcp-orchestrator `src/agent.ts`） | 关思考 |
|------|------------------------------------------|--------|
| 域锁定快路径（原著 / 题库） | 生成轮 `:865` | 关 |
| 同上 · 指针校验失败 | 兜底结论轮 `:562` | 关 |
| `auto` → 1 / 2 | 分类轮 `:824` | 关 |
| `auto` → 1 / 2 | 生成轮 `:865`（已注入） | 关 |
| `auto` → 99 | 分类轮 `:824` | 关 |
| `auto` → 99 | 生成轮 `:865`（无注入） | **不关** |

上述 5 处已在代码中加口径备注（注释，无行为改动，`npm run build` 通过）。实现时需同步接口文档（`auto` 轻量分类调用契约与生成轮契约增「是否思考」口径）。

### 空答案兜底口径（2026-09-22 负责人确认）

触发面**只限**「`content` 为空 / `finish_reason=length`」；超时、限流、工具不可用不在其列（重试会放大故障）。

1. **第一层：变参重试 1 次**。变参写死为「`temperature → 0` 必做；该轮若开着思考则一并关闭」。注意：按上表除「自由模式 99 生成轮」外均默认已关思考，这些轮次的实际变参只剩 `temperature=0`——实现时不得视为空操作而不变参。
2. **第二层：仍失败 → 报错**。沿用现有映射（`src/server.ts:152`）：**500 + 固定文案「处理请求失败，请稍后重试」**，不透传模型原文；日志 `status=failed`、`response_code=500`、`error_message` 写明「生成轮两次空答案」。不新造状态码。

## 范围（2026-09-22 负责人确认）

本票只做「关思考 + 空答案变参重试 / 报错」。
「日志采集 `reasoning_tokens`、重试标识落库、日志页重试标记与 hover 中文表达」属新能力且跨 mcp-orchestrator / mcp-web 两侧，**另开 feat-A012**，不在本票内。

顺带清理（本票内随实现一并做）：`src/agent.ts` 残留调试输出 `console.error('[callModel]', 'messages:', messages)` 与 `console.time('callModel')`。

## 登记说明

根因需实证（探针 + 对照实验）方能定位、且修复涉及模型行为口径决策，故单独建文件跟踪（非「根因显然、改一两行」类小 bug）。
