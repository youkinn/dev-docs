# feat-A009: 检索诊断（召回可解释）

> 特性号：feat-A009
> 状态：草稿（待负责人确认后定稿）
> **排期：在 bug-00010（quotes[] 契约瘦身）完成后开始**
> 作者：Coco
> 涉及项目：mcp-server（sango 检索诊断产出）、mcp-orchestrator（traceId 透传 / 落库 / 查询接口）、mcp-web（日志页诊断面板）
> 日期：2026-09-21
> 关联：feat-A007（链路日志追踪）、feat-A004（演义 RAG）、feat-A008（日志覆盖补齐，先做）、bug-00010（前置依赖）、bug-00005 / bug-00006（本特性为其提供排查手段）

## 背景

feat-A007 把埋点铺到 MCP 边界，能看到 `sango_novel_search` 的入参与出参；feat-A008 补齐三条链路覆盖。但 MCP 子进程内部仍是黑盒 —— 看不到「为什么召回这几条」。

实测 trace `dc1b7b5b-2db8-4288-ba06-f4711e0b7a30`（query「义释严颜」，limit 10，2026-09-21）：

- 能看到：入参 `{"source":"sanguo-yanyi","query":"义释严颜","limit":10}`、出参 10 条、72ms、top1 = `sanguo-yanyi:0063:c0021`
- 看不到：三路召回（BM25*0.3 + 向量*0.6 + 标签*0.1）各自的分数贡献、向量 top50 候选、第 11 名差多少分、query 归一化与分词、死亡意图判定与置顶、是否降级纯 BM25、语料版本
- 出参全貌还不保证：`tool_call_logs` 另两条 trace 的 `result_summary` 长度 = 8006（= 8000 + 6 字符截断标记），完整出参已被截掉（bug-00010；本特性开工前该 bug 先修完）

## 目标（对应负责人给定的 2 个基准）

> 基准 1 · 给定一个 traceId，能判断结果对不对
> 基准 2 · 通过后台能看懂召回当前数据的原因

- [ ] traceId 透传进 MCP 子进程（`tools/call` params `_meta`）
- [ ] sango 侧产出结构化检索诊断（三路候选与分数、截断、意图、环境 / 降级、语料版本）
- [ ] 诊断经 `result._meta` 回传 + 总台落库（新明细表，`trace_id + seq` 关联工具明细）
- [ ] 日志页「检索诊断」面板：召回漏斗 / 分数表 / query 处理链 + 环境标记

## 非目标

- `quotes[]` 契约瘦身与 `speaker` 抽取质量修复（bug-00010 已登记，**本特性的前置依赖，不属本特性范围**）
- 引用卡片展示说话人（依赖 speaker 质量，另立）
- 跨 trace 聚合分析、诊断数据长期归档（本期只做单 trace 可解释）
- 检索算法本身的调整（本特性只做可观测，不改召回策略与权重）
- 自动判定「召回是否正确」（见开放问题）

## 验收标准

### 基准 1 · 给定 traceId 能判断结果对不对

1. [ ] 给定 `dc1b7b5b-2db8-4288-ba06-f4711e0b7a30`，能查到入参、**出参全貌**（不被 8000 截断）、条数、耗时、状态、结构合契约
2. [ ] 能回答 top-N 是否命中答案段（对照召回条目原文）
3. [ ] 能回答第 N+1 名（未进 top-N 的候选）是什么、差多少分
4. [ ] 能回答最终 answer 与 citations 是否与召回自洽（引用来自召回条目）

### 基准 2 · 后台看得懂召回这个数据的原因

5. [ ] 召回漏斗每级数字可核：语料 N chunk → 词法命中 x / 向量 top50 / 标签命中 y → 合并候选 z → top-N → 注入视图 → 被引用
6. [ ] 分数表展示每条候选的排名 / chunkId / 回目 / BM25 分 / 向量余弦 / 标签命中 / 最终分 / 是否进注入视图 / 是否被引用
7. [ ] 能说出某条召回是被哪一路顶上来的（词法 / 向量 / 标签），以及某条候选为什么没进 top-N
8. [ ] query 处理链可见：原始 query → alias 归一化后文本 → 分词 tokens
9. [ ] 环境与降级可见：向量 scheme、是否降级纯 BM25、语料 chunk 数 / alias 条数 / 向量 dim、死亡意图判定与置顶

### 通用

10. [ ] 诊断产出 / 透传 / 落库任一环节失败均不影响 `/api/chat` 主流程（旁路原则，故障注入验证）
11. [ ] 诊断不进模型上下文：`content` 出参契约不变，LLM 明细的 `request_summary` 不含诊断内容
12. [ ] 既有 A003~A008 相关测试全绿（诊断不改业务行为）

## 接口影响

- **MCP 契约**：`tools/call` 请求 params 增 `_meta.traceId`（总台注入）；result 增 `_meta.diagnostics`（sango 产出）。`content` 出参契约不变 → 模型不可见、对 LLM 零影响
- **新表**：`tool_retrieval_logs`（检索诊断明细，`trace_id + seq` 关联 `tool_call_logs`）
- **查询接口**：`GET /api/v1/logs/:traceId` 的工具明细增 `diagnostics` 字段
- **前端路由**：不变（`/logs` 行展开内新增面板）

## 技术要点

