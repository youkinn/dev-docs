# LLM 回答准确度 · 代码现状事实库（main 锚定）

> 维护：Coco ｜ 创建：2026-09-24
> 定位：本文是「LLM 回答不准确」问题域的**唯一现状依据**。代码事实一律以本文为准复核 `main` 分支；
> bug 索引 / 排查笔记等其它文档与此冲突时，以本文列出的 main 现状为准（代码 > 本文 > 其它文档）。
> 范围：mcp-orchestrator（总台）+ mcp-server 器坊 sango 域；mcp-web（前厅）渲染层不在本次扫描范围。

## 0. 时间锚点（本文全部事实对应的 main HEAD）

| 仓库 | main HEAD | 时间 | 内容 |
|---|---|---|---|
| mcp-orchestrator | `df8a58d` | 2026-09-24 13:04 | Merge PR #21（feat-A013 语义缓存） |
| mcp-server | `b3d31c5` | 2026-09-24 13:06 | Merge PR #13（A013 cache-embed / sango_query_embed） |

## 1. 维护约定

- 每次有代码合并进 main（或检索 / 生成 / 缓存 / 评测任一侧改动验收）后，Coco 随文档/收尾提交同步本文；同步触发点是「代码事实与本文不符」。
- 本文只记 **main 现状 + 已拍板决策**；分支内的实现一律放「§11 在途分支」，不并入 main 现状。
- 引用以「文件 + 符号 / 常量」为主（符号比行号稳定）；行号如标注，以锚点 HEAD 为准。

## 2. 链路总览（一条请求从进到出）

```
HTTP /api/chat
  → 路由判定（零 LLM）：L1 前端标签 → L2 关键词硬匹配 → L3 题库高置信识别（仅 auto 有效）
  → 域锁定时：域内快路径预调工具并注入（不经模型决策）
  → auto：轻量分类轮（classify，无 tools，输出编号 1/2/99）
  → 服务端按编号预调工具并注入 → 生成轮（generation，固定 [system 域提示]+[user 问题]+[system 注入片段]）
  → 演义域：引用硬校验结构门（零 LLM）→ 通过渲染 / 不通过兜底 / 确无内容拒答「演义中未涉及」
  → novel 路径查 / 写语义缓存（CacheManager）
```

## 3. 路由层（`mcp-orchestrator/src/agent.ts`）

- 阶段枚举 `LlmStage = "classify" | "generation"`；tool-use 自主循环已删除（feat-A011）。
- 分类轮 `CLASSIFY_SYSTEM_PROMPT`：模型只输出编号；`CLASSIFY_ROUTE_IDS` = 1 原著 / 2 题库 / 99 自由；`parseClassifyRouteId` 解析非 1/2/99 → 99，不重试。
- 三层判定 `L1 前端标签 → L2 关键词 → L3 高置信题库识别（仅 auto）`；天气分支已下线；`RouteTarget = fengyunsanguo | sango-novel | auto`。
- 域锁定后走快路径预调（caller=server，stage ∈ fastpath / l3 / classify）；生成轮请求体**不带工具定义**，模型只见注入内容。
- 兜底结论提示 `CITATION_FALLBACK_CONCLUSION_PROMPT`：「按原文，」一句话结论，只依据片段。

## 4. 检索层（`mcp-server/sango`）

- 语料 schema v2（`src/types.ts`）：`CorpusChunk` 最小检索单元，250 字目标 / 400 字硬上限、可跨段；`Quote` 引语冗余表（qid/文本/offset/speaker）。
- 别名规范化（`src/search/sango-index.ts`）：`alias.json` 索引侧与 query 侧**双侧归一化**到规范名（规范名 = 该 PID 下语料 df 最大写法）；`STUB_ALIASES` 测试兜底。
- 检索融合：多路召回（BM25 + BGE-M3 向量 + 标签）加权重排 `0.6/0.3/0.1`（向量 0.6 / BM25 0.3 / 标签 0.1，2026-09-19 定参，取代原「不做 rerank」）；`MIN_COSINE=0.3`（纯向量兜底阈值，**Step 4 待按真向量分布重定**）。
- 向量：BGE-M3 1024 维（`src/embed/bge-m3-encoder.ts` + `data/vectors/sanguo-yanyi.bin`）；检索与缓存判定同一空间（口径零漂移）。
- 死亡意图（`src/search/intent.ts`）：纯规则（7 类 pattern + `DEATH_GATE` 大门），命中死亡标签 chunk 置顶；判定失败只退回普通排序、不阻断。
- 标签数据：`data/corpus/tags/{duel,event,story}.json`（`loadTags` 失败降级为无标签路由）。
- 工具契约：
  - `sango_novel_search`：limit 默认 5 / 上限 20（超限截断不报错）；出参结构化 JSON（`chapter`/`title`/`quotes{offset,len}`，bug-00010 瘦身）；空命中返回 `未召回任何原文段落`；请求带 `_meta.traceId` 才产诊断（`_meta.diagnostics`）。
  - `sango_query_embed`（A013 内部工具）：query → base64-float32-le 1024 维，仅供缓存判定，模型不可见、不产诊断。
  - `sango_novel_chapter`（A010）：整回读取（含 prev/next）。

