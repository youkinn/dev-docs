# bug-00056：同题答案两种渲染形态（仅字标 vs 引语内联）——引语机制删除 + 引用排序

> Bug 号：bug-00056
> 状态：已修复
> 修复日期：2026-10-10
> 关联特性：feat-A006（答案展示结构化：结论 + 引用出处卡片）
> 涉及项目：mcp-orchestrator, mcp-server, mcp-web, dev-docs
> 登记：Coco ／ 报告：负责人 ／ 登记日期：2026-10-10
> 承接：bug-00024（同现象既有票，修复口径升级为本票；本票验收后置「已关闭·口径取代」）；bug-00025（引文回声去重修复代码随引语机制删除一并移除，置「已关闭·口径取代」）

## 现象

同一问题「百骑劫魏营的是甘宁」两条 trace 前端展示两种形态：

| traceId | 展示 |
|---------|------|
| `78f75aa7-8907-4533-88f0-5da0ef8c18b2` | `百骑劫魏营的是甘宁。¹²³`（结论 + 字标） |
| `fa0f6604-b372-4379-bd60-52e63a4cd997` | `百骑劫魏营的是甘宁。` 后接「宁今夜只带一百人马去劫曹营；…」¹ 等多条引语内联 |

根因：模型输出 `[Qn]` 引语指针时，服务端按 A006 契约把引语原文内联进 `answer`（「引文」+ 角标）；输出 `[片段N]` 时只渲染角标 → 同题答案形态不稳定。

## 判定

同题两次请求 answer 展示形态不一致，属缺陷（feat-A006 契约范围内）。

## 修复口径（负责人 2026-10-10 拍板）

1. 引语（quotes）机制整体删除：模型不再输出 `[Qn]` 指针，注入视图不再含 `⟨Qn⟩` 标记，服务端不再渲染引语原文。
2. `answer` 只留结论正文：服务端剥离模型输出 `[片段N]` 指针（不输出角标）；`citations` 卡片 = 被引用片段原文。
3. 语料数据不动：`mcp-server/sango/data/corpus` 及 `_segments` 保持原样。
4. 删干净、不留痕迹：quotes / 引语相关代码、测试、提示词、文档全部删除；文档不再出现引语机制描述。
5. 引用排序（负责人追加）：输出给前端的引用按「回号递增；同回按原文出现先后」排序。同回排序键取片段章内文本顺序号（chunkId 后缀 `c\d+`，主键；缺失时用 `segFrom` / `segTo` 兜底）；无回号 / 无位置的片段（如草稿台自定义片段）排在有位置片段之后、相互保持引用出现顺序。

## 影响范围（变更清单）

### mcp-orchestrator

- `src/citation.ts`：删除 `RecallQuote` / `RecallEntry.quotes` / `RecallFragment.quotes` / `InjectionView.quotes` / `quoteFragments`、`isValidQuoteRange` / `sliceQuoteText` / `markQuotesInWindow` / `extractQuotePointers` / `matchEchoQuote` / `stripOverlongModelQuotes`、`toSuperscript`；`toRecallFragments` / `buildInjectionView` / `extractCitePointers` / `validateQuotePointers` / `resolvePointerRef` / `renderAnswerWithCitations` / `splitAnswerSentences` / `findLowOverlapSentences` 去引语分支；新增引用排序：`RecallFragment` / `RenderedFragment` 保留章内文本顺序号（`chunkSeq`，自 chunkId 反解），`renderAnswerWithCitations` 按回号 + 原文序（`chapter → chunkSeq → segFrom → segTo`）排序 `citations`，answer 剥离 `[片段N]` 指针不输出角标
- `src/agent.ts`：域提示词、兜底归纳提示词去引语措辞；`applyNovelCitationGuard` / `computeCitedChunkIds` 去 Q 分支
- `src/test/**`：`citation.test.ts` / `agent-novel.test.ts` / `agent-recall-diagnostics.test.ts` / `agent-cache.test.ts` / `agent-bug-00018.test.ts` / `agent-routing.test.ts` / `integration.test.ts` / `prompt-slimming.test.ts` / `prompt-invariants.test.ts` 引语用例改造

### mcp-server

- `src/types.ts`（`SearchEntry.quotes`）、`src/search/sango-index.ts` 出参组装、相关测试字段断言删除 quotes 字段（语料文件不动）

### mcp-web

- 零代码改动（answer 纯结论正文、卡片区纯展示）；真浏览器复测形态

### dev-docs

- `requirements/feat-A006-citation-display.md`、`requirements/feat-A004-sango-classics-rag.md`、`mcp-orchestrator/api/feat-A006-citation-display.md`、`mcp-orchestrator/api/feat-A004-sango-classics-rag.md`、`docs/sango-corpus-spec.md`、`docs/llm-answer-accuracy-current-state.md` 等引语描述清除；引用顺序契约由「按引用出现顺序」改为「按回号递增 + 同回原文序」
- `bugs/INDEX.md`（本行 + bug-00024 / bug-00025 收口）

## 验证方式

- 真浏览器同题反复提问（以登记两条 trace 复现），`answer` 恒为「纯结论正文」形态（无角标、无引语内联、无 `⟨Qn⟩` / `[Qn]` 残留）
- 跨回引用按回号递增展示；同回多条按原文出现先后展示
- 编排 / 服务器单测改造后全绿；负例（`citations=[]`、题库域、天气域）行为不变
- 兜底路径（answer 纯结论、`citations` 一条）不变；A013 缓存清后复测
