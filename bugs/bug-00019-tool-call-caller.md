# bug-00019：工具调用记录缺「调用方 / 发起阶段」→ 日志页无法区分模型调用与服务端预调

> Bug 号：bug-00019
> 状态：修复中（2026-09-22 提测，负责人验收中；后端 `f650e49` on `coco/feat-A011_prompt-slimming` ／ 前端 `b4762a1` on `ye/feat-A011_logs-cache-and-chat-rename`）
> 关联特性：feat-A011（负责人提测验收中发现）
> 涉及项目：mcp-orchestrator（主要）、mcp-web
> 登记：Coco ／ 报告：负责人 ／ 登记日期：2026-09-22

## 现象

聊天页不选场景标签（auto），输入「夏侯惇眼睛怎么瞎的」，日志页该条出现两条工具调用记录：

| seq | 工具 | 出参 |
|-----|------|------|
| 1 | `fengyunsanguo_quiz_route`（L3 题库预检） | `false`（未命中） |
| 2 | `sango_novel_search` | 第 18 回原文命中 |

traceId `2ef3608a-be62-4c66-856c-ed156f574fb9`（2026-09-22 18:14 CST，`log_type=chat`、`domain=null`、`status=success`、`response_code=200`）。

## 链路核对（不是模型乱调工具）

`llm_call_logs` 只有两条且 `tool_calls` 均为空 → 两条工具调用**都是服务端发起**：分类轮输出 `1`（71 token）→ 服务端预调 `sango_novel_search` → 生成轮（2075 token，原著域提示词 + 注入片段，无工具定义）。答案与引用均正常。

第一条来自 auto 分支的 L3 题库预检（`src/agent.ts:898` → `transport.fengyunsanguo_quiz_route`，一次真实 MCP 调用），未命中才进分类轮。同类前例 `df9e5267-d3ba-4c31-9a2d-7ffaf68c56ab`（「关云长义释曹孟德」）。

## 定性（2026-09-22 负责人）

**不算缺陷**：L3 预检是 A011 定稿口径「L3 保留不动」的设计内行为，链路结果正确。真正的问题是**记录缺「谁发起 / 哪个阶段发起」** —— 日志页只能看到「谁被调用」，于是服务端预检被读成模型自主调用（本次误解的成因）。本票转为工具调用可观测性补强。

## 修复口径（2026-09-22 负责人拍板）

日志页「工具调用」表格在**「调用方法」列后新增「调用方」列**，要能看出**谁发起的 + 哪个阶段发起的**。

| 项 | 口径 |
|----|------|
| DB 列 | `tool_call_logs.caller TEXT`（谁发起）+ `tool_call_logs.stage TEXT`（哪个阶段）；均可空，历史行不回填 → NULL |
| caller 值域 | `server` = 服务端预调；`model` = 大模型自主调用 |
| stage 值域 | `l3` = L3 题库向量预检；`fastpath` = 域锁定快路径（L1 标签 / L2 关键词）预调；`classify` = auto 分类轮按编号预调；`generation` = 生成轮模型自主调用（当前无调用点，值域预留）；`admin` = 后台 / 管理接口直调（原文阅读器 `sango_novel_chapter`、随机一题 `fengyunsanguo_quiz_command`） |
| 迁移 | 新库建表带列；旧库 `ALTER TABLE tool_call_logs ADD COLUMN`（参照 `cached_tokens` 的写法 `src/storage/logs.ts:442-446`） |
| 落库 | `MCPTransport.callTool(name, args, origin?)`，`origin = { caller, stage }`；成功 / 失败两处 `appendToolCall` 均带；调用点显式传值，不得推断 / 兜底默认。`stage` 为联合类型（`ToolCallStage`），拼错阶段名需编译失败 |
| 调用点 | `src/index.ts:49` L3 matcher → `server` / `l3`；域锁定快路径预调 → `server` / `fastpath`；L3 命中后题库预调 → `server` / `l3`；分类轮判定 1 / 2 后预调 → `server` / `classify`；`src/api/v1/sango.ts:49` 与 `src/server.ts:323` 后台直调 → `server` / `admin` |
| 接口 | `GET /api/logs/:traceId` 的 `data.toolCalls[]` 增 `caller`、`stage`（均可为 null） |
| 前端 | 「调用方法」后增「调用方」列，合成显示：`服务端 · L3 预检` / `服务端 · 域快路径` / `服务端 · 分类轮` / `服务端 · 后台直调` / `大模型 · 生成轮`；NULL / 缺字段 → `—` |
| 不做 | 不改路由行为；不做按调用方 / 阶段筛选与统计（需要另开票） |

## 另议（本票不做）

L3 题库预检与 A011 轻量分类轮职责重叠：每条 auto 非题库问句多付一次 MCP 往返 + 一条日志记录（无 LLM token 成本）。是否移除 L3 快通道需先有命中率数据（当前全库 `fengyunsanguo_quiz_route` 记录仅 2 条且均为 `false`），另行拍板。

## 验证口径（修复后）

- 新发起 auto 问句（如「夏侯惇眼睛怎么瞎的」）→ 该 trace 两行「调用方」分别为：「服务端 · L3 预检」（`fengyunsanguo_quiz_route`）、「服务端 · 分类轮」（`sango_novel_search`，分类轮判定 `1` 后预调）。
- 域标签锁定路径（如 `domain=sango-novel`）→ 显示「服务端 · 域快路径」。
- 修复前的历史记录（含 `2ef3608a`）→ 「调用方」显示「—」（NULL 不回填，符合预期）。
- 前端改动需真浏览器实测（第 11 条）：新增列渲染正常，无横向错位 / 抖动。

## 分工

| 层 | 负责 | 范围 |
|----|------|------|
| 后端 | 老陈 | storage（列 + 迁移 + 落库 + 接口映射）、transport（入参）、index / agent 预调调用点标注 |
| 前端 | 小叶 | 日志页「调用方」列 + 真浏览器实测 |