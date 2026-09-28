# LLM 回答准确度 · 代码现状事实库（main 锚定）

> 维护：Coco ｜ 创建：2026-09-24 ｜ 最近同步：2026-09-28（A014/A015/A016/A017 合入后）
> 定位：本文是「LLM 回答不准确」问题域的**唯一现状依据**。代码事实一律以本文为准复核 `main` 分支；
> bug 索引 / 排查笔记等其它文档与此冲突时，以本文列出的 main 现状为准（代码 > 本文 > 其它文档）。
> 范围：mcp-orchestrator（总台）+ mcp-server 器坊 sango 域；mcp-web（前厅）渲染层不在本次扫描范围。

## 0. 时间锚点（本文全部事实对应的 main HEAD）

| 仓库 | main HEAD | 时间 | 内容 |
|---|---|---|---|
| mcp-orchestrator | `c68ac97` | 2026-09-27 21:29 | Merge PR #28（A016 归一化编排侧）；此前 PR #29（A017 草稿台）同批入 main |
| mcp-server | `946ff4c` | 2026-09-27 21:29 | Merge PR #16（A016 检索侧实体表单表 + 归一化改造） |
| mcp-web | `6b47865` | 2026-09-27 21:30 | PR #20（A016 归一化观测）/ #21（A017 草稿台）；渲染层不在本文范围，仅记锚点 |

> 上一版锚点（2026-09-24：orch `e1c5267` / server `b3d31c5`）之后合入 main 的检索 / 生成 / 评测相关变更：
> A014 标签系统（mcp-server PR #14，09-25）、A015 评测执行接口（mcp-server PR #15，09-25）、A016 术语口径统一（mcp-server #16 / orch #28 / mcp-web #20，09-27）、A017 草稿台（orch #29 / web #21，09-27）。

## 1. 维护约定

- 每次有代码合并进 main（或检索 / 生成 / 缓存 / 评测任一侧改动验收）后，Coco 随文档/收尾提交同步本文；同步触发点是「代码事实与本文不符」。
- 本文只记 **main 现状 + 已拍板决策**；分支内的实现一律放「§12 在途分支」，不并入 main 现状。
- 引用以「文件 + 符号 / 常量」为主（符号比行号稳定）；行号如标注，以锚点 HEAD 为准。

## 2. 链路总览（一条请求从进到出）

```
HTTP /api/chat
  → 路由判定（零 LLM）：L1 前端标签 → L2 关键词硬匹配 → L3 题库高置信识别（仅 auto 有效）
  → 域锁定时：域内快路径预调工具并注入（不经模型决策）
  → auto：轻量分类轮（classify，无 tools，输出编号 1 原著 / 2 题库 / 99 自由）
  → 服务端按编号预调工具并注入 → 生成轮（固定 [system 域提示]+[user 问题]+[system 注入片段]，
    temperature 支持调用点覆盖；有注入即关闭思考）
  → 演义域：引用硬校验结构门（零 LLM + 边界语义复核预算 1）→ 通过渲染 / 不通过兜底 /
    确无内容拒答「演义中未涉及」+ citations []
  → novel 路径查 / 写语义缓存（判定 embed 前对 query 做同一归一化，A016）
  → A017 草稿台旁路：traceId 拉取链路 / 手动发送 / 本次参数覆盖（含显式片段注入 draftbench:N）
```

## 3. 路由层（`mcp-orchestrator/src/agent.ts`）

- 阶段枚举 `LlmStage = "classify" | "generation"`；tool-use 自主循环已删除（feat-A011）。
- 分类轮 `CLASSIFY_SYSTEM_PROMPT`：模型只输出编号；`CLASSIFY_ROUTE_IDS` = 1 原著 / 2 题库 / 99 自由；`parseClassifyRouteId` 解析非 1/2/99 → 99，不重试。
- 三层判定 `L1 前端标签 → L2 关键词 → L3 高置信题库识别（仅 auto）`；天气分支已下线；`RouteTarget = fengyunsanguo | sango-novel | auto`。
- 域锁定后走快路径预调（caller=server，stage ∈ fastpath / l3 / classify）；生成轮请求体**不带工具定义**，模型只见注入内容。
- 兜底结论提示 `CITATION_FALLBACK_CONCLUSION_PROMPT`：「按原文，」一句话结论，只依据片段。
- 生成轮温度：调用点缺省 = 思考 + 0.1（2026-09-28 负责人拍板 0.7→0.1，server/cli/draftbench 同源）；重试 / 二选一判定关闭思考 + temperature 0（bug-00018 口径）；草稿台本次参数可覆盖 temperature（A017）。

## 4. 检索层（`mcp-server/sango`）

- 语料 schema v2（`src/types.ts`）：`CorpusChunk` 最小检索单元，250 字目标 / 400 字硬上限、可跨段；`Quote` 引语冗余表（qid/文本/offset/speaker）。
- **实体表单表（A016，PR #16）**：`data/entity-table.json` 单一数据源（alias.json 已退役）；行 = 类型 + ID（人名沿用 PID）+ 规范形 + 别名列表；统一实现 `sango/src/normalize/entity-table.ts`，索引侧 / query 侧 / 标签侧 / `sango_query_embed` 共用，编排侧不另写（口径零漂移）。
- 键分两类：`rewriteKey`（query 与索引侧替换为规范形）与 `fragmentOnly`（片段侧双写扩展素材，不进改写键；接口 §2.3 双写，tf 按命中处数计）；跨主条目词（文帝 / 陈留王 / 魏王等）不做改写键，按 `referentVerdicts` 的 dist/topPid 做「共享实体标签多挂」。**表缺失时 normalize 退化为恒等**。
- `env.normVersion`：实体表与判定换代时递增（当前 `b93c5ca9`，bug-00041 关公改回 rewriteKey 后）；检索与缓存共用，缓存产物版本含 normVersion 范围（`cache.ts` 注释，A016 §4.5），换版须清缓存。
- 检索融合：多路召回（BM25 + BGE-M3 向量 + 标签）加权重排 `0.6/0.3/0.1` 不变（2026-09-19 定参）；`MIN_COSINE=0.3` 仍为哈希向量时代死路值（`sango-index.ts:60` 注释 Step 4 待重定，**未做**）。
- 向量：BGE-M3 1024 维（`src/embed/bge-m3-encoder.ts` + `data/vectors/sanguo-yanyi.bin`）；检索与缓存判定同一空间。
- 死亡意图（`src/search/intent.ts`）：纯规则（7 类 pattern + `DEATH_GATE`），A014 补 `death_age` 年龄问法（死的时候多少岁 / 享年 / 卒年），置顶集合并入遗言段（刘备之死段 0085:c0011 rank11→top10）；判定失败只退回普通排序。
- 标签：`data/corpus/tags/{duel,event,story}.json` 仍在；A014 索引剥壳（`tagPostings` 只入库剥离类型信息的文本）+ event.json 四类与 stray 校准；「人物之封」标签类别曾添加后**撤销**（bug-00037 复盘：撤后答案段跌出 top50、检索侧无噪声解法，验收 6 改基线 6，拒答由编排层护栏承接）；`verify-tag-files.mjs` 静态校验已合入 main（3502 项断言）。
- **评测执行接口（A015，`sango/src/benchmark/` 五模块）**：parser / matcher / runner / snapshot / server；`POST /dev/benchmark/run`（dev 门控，`SANGO_DEV_HTTP_PORT=8787`，`npm run dev`）；判定逻辑只存一份，dev-docs `test/standard-set/feat-A015-verify.mjs` 为薄壳调用同一入口。
- 工具契约：
  - `sango_novel_search`：limit 默认 5 / 上限 20；出参结构化 JSON（`chapter`/`title`/`quotes{offset,len}`）；空命中返回 `未召回任何原文段落`；请求带 `_meta.traceId` 才产诊断。
  - `sango_query_embed`（A013 内部工具）：query → base64-float32-le 1024 维；A016 起 **embed 前做同一归一化改写 + normVersion**（换说法与规范形共享缓存条目，防 D4 口径分裂）；仅供缓存判定，模型不可见、不产诊断。
  - `sango_novel_chapter`（A010）：整回读取（含 prev/next）。
- 检索诊断（`_meta.diagnostics`）：bm25Norm / cosine 全精度、hitLabels、分阶段 timing（A013-03）+ **A016 归一化明细**（`query.rewrites` + `env.normVersion`，验收 8）。

## 5. 注入层（`mcp-orchestrator/src/citation.ts`）