## 5. 注入层（`mcp-orchestrator/src/citation.ts`）

- 常量（2026-09-20 注入策略定稿）：`INJECT_FRAGMENT_LIMIT=10`；`INJECT_HEAD_GUARANTEE=5`（前 5 段整段保底、不裁剪、不占预算）；`INJECT_TOTAL_BUDGET=2000` 字（超预算丢整段、**绝不段内裁剪**）；`INJECT_TAIL_FALLBACK_ENABLED=true`（第 6–10 段预算兜底，检索侧提升后退出）；`MAX_MODEL_QUOTE_LENGTH=30`。
- 窗口锚点用稀有度排序 `rankKeyAnchors`（key 长度降序 → 段内出现次数升序 → 首现位置升序），替代旧「最后一个 key 最后一次出现」；`trimTextToWindow` 段内裁剪已删除。
- 引语重编号连续无空洞（bug-00009 已闭环）；`[片段N]` 叙述段指针支持叙述型答案渲染。

## 6. 生成层（`mcp-orchestrator/src/agent.ts`）

- **单轮生成**：复核轮（第二次 LLM 调用）已整体删除（负责人否决：token 与延迟翻倍）——main 上无第二次模型调用。
- 参数：`MAX_TOKENS=1000`；温度调用点缺省 `0.7`（llm_call_logs 落库生效值）；bug-00018 空答案 / `finish_reason=length` → 关闭思考 + temperature=0 重试 **1 次**（变参重试），异常路径不重试。
- 域提示词：
  - `SANGO_NOVEL_DOMAIN_PROMPT`（5 条指令 + 事件结构校验）：只依据片段作答；引语输出 `[Qn]` / `[片段N]`、禁止抄写原文与出处；片段确无内容回复「演义中未涉及」禁止先验补全；`5-1~5-3` 先比对问题与片段的事件结构（施事/动作/受事），**方向不一致禁止用该文档回答**（bug-00023 prompt 级修复，main 已合入 PR #20）。
  - `FENGYUNSANGUO_DOMAIN_PROMPT`：候选中含义相同的那道题才作答；无对应 / 仅字面相似 → 「题库未收录该题，请换个问法」，禁题库外知识。
  - `FREE_CHAT_SYSTEM_PROMPT`（99）：自由对话，无注入。

## 7. 校验层（结构门，零 LLM，`mcp-orchestrator/src/citation.ts` + `agent.ts`）

前置：软性域判定 `isNovelAnswer`（有人名 / `[Qn]` / `[片段N]` / 「按原文，」才进原著路径）→ `stripOverlongModelQuotes`（超长抄写丢弃）→ `scanRecallPersonIds` → `validateQuotePointers`（指针合法性）→ `verifyCitation`（**断言人物 ⊆ 召回人物**：ID 级集合判定，无 ID 次要人物退字符串包含）。

- 通过 → `renderAnswerWithCitations` 服务端渲染（引语由冗余表还原，模型不抄写）。
- 不通过 → `concludeFallback` + `buildFallback`（`pickBestFallbackFragment` 按结论人物 + 锚点稀有度选段，不再盲取首段，bug-00009）。
- 确无内容 → 拒答 `NOVEL_NO_HIT_ANSWER = "演义中未涉及"` + `citations: []`。

## 8. 缓存层（`mcp-orchestrator/src/cache.ts` + `agent.ts` 接线）

- `CacheManager` 语义缓存：query 经 `sango_query_embed` 与检索同空间；参数：`CACHE_VERSION="A013-2026-09-23-1"`（版本变更全量清除防旧答案）；默认命中线 `DEFAULT_HIT_LINE=0.92`（运行时 PUT 可调、重启回初始）；`LOW_SIMILARITY_LINE=0.8`；`DEFAULT_MAX_ENTRIES=500`（1~5000 运行时可调）。
- 判定规则：≥2 候选过线 → 歧义不命中；唯一候选 → 焦点类一致性轻校验（`FOCUS_CLASSES` 焦点词表，`F(A)∩F(B)=∅` 拒判）；灰色区 `[0.8, hitLine)` 不命中；低于 0.8 未命中。
- 人名换说法命中：`normalizePersonNames`（字号归一化）。
- **写入门禁**：拒答类（「演义中未涉及」+ citations 空）**不写**（防错误拒答固化）；命中 / 灰色区 / 歧义 / 焦点拒判不写；embedding 失败旁路（不查不写不落 cache_logs）。
- 接线：novel 路径分类轮判定后查缓存（hit 直接返 data 跳过检索与生成），生成完成后 `recordNovelCache`。

## 9. 观测（`mcp-orchestrator/src/storage/logs.ts` / `trace.ts` / `recallDiagnostics.ts`）