- **traceId 透传（已验可行）**：SDK 1.30.0 中 `CallToolRequestSchema` 的 params 声明 `_meta`，服务端经 `extra._meta` 取用（`shared/protocol.js:321`）；总台在 `transport.callTool` 注入（`transport.ts:234`）
- **诊断回传（已验可行）**：`ResultSchema = z.looseObject({ _meta: ... })`，`CallToolResultSchema` 继承；客户端 `safeParse` 后原样保留 `_meta`（`shared/protocol.js:696`）
- **诊断载荷必须限流**：stdio `ReadBuffer` 默认上限 10 MB / 单条 JSON-RPC 消息，超限**抛错并关闭连接**（不是降级）。诊断只放结构化小数据（top20 的 `chunkId + 三路分 + 最终分`，**不放文本**），sango 侧 64 KB 预算截断 + `truncated` 标记，落库前再按 8000 字符口径截断
- **诊断不改出参契约**：走 `result._meta`，不进 `content` → 模型看不到、prompt 不受影响
- **sango 侧改造点**：`SangoIndex.search` 由返回 `SearchEntry[]` 改为 `{ entries, diagnostics }`；诊断内容取自现有中间量（`bm25` / `cosine` / `tagHits` / `topKByCosine` / `deathIntent`），不新增计算
- **编排侧关联**：把「哪条召回进了注入视图（`[片段N]`）、哪条被模型引用」与诊断候选对齐，前端才能一眼看出截断发生在哪一级（对应 bug-00006）
- **路由注册顺序**：诊断查询随既有 `GET /api/v1/logs/:traceId` 扩展，注意不被 `token-stats` 等静态路由吞掉（A007 既有约定）

## 风险 & 开放问题

> 本节为**待负责人 review 的不确定事项**（2026-09-21 负责人指示：先做 feat-A008，后续不确定事项记入文档）。不阻塞 feat-A008 开工，feat-A009 定稿前逐条拍板。

- **开放问题 1（需负责人拍板）**：基准 1 的「判定真值」从哪来 —— 日志页人工标注（标 相关 / 不相关，内网无鉴权符合 v1 口径）/ 接入评测集（`dev-docs/test/三国演义1000问.md` + `sango-recall-bench.mjs`）/ 本期只做 1~4 项不做真值判定。此项决定基准 1 的验收边界，也决定小叶是否要做标注 UI
- **开放问题 2（需负责人拍板）**：`speaker` 字段去留 —— bug-00010 候选 1 原建议连 `qid` / `speaker` 一起删；但 `speaker` 有明确后续用途（引用卡片展示说话人，正对 bug-00005）。建议瘦身时保留 `speaker` 并修抽取质量，否则该用途需重建语料
- **诊断体积**：候选 top20 + 三路分数预估 2–4 KB，远低于 10 MB 上限；但需实测最坏情况（超大 chunk 数语料）
- **诊断可靠性**：`_meta` 属协议层元数据，spec 未限制自定义 key，但若未来 SDK 收紧 `looseObject`，需回归验证
- **`offset` 精度未验**：bug-00010 若采用 `{offset, len}` 瘦身，需先在全量语料验证 offset 与切片口径一致（运行期现用 `indexOf` 而非 offset）
- **依赖时序**：本特性排在 bug-00010 之后，若 bug-00010 修复范围扩大（如连带 speaker 质量修复），开工时间顺延

## 任务与负责人

| 任务 | 负责人 | 依赖 |
|------|--------|------|
| 接口文档（traceId `_meta` 契约、诊断结构、新表 DDL、查询接口扩展、截断口径） | 老陈 | 需求定稿 |
| mcp-server：sango 检索诊断产出（`search` 返回结构改造 + 诊断限流） | 老陈 | 接口文档 |
| 总台：traceId 透传 + 诊断落库 + 查询接口 | 老陈 | 接口文档 |
| 编排侧：诊断与注入视图 / 引用链路关联 | 小胡 | 接口文档 |
| 前端：日志页「检索诊断」面板（漏斗 / 分数表 / query 链 / 环境） | 小叶 | 接口文档 |
| 需求 / INDEX 定稿、审查提测 | Coco | — |

## 分支计划

- dev-docs：`coco/feat-A009_recall-diagnostics`
- mcp-orchestrator：Coco 拉需求分支 `coco/feat-A009_recall-diagnostics`，老陈 / 小胡基于它拉个人分支（`chen/feat-A009_*`、`hu/feat-A009_*`），自合入需求分支
- mcp-server：老陈单人直拉 `chen/feat-A009_sango-diagnostics`
- mcp-web：小叶单人直拉 `ye/feat-A009_log-diagnostics`

## 故事号（Coco 生产）

| 故事号 | 内容 | 负责人 | 状态 |
|--------|------|--------|------|
| story-A009-01 | 需求文档定稿与故事号 / INDEX 登记 | Coco | 草稿（待负责人确认） |
| story-A009-02 | 接口文档：traceId `_meta` 契约 + 诊断结构 + 新表 DDL + 查询接口扩展 | 老陈 | 待启动 |
| story-A009-03 | 实现：sango 诊断产出 + 总台透传 / 落库 / 查询 + 编排侧诊断关联 | 老陈 + 小胡 | 待启动 |
| story-A009-04 | 前端：日志页检索诊断面板 | 小叶 | 待启动 |

> 本特性按 需求 / 接口 / 实现 / 前端 4 粒度规划故事号（大功能：新表 + 三侧改动 + MCP 契约扩展），各粒度开发期间复用对应故事号。
> 合并记录以 GitHub PR 记录为准，本表不再补登（2026-09-21 决策）。