- 常量（2026-09-20 注入策略定稿）：`INJECT_FRAGMENT_LIMIT=10`；`INJECT_HEAD_GUARANTEE=5`（前 5 段整段保底、不裁剪、不占预算）；`INJECT_TOTAL_BUDGET=2000` 字（超预算丢整段、**绝不段内裁剪**）；`INJECT_TAIL_FALLBACK_ENABLED=true`（第 6–10 段预算兜底，检索侧提升后退出）；`MAX_MODEL_QUOTE_LENGTH=30`。
- 窗口锚点用稀有度排序 `rankKeyAnchors`（key 长度降序）；2026-09-19 实证锚点截断是注入窗口丢答案句的根因之一，A016 改写后是否改变命中面**未复测**（见 §13 待办 6）。
- 草稿台路径（A017）：`draftbench:N` 显式片段注入，合成 chunkMeta（片段序 == 清单序，topK 截断保序），本次参数覆盖 temperature / disableThinking。

## 6. 生成层（`mcp-orchestrator/src/agent.ts`）

- 固定三段式 `[system 域提示]+[user 问题]+[system 注入片段]`；有注入即 `disableThinking`（bug-00018 实测：关闭思考 1000→150 token 且答案正常）。
- 域提示第 9 条「改述口径」+ 结构门语义复核（bug-00032 / 33 / 34 修复，2026-09-26 验收通过）：模型对注入片段的改述 / 同义措辞不得因字面重叠低被一票否决。
- 草稿台：`src/api/v1/draftbench.ts`（手动发送 / traceId 拉取 / 记录与 diff / 物理删除——事务内与同 traceId 日志链路一并删）。

## 7. 校验层（结构门，零 LLM + 边界复核预算 1）

- 引用硬校验结构门 → 通过渲染 / 不通过兜底 / 确无内容拒答「演义中未涉及」+ `citations: []`。
- bug-00028（PR #22，merge `e1c5267`）：支撑护栏（引用不支撑→拒答/裁剪）+ 句-片段重叠门（阈值 0.5 / ngram 2）+ 三条语义指令并入生成轮提示词。
- A016 演进（`a121557` 起，bug-00032 / 33 / 34）：重叠门改「低重叠待裁 → 边界 LLM 语义支撑复核」。
- **复核预算收窄（bug-00039 / 40，2026-09-26）**：低重叠候选只复核 `bestOverlap` 最高 1 句（并列取先现），其余直接 unsupported 裁剪；引语片段句豁免复核（不进候选、不裁剪、不占预算）；孤儿常量 `MAX_BOUNDARY_REVIEWS` 已删；「纯指针无正文」句不进复核候选，裁剪后仅剩指针 / 正文为空 → 拒答 + `citations: []`。
- LLM 调用预算（负责人 2026-09-26 定案）：域锁定正常 ≤1 次、极限 ≤2 次（生成 + 1 次复核）；自由模型极限 = 分类 + 生成 + 复核 3 次（已报备例外）；3 次以上默认打回。

## 8. 缓存层（`mcp-orchestrator/src/cache.ts` + `agent.ts` 接线）

- A013 语义缓存（query→answer）：`sango_query_embed` 判定；命中线 / 灰色区 `[0.8, hitLine)` 不命中；焦点词表 `FOCUS_CLASSES`（`F(A)∩F(B)=∅` 拒判）；写入门禁：拒答类（「演义中未涉及」+ citations 空）不写；embedding 失败旁路（不查不写不落 cache_logs）。
- **A016 口径统一**：缓存判定 embed **前**对 query 做与检索侧同一归一化（换说法 ↔ 规范形共享缓存条目）；实体表换代（normVersion 范围变更）须清缓存 / 递增产物版本（`cache.ts:12`）。
- 人名换说法命中：`normalizePersonNames`（字号归一化）沿用。
- 待办：门禁扩展为「bug-00028 支撑校验不通过也不写」（见 §13 待办 4）。

## 9. 观测（`mcp-orchestrator/src/storage/logs.ts` / `trace.ts` / `recallDiagnostics.ts`）

- traceId 贯穿 HTTP → MCP 调用 → 日志明细；`llm_call_logs` 记 attempt / reasoning_tokens / input_breakdown / max_tokens / **temperature 实参**；`tool_call_logs` 记 caller（model/server）+ stage（l3 / fastpath / classify / generation）；`cache_logs` 记命中判定与灰色区。
- 检索诊断回传 bm25Norm / cosine 全精度、hitLabels、分阶段 timing；A016 增 `query.rewrites` + `env.normVersion`（归一化改写明细）。
- A017 草稿台（`src/api/v1/draftbench.ts`）：traceId 拉取链路 / 手动发送 / 记录与 diff / 物理删除。

## 10. 评测