- traceId 贯穿 HTTP → MCP 调用 → 日志明细；`llm_call_logs` 记 attempt / reasoning_tokens / input_breakdown / max_tokens / **temperature 实参**；`tool_call_logs` 记 caller（model/server）+ stage（l3 / fastpath / classify / generation）；`cache_logs` 记命中判定与灰色区；检索诊断回传 bm25Norm / cosine 全精度、hitLabels、分阶段 timing（bug-00013 已闭环）。

## 10. 评测

- 回归脚本（零 LLM，可作 CI）：`mcp-orchestrator/scripts/probe/recall-bench.mjs`（V0~V3 检索配置 @1/@3/@5、主案例「孙权遣人向关羽求亲」排名、注入窗口截断率；依赖 server 构建期 `_segments/` 中间产物）；`verify-injection-window.mjs` / `chunk-sweep.mjs` / `h2-faithfulness.mjs` / `build-poison-corpus.mjs`。
- server 校验脚本：`verify-embed-parity.mjs` / `verify-vector-fallback.mjs` / `verify_mcp.js`（`verify-tag-files.mjs` 在 A014 分支，未合入 main）。
- 凭证数据：`dev-docs/test/cls2400.json`（2400 题逐题分类）/ `answerable2400.json` / `entity2400.json`；运行 `node --experimental-strip-types dev-docs/test/recall-classify-900.mjs --json test/cls2400.json`。
- KPI 现状（recall-quality §维护记录 2026-09-20）：cls2400 bestRank top≤5 **78.1%** / 6–10 7.2% / >10 14.8%；主案例修后 #2。
- 口径缺陷未修：bug-00007（2400 问集：重复 376 / 负样本错标 4 / 超纲 44+）、bug-00008（字面正则对概括型答案失效、A 类虚高）。

## 11. Bug / 需求状态对照（2026-09-24 以 main 核验）

| Bug | INDEX 状态 | main / 分支事实 | 判定 |
|---|---|---|---|
| bug-00003 召回质量 | 待修复 | 检索四工程项（别名双侧归一化 / 真向量 / 多路重排 / 注入策略）已落地 main；剩余 MIN_COSINE Step4 + 评测口径 | 保持待修复，标题描述已落后 |
| bug-00023 主宾反转 | 待修复 | main 已合入 prompt 级事件结构方向校验（5-1~5-3 + 不变量断言，PR #20）；**结构性前提校验未做** | 描述更新，状态待定 |
| bug-00028 片段不支撑仍答 | 待修复 | main 无修复；`hu/bug-00028_answer-support-guardrail` 分支 +4 提交（支撑护栏杆 / 句-片段重叠门 / 复核轮撤销），未合入未提测；dev-docs PR #44 已记「代码已就绪」 | 待审查提测 |
| bug-00022 题库并列候选 | 待修复 | prompt 已含「仅含义相同才答」（提示层），结构性保障未做 | 保持待修复 |
| bug-00024 渲染不一致 | 待修复 | llm_call_logs 已记温度（0.7）；排序稳定性未排查 | 保持待修复 |
| bug-00025 内部编号泄漏 | 待修复 | 输出层剥离 + 渲染层安全网未做；`MAX_MODEL_QUOTE_LENGTH=30` 已有限制抄写 | 保持待修复 |
| bug-00007 / 00008 评测口径 | 待修复 | 凭证与脚本在（§10），口径缺陷未修 | 保持待修复 |

## 12. 在途分支（未合入 main）

| 仓库 | 分支 | 待合提交 | 内容 |
|---|---|---|---|
| mcp-orchestrator | `hu/bug-00028_answer-support-guardrail` | +4 | 单轮生成细节：支撑护栏杆（引用不支撑→拒答/裁剪）、`stripLowOverlapSentences` 句-片段重叠门（阈值 0.5 / ngram 2）、三条通用语义指令并入生成轮提示词 |
| mcp-server | `chen/feat-A014_tag-system` | +4 | event.json 校准（A014）：四类与 stray 标签清理、`verify-tag-files.mjs` 静态校验脚本（零 LLM，3502 断言）、索引剥壳、死亡意图补 death_age 年龄问法（刘备之死段进 top10） |
| dev-docs | `coco/agenda-docs-flow` | — | 本次文档维护的出发分支（干净） |

## 13. 已知待办（main 注释 / 文档明确标注）

1. `MIN_COSINE` 按真向量分布重定（Step 4，`sango-index.ts` 注释仍标哈希时代死路值 0.3）。
2. 评测口径 bug-00007 / 00008 修复（答案层判定不能只靠字面正则）。
3. 缓存门禁扩展：当前只挡「拒答类」，非拒答但片段不支撑的答案仍可写缓存——待 bug-00028 支撑校验合入后，门禁应扩展为「支撑校验不通过也不写」。
4. bug-00024 排序稳定性排查（多路召回并列时 topN 是否稳定）。

## 维护记录

| 日期 | 变更 | 拍板 |
|---|---|---|
| 2026-09-24 | 初版：以 main HEAD（orch df8a58d / server b3d31c5）盘点全链路代码事实，登记过期点与在途分支 | 负责人 |