- **A015 回归标准集 = 唯一回归锚（2026-09-25 归档）**：实际 **120 题、12 类 × 10**（人物 / 地名 / 战役 / 典故 / 器物 / 身体部位 / 问法归一 / 官职·爵位 / 数字称谓 / 事件关系 / 死亡 / 拒答）；需求文档记「11 类 × 110」为早期口径，实测以 120 为准（差异待登记）；逐题原文核验；执行 = `test/standard-set/feat-A015-verify.mjs` 薄壳 → sango `POST /dev/benchmark/run`（判定单一实现）。
- 基线（快照 `test/standard-set/results/feat-A015-2026-09-27-2135.*`）：top5 通过 **73/120（60.8%）**、兜底 6–10 共 9、未命中 38；重灾区 = 官职·爵位 20%（未命中 6）/ 拒答 20%（未命中 7）/ 器物·身体部位 50%（各未命中 5）。
- 口径（负责人 2026-09-28）：A015 为验收标准；2400 问集仅作问题画像；题量不足可扩充（A015 已归档冻结，扩充走新特性号，不碰归档文档）。
- 2400 问画像：`test/cls2400.json` / `answerable2400.json` / `entity2400.json`；`recall-classify-900.mjs` 仍为旧字面 2-gram 口径（bug-00008 已关闭：结论基于当时代码与当时标准，当前不适用）。
- 回归脚本（零 LLM）：`mcp-orchestrator/scripts/probe/recall-bench.mjs`（V0~V3 检索配置 @1/@3/@5、主案例「孙权遣人向关羽求亲」、注入窗口截断率）、verify-injection-window.mjs / chunk-sweep.mjs / h2-faithfulness.mjs / build-poison-corpus.mjs。
- server 校验脚本：verify-embed-parity.mjs / verify-vector-fallback.mjs / verify_mcp.js / verify-tag-files.mjs（A014 已合入 main）。
- 基准集缺陷：bug-00035——基准集 v0.1 无 A016 归一化覆盖题（通过率恒 60%，归一化收益测不出），已打回待整改。

## 11. Bug / 需求状态对照（2026-09-28 以 main 核验）

| Bug | INDEX 状态 | main / 分支事实 | 判定 |
|---|---|---|---|
| bug-00003 召回质量 | 待修复 | 检索侧：实体表单表 + A016 query 改写（rewriteKey / fragmentOnly）+ A014 剥壳 / 死亡意图 death_age + 真向量 + 多路 0.6/0.3/0.1 均落地 main；剩余 MIN_COSINE Step4 + 评测口径（bug-00035 / 00007 / 00008） | 保持待修复，标题描述已落后 |
| bug-00007 / 00008 评测口径 | 已关闭（2026-09-28） | 结论基于当时代码与当时标准，当前不适用 | 负责人口径关闭 |
| bug-00022 题库并列候选 | 待修复 | 提示层已含「仅含义相同才答」，结构性保障未做 | 保持待修复 |
| bug-00023 主宾反转 | 待修复 | 生成轮 prompt 事件结构方向校验已合入（PR #20）；检索侧结构性前提校验未做 | 保持待修复 |
| bug-00024 渲染不一致 | 待修复 | 在途分支 `hu/bug-00024-00025_answer-assembly`（未合入） | 保持待修复 |
| bug-00025 内部编号泄漏 | 待修复 | 同上分支；`MAX_MODEL_QUOTE_LENGTH=30` 已有限制抄写 | 保持待修复 |
| bug-00028 片段不支撑仍答 | 已修复（09-24） | 合入 main（PR #22，e1c5267） | 已闭环；缓存门禁扩展为待办 |
| bug-00030 缓存开关持久化 | 已修复（09-25） | cache_settings 表持久化 | 已闭环 |
| bug-00031 同字不同人 | 待修复 | A016 冲突组不进表（子远 / 公明 / 子明 / 子孝） | 保持待修复 |
| bug-00032 / 33 / 34 护栏误拒 | 已修复（09-26） | 语义复核 + 改述口径（a121557 验收通过） | 已闭环 |
| bug-00035 基准集无归一化覆盖题 | 待修复（打回 09-26） | A015 基准 v0.1 通过率恒 60% | 待整改 |
| bug-00036 实体表真子串扩张 | 已修复（09-26） | 邻接延伸检查 + 逐键裁决 + §8 校验 | 已闭环 |
| bug-00037 引用不支撑 | 已修复（09-26） | 「人物之封」标签已撤（无噪声解法）；验收 6 改基线 6；拒答由编排护栏承接；结构门覆盖无指针叙述句 | 已闭环（口径改为基线） |
| bug-00038 空正文 + 3 次 LLM | 已修复（09-26） | 纯指针句豁免复核 + 空正文拒答 | 已闭环 |
| bug-00039 复核无上限 | 已修复（09-26） | 复核预算 = 1，MAX_BOUNDARY_REVIEWS 删除 | 已闭环 |
| bug-00040 护栏响应翻倍 | 已修复（09-26） | 引语片段句豁免复核 | 已闭环 |
| bug-00041 关公改写键 | 已修复（09-26） | normVersion b93c5ca9，recall-bench top10/miss/定点零回退 | 已闭环 |
| bug-00042 改写键双写 | 待修复 | rewriteKey 替换 query 后原文词身不保留 → 严格 top5 口径 2 题回退（4→6 / 5→7）；双写契约待设计（表设计 §2.2 / 接口 §2.3） | 待设计，见 §13 |

## 12. 在途分支（未合入 main，本地核验）

| 仓库 | 分支 | 内容 |
|---|---|---|
| mcp-orchestrator | `hu/bug-00024-00025_answer-assembly` | bug-00024 渲染一致性 + bug-00025 内部编号剥离（未合入） |
| mcp-orchestrator | `chen/bug-00012_test-log-isolation` / `coco/bl-016_sango-classics-probe` / `coco/feat-A006_citation-display` | 历史遗留分支（未合入，内容相关性未核） |
| mcp-web | `coco/feat-A006_citation-display` | 历史遗留分支 |

> 上一版在途：dev-docs `coco/feat-A999_docs-accuracy-state`（PR #46，已合入）、mcp-server `chen/feat-A014_tag-system`（PR #14，已合入 main 09-25）。

## 13. 已知待办（main 注释 / 文档明确标注）

1. `MIN_COSINE` 按真向量分布重定（Step 4，`sango-index.ts:60` 注释仍标死路值 0.3）。
2. **bug-00042 改写键双写契约**：rewriteKey 替换 query 的同时保留原文词身索引（表设计 §2.2 / 接口 §2.3 变更 + 索引重跑 + recall-bench 回测）。
3. bug-00035 基准集整改：按 A015 扩充 / 补归一化覆盖题（负责人 2026-09-28：扩充走新特性号）。
4. 缓存门禁扩展：bug-00028 支撑校验不通过也不写缓存。
5. bug-00024 排序稳定性排查 + bug-00025 输出层剥离 / 渲染层安全网（在途分支 `hu/bug-00024-00025_answer-assembly`）。
6. 窗口锚点按 A016 规范形复测（§9.2 古文拆名场景，2026-09-19 实证结论在 A016 后是否仍成立未复跑）。
7. 画像口径：`recall-classify-900.mjs` 旧字面 2-gram（bug-00008 已关闭：基于当时代码与标准，当前不适用），2400 问画像读数仅参考。

## 维护记录

| 日期 | 变更 | 拍板 |
|---|---|---|
| 2026-09-24 | 初版：以 main HEAD（orch e1c5267 / server b3d31c5）盘点全链路代码事实，登记过期点与在途分支 | 负责人 |
| 2026-09-28 | 第 2 版：锚点刷新（orch c68ac97 / server 946ff4c / web 6b47865）；同步 A014（剥壳 / death_age / verify-tag-files）、A015（benchmark 接口 + 120 题基线 60.8%）、A016（实体表单表 / rewriteKey-fragmentOnly / normVersion / 双侧归一化 / 诊断 rewrites）、A017（草稿台）、复核预算 1 与引语豁免（bug-00039/40）、bug-00030~42 状态对照、评测口径（A015 唯一回归锚） | 负责人（2026-09-28 指示更新）+ Coco（盘点） |
| 2026-09-28 | 生成轮默认温度 0.7→0.1（bug-00044 随票；chat 链路 server.ts DEFAULT_TEMPERATURE + agent/cli/draftbench 同源；复核与重试 temperature 0 不变） | 负责人（2026-09-28 拍板） |
| 2026-09-28 | 第 2 版：锚点刷新（orch c68ac97 / server 946ff4c / web 6b47865）；同步 A014（剥壳 / death_age / verify-tag-files）、A015（benchmark 接口 + 120 题基线 60.8%）、A016（实体表单表 / rewriteKey-fragmentOnly / normVersion / 双侧归一化 / 诊断 rewrites）、A017（草稿台）、复核预算 1 与引语豁免（bug-00039/40）、bug-00030~42 状态对照、评测口径（A015 唯一回归锚） | 负责人（2026-09-28 指示更新）+ Coco（盘点） |
