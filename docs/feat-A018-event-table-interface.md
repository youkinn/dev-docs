# FEAT-A018 事件表 + 事件名桥 —— 执行接口契约（表设计 / 加载 / 桥 / 诊断 / 回归）

> 用途：老陈按此实现 mcp-server 检索侧事件表加载、事件名桥、L1/L2 候选池并池重排与 L3 锚点置顶；表结构同时供 Coco 落表与 verify-events.mjs 校验。
> 契约定稿人：Coco；契约变更先问 Coco，不得自行改接口 / 字段。
> 需求依据：`requirements/feat-A018-event-table.md`（已定稿，口径唯一来源）。
> 前置契约：feat-A016（归一化 / entity-table 改写位点）、feat-A009（diagnostics 形状与透传）、feat-A015（dev benchmark runner / 回归基线）、feat-A004（语料 schema v2 / chunk.id 规则）。
> 故事号：story-A018-01。日期：2026-09-28。

## 0. 范围

本文定四件事：① `events.json` 表结构与 norm 版本 / 漂移挂钩；② 事件表加载、降级与内存口径；③ 检索侧事件名桥 + L1/L2 并池重排 + L3 锚点置顶契约；④ 诊断 eventHit 与 A015 回归口径。运行期检索 / 注入链路零新增 LLM（§7）。

## 1. 表设计（data/corpus/events.json）

### 1.1 落位与命名

- 文件：`sango/data/corpus/events.json`（与 `tags/` 平行、刻意分离：`tags/` 是「chunk → 标签」正向，事件表是「事件 → chunks」反查方向，不并入 tags 目录，见需求「检索接线」）。
- 检索侧单一实现模块：`sango/src/search/event-table.ts`（对齐 entity-table.ts 单一实现模式；进程内单例，编排侧不另写实现）。
- 事件表内容变更生效方式 = 重启进程（重新 load()），与 entity-table 同口径；无持久化索引产物。

### 1.2 文件格式

顶层两段：

| 段 | 类型 | 说明 |
|---|---|---|
| `meta` | object | `{ schemaVersion: 1, normVersion, generatedAt, corpusChunkCount }` |
| `rows` | array | 执行数据：eventId / eventName / aliases[] / chunkIds[] / type / characters[]? / exampleQuestion? |

- `normVersion` = rows 段规范化序列化的 8 位内容 hash（不含 meta 与 generatedAt），公式与 entity-table 同口径；表内容变更即换代（每次批次补录 = 新版本发布）。
- `corpusChunkCount` = 落表时语料 chunk 总数（当前 2344），语料重建漂移检测读数之一（§1.4、§2.3）。

rows 列定义：

| 字段 | 类型 | 必填 | 口径 |
|---|---|---|---|
| `eventId` | string | 是 | 行内唯一、跨行不重复（verify「无重复」项）；稳定标识，仅供诊断 / 缺口清单引用，实现不解析其格式（建议 Coco 定 E 序列）。 |
| `eventName` | string | 是 | 规范形，非空；与实体表命名单一口径（实体表管「怎么写」：写法与 entity-table canonical 同源；新增事件名须同步实体表，需求风险节）。 |
| `aliases` | string[] | 是 | 指称层名词性说法（白话别名 / 典故变体）。长度 ≥ 2（单字禁入，对齐 entity-table K1）；行内去重；**跨行全局唯一**（同一说法不属两组）；**与实体表任意行 rewriteKeys 无交集**（verify「aliases 与实体表改写键不冲突」）。桥的子串匹配对象（§3.2）。 |
| `chunkIds` | string[] | 是 | 只列段、不判对错；均须为语料 chunk.id（主键口径 §1.3）；运行时按事件内序重排（§1.3），表内顺序不承诺。 |
| `type` | 'L1' \| 'L2' \| 'L3' | 是 | L1 专名事件 / L2 情节单元 / L3 死亡·登场。桥不按 type 分流，仅作诊断与验收记录。 |
| `characters` | string[] | 否 | 人物（建议实体表 canonical 规范形）；本期桥与检索不消费，仅元数据备用。 |
| `exampleQuestion` | string | 否 | 需求明确「每行只留一条示例问法供理解与验收」；桥与检索不消费。 |

示例行（仅供理解，最终以 Coco 落表为准）：

```json
{ "eventId": "E0102", "eventName": "三英战吕布",
  "aliases": ["虎牢关三英战吕布", "三英围战吕布"],
  "chunkIds": ["sanguo-yanyi:0005:c0014", "sanguo-yanyi:0005:c0015"],
  "type": "L1", "characters": ["刘备", "关羽", "张飞", "吕布"],
  "exampleQuestion": "三英战吕布是怎么打的？" }
```

### 1.3 主键与事件内序

- 主键 = chunk.id（`{source}:{回号4位零补}:c{回内序号4位零补}`；需求 §13.6 裁决：不用语料行号）。
- **事件内序** = chunk 在原文出现顺序 = (chapter 升序, 回内 c 序号升序)。跨回事件按回号升序拼接。运行时统一按该序重排（防御乱序）：L3 锚点 ±N 前后扩展按该序取段；L1/L2 并池后进窗由池内重排决定，不再按事件序取子集。
- 跨回事件（chunkIds 覆盖 > 1 回）须有复核记录（verify V6，验收 1）。

### 1.4 norm 版本与语料重建漂移挂钩

- `meta.normVersion` 只由 rows 段内容决定（与 entity-table 同公式、同换代语义）；诊断 `eventHit.normVersion` 回传同一值。
- 事件表版本 ≠ 语料版本：语料重建（chunkIds 漂移）后事件表不自动失效，漂移由两级兜底预警：verify（每次落表，对语料文件全量校验存在性，验收 1）+ 加载期检测（§2.3，对运行时 docs 校验）。`meta.corpusChunkCount` 与当前语料 chunk 数不一致即告警（重建信号）。

### 1.5 数据校验清单（verify-events.mjs 与加载共用同口径）

| # | 校验 | 失败处理 |
|---|---|---|
| V1 | eventId 非空且跨行唯一 | verify 失败 / 加载剔行告警 |
| V2 | eventName 非空 | 同上 |
| V3 | aliases：长度 ≥ 2、行内去重、跨行唯一、与实体表任意行 `rewriteKeys` 无交集 | 同上（verify） / 加载剔该 alias 告警 |
| V4 | chunkIds 均存在于当前语料 | verify 失败；加载按 §2.3 漂移口径处理 |
| V5 | type ∈ {L1, L2, L3} | verify 失败 / 加载剔行告警 |
| V6 | 跨回事件有复核记录（落表侧登记） | verify 失败 |
| V7 | meta 完整（normVersion / corpusChunkCount 存在） | verify 失败 |
| V8 | L3 行 chunkIds = 锚点 ±N 小位点组（2-5 段、同回、含锚点；tags 锚点 + gap「L3 锚点人工核证」） | verify 失败 |

## 2. 数据加载契约

### 2.1 加载时机与内存

- `SangoIndex.load()` 内、docs 构建完成且 `docIndexOf`（chunkId → 文档下标，现有成员）就绪后，与 `loadTags` 同阶段加载。理由：事件桥与漂移检测都需要 chunkId → doc 反查，必须在 docs 集合确定后执行。
- **启动期全量载入内存：是。** 400–600 行、千余别名与 chunkId 引用为 KB 级，可忽略；对齐 tags 全量载入先例与 entity-table「运行时零计算」原则——sango 只读文件，加载时建「alias → 事件」「chunkId → 事件」索引，检索时只查不建。

### 2.2 加载失败与降级（判断与理由）

- **我的判断：事件表属检索增强，可降级告警、不阻断启动，与核心语料区分。** 核心语料缺失 / 格式非法 = 终止启动（现状不变）；事件表失败 = 告警 + 降级「无事件路由」，检索与工具继续工作。理由：① 事件表只增强召回与注入组闭环，失败不劣化主链路；② 与 loadTags 降级先例、entity-table「白名单表宁降级不可崩」同一口径；③ 降级可观测（eventHit.degraded，§5.2），不静默。
- 失败分类（任一 → stderr `[sango] event-table 加载失败：{原因}，降级为无事件路由`，事件路由禁用：不匹配、不插入）：
  - 文件缺失 / JSON 损坏 / 顶层结构非法（非 `{ meta, rows }`）/ rows 非数组 / 有效行数 0。
- 单行 / 单 alias 违规不整表拒绝（对齐 entity-table 违规键剔除先例）：V1/V2/V5 级违规剔行告警；V3 级单条 alias 违规剔该 alias 告警（rewriteKeys 冲突属构建期 verify 拦截，加载期兜底剔除）；漂移按 §2.3。

### 2.3 漂移检测（加载期）

对全部 rows 引用的 chunkId 与 `docIndexOf` 比对：

- 缺失占比 > 5% → 整表降级（无事件路由 + 告警）。
- 0 < 缺失占比 ≤ 5% → 剔除缺失 chunkId（保留其余引用）+ 告警；组空则等效无事件路由。
- `meta.corpusChunkCount` ≠ 当前 docs 数 → 告警（重建漂移信号，不阻断）。
- 全过 → 正常路由。

### 2.4 启动日志

- 成功：`[sango] event-table loaded: rows={n} aliases={m} chunkRefs={k} normVersion={v}`（对齐 entity-table loaded 日志，供请求级排查对照）。
- 漂移剔除 / 告警同样落 stderr。

## 3. 事件名桥检索契约

### 3.1 管线插入位置

```
query(raw)
 → normalize(query)（A016 rewriteKeys，变体 / 换说法在此收敛）        ← 归一化
 → 三路候选（BM25 + 向量 + 标签）+ 死亡意图置顶                       ← 变体多路候选
 → matchEvents(normalized)：alias 子串匹配 → 命中事件组（事件内序）     ← 事件名桥
 → topK 装配（三路排序结果 + 事件组插入 rank 6+，§3.3）               ← 合并 topK
 → entries 出参（sango_novel_search）→ 编排侧注入                     ← 注入
```

- 桥只读 `normalized`：不新增 LLM 调用、不新增改写键（aliases 只匹配不改写，A016 口径不动）、不触发向量编码、不参与加权打分（§3.4）。
- 桥执行点：归一化之后、topK 装配之前（实现上在标签路由与死亡意图判定之后、合并排序之后立即执行，耗时并入 merge 段计时，不新增 timing 字段）。

### 3.2 匹配规则

- 匹配对象：`normalized` 全文子串（alias 原文即匹配串，不做二次归一化；alias 若含改写键，verify V3 已拦）。
- 单组命中：全部有效 alias（漂移剔除后、长度 ≥ 2）按长度降序、同长按 (eventId 升序, 表内顺序) 升序逐个尝试，首个 `includes` 命中的 alias → 所属组命中，`matchedAlias` = 该 alias（组内多 alias 命中取最长者）。
- 多组命中：命中组不再参与后续匹配；对其余组按同规则继续。组优先级（增强查询取组 / L3 置顶顺序）= 命中 alias 长度降序，同长 eventId 升序。

### 3.3 组内闭环与 topK 装配（并池重排 + L3 锚点置顶，最终出参序算法）

输入：`combined` = 三路合并候选；`groups` = matchEvents 结果（组内 chunkIds 已按事件内序重排）；`bm25Norm`（全语料预计算）与词法索引；`limit`（工具 limit，≤ 20）。输出：`final`（长度 ≤ limit）。

```
① 匹配分流：matchEvents(normalized) → L3 组（死亡 / 登场）与 L1/L2 组分治
② L3 锚点置顶：组锚点段（标签位点段）±N 前后扩展（按事件内序取段，N ∈ 1..3 回测定档 v1=1）
   构成 2-5 段小位点组，并入死亡意图置顶通道（现有 deathHits 排序两级、死因/遗言/年龄意图
   分型不变），直接进保证区（rank 1-5），不参与池重排
③ L1/L2 并池：命中组全部有效 chunk 并入候选池——cands 按 doc 下标并集去重、无来源配额；
   组 chunk 用全语料预计算的 bm25Norm / cosine 按同一公式（§3.4）出初始分，零新增计算；
   合并池硬上限 120 兜底，超限按重排分裁（正常场景触不到：三路 ≤50 + 最大组 59）
④ 池内重排（与三路同公式）：增强查询 = normalized + canonical 事件名（多组命中按组优先级
   取前组）+ 命中 alias；按增强查询重跑 BM25、重算全池 bm25Norm 分量，按原公式
   0.6·cos + 0.3·bm25 + 0.1·tag 全池重排——唯一变化 = bm25Norm，cosine / tag 分量不变
   （cosine 不重编码，红线 §7）；增强作用于全池候选，事件组无独立加分项
⑤ 取窗：规则重排后取 top50 为 A030 cross-encoder 输入（重排窗口已实现可一行启用，保证区置顶段不参与、重排 query = normalized、失败降级退回规则序；A030 实测延迟 P95 4662ms 超预算、拒答#5 证据段跌出 top10——接/不接由负责人拍板，未拍板前按不启用处理，过渡期直接取 limit）；
   final = 重排后 combined[0..limit)，L3 置顶段经保证区排序与 ③④⑤ 结果按现状
   deathHits 两级排序合并
```

性质（契约承诺）：

- **提权 = 并池 + 增强查询重排，非排序侧覆盖**：L1/L2 组 chunk 以真实分参与全池排序，进不进窗由自然序决定；不占无分插槽、不置顶、不改权重（§3.4）。
- **L3 唯一答案 case 走保证区**：死亡 / 登场位点精确（标签实测 1-2 段），锚点 ±N 小位点组置顶、绕过池重排；这是本版唯一允许的「走后门」路径。
- **top5 语义**：非事件命中请求 top5 与现状逐字节一致（结构免疫保留）；事件命中请求 L1/L2 经重排改变池序、L3 经保证区置顶改变 top5 —— A015 由构造免疫改为实测门（§8）。
- **第二路召回取消**：并池后 combined 恒含组 chunk（三路全空时纯向量兜底 + 并池构成），原「combined 空 → 事件组自 rank 1 起」兜底分支删除。
- 空事件路（表降级 / 未命中）→ 与现状实现逐字节一致。

### 3.4 事件路不加权重（不弱加权）

- 事件组 chunk 不通过权重加法提权（需求 §14 教训：0.1 权重被量纲吃掉、名存实亡；权重提到 ≥0.3 量级即等效置顶、破坏池内排序可比性）；L1/L2 提权 = §3.3 并池 + 增强查询重排，L3 = 锚点置顶（唯一答案 case 的排序覆盖）。**增强查询重排与三路合并共用同一加权公式（0.6·cos + 0.3·bm25 + 0.1·tag）**：唯一变化 = bm25Norm 按增强查询重算，cosine / tag 分量逐项不变，增强作用于全池，事件组无独立加分项——全池同一把尺子。
- **实测校准意图**：回测对照 bridge on/off——事件问法证据进窗率（top5 / 窗口内）+ displaced 自然候选清单与相关性；读数随验收结论登记。若重排后组 chunk 仍难进窗，下一位为组内证据定位（组内 BM25 top-k 先行），另行评估、不阻塞本期。
- **问法骨架（检索侧配置，不进表）本期仅落地「增强查询」形态**：事件名并入查询重排（§3.3④）；疑问句模板「组织改写 / 召回」仍不做（§9），覆盖扩张由覆盖率 KPI 驱动。

## 4. 变体多路合并 topK 契约（与现有合并的交互）

- 三路候选、加权分公式、归一化、死亡置顶、`funnel.mergedCandidates`、`nextRank` / `gapToTopN` 口径全部不变。
- 桥改变池构成与排序：L1/L2 命中组 chunk 并入候选池（封顶 50），池内按增强查询重算 BM25 后重排；L3 置顶进保证区（既有 deathHits 两级排序通道）。无「事件组插槽」概念。
- `diagnostics.candidates[]` 按重排后的池序计算（事件命中请求）；非事件请求下 candidates 数据与现状逐字节一致（强回归性质）。
- **candidates[].rank 语义**：最终出参序 = 重排后池序前 limit（L3 置顶段经保证区排序并入），可由 candidates + eventHit 完全重建；rank 与最终出参序不一致只出现在事件命中请求。
- 事件组并池与置顶的计数不进「召回漏斗」（漏斗只描述三路召回），由 eventHit 承载（§5.2）。

## 5. 出参与诊断契约

### 5.1 sango_novel_search 出参结构不变

- entries 仍为裸 JSON 数组的 `SearchEntry[]`，字段（id / text / chapter / title / type / segFrom / segTo）一字不动；事件组 chunk 以普通条目出现，无新增条目字段。
- diagnostics 只随 `result._meta.diagnostics` 回传（traceId 请求时），`content` 不受影响（A009 既有口径）；编排侧不透明透传（recallDiagnostics 零改动，§6）。

### 5.2 `_meta.diagnostics` 增 `eventHit`（新增顶层字段，老字段不动）

```ts
export interface RetrievalEventHitDiagnostics {
  /** 事件路是否生效；false = 表加载失败或整表漂移降级（此时 groups 恒 []）。 */
  degraded: boolean;
  /** 事件表 meta.normVersion；未加载为空串（对齐 env.normVersion 降级口径）。 */
  normVersion: string;
  /** 命中事件组数；0 = 未命中事件路。 */
  groupCount: number;
  /** 命中组明细，按组优先级（命中 alias 长度降序，同长 eventId 升序）。 */
  groups: RetrievalEventHitGroup[];
}
export interface RetrievalEventHitGroup {
  eventId: string;
  eventName: string;
  /** 本组命中的 alias（归一化后 query 中子串命中者，组内最长）。 */
  matchedAlias: string;
  type: 'L1' | 'L2' | 'L3';
  /** 组内有效 chunk 引用总数（漂移剔除后）。 */
  groupSize: number;
  /** 实际进出参条目的事件组 chunk 数（L1/L2 重排后自然进窗 ∪ L3 保证区置顶；= placedChunkIds.length）。 */
  placedCount: number;
  /** 进出参条目的事件组 chunkId（L3 锚点组按事件内序；L1/L2 按重排后出参序）。 */
  placedChunkIds: string[];
}
```

- 非 traceId 请求不产诊断（现状不变，事件路照常工作）；诊断体积有界（placedChunkIds ≤ limit，既有 enforceDiagnosticsBudget 64 KB 预算兜底）。
- 空结果早退路径也要产出 eventHit（未命中时 degraded / normVersion 仍可读，groups 空）。

### 5.3 `candidates[].sources` 扩展

- 可选新增枚举值 `'event'`：该候选同时属某命中事件组（来源标记，便于漏斗核对）；其余字段与语义不变。老消费方（前端）零影响（宽容展示未知枚举值；如不宽容按 A016 增字段先例前端同步展示）。
- 再增可选枚举值 `'allusion'`：该候选同时属某命中典故组（与 `'event'` 同机制）。来源列展示「典故」标签，鼠标移入显示命中典故名（同事件处理）。

### 5.4 `timing.rerank` 与 `rerank` 诊断（test-2031 提测反馈补可观测）

- **阶段链口径**：规则序并池（多路候选合并 + 事件路并池增强查询重排 + 规则排序）→ 取窗之前；保证区（死亡意图 ∪ L3 锚点）不参与池重排；事件路增强查询重排计入 `timing.merge`，**不含** cross-encoder 重排。
- `RetrievalDiagnosticsTiming` 增 `rerank: number | null`：cross-encoder 池内重排段耗时（毫秒）；未接入打分器 / 窗口内无参与候选 / 跳过时为 null（与 merge 互斥分段，合并后 `merge + rerank ≈ 原 merge`）。
- `RetrievalDiagnostics` 增顶层 `rerank: RetrievalRerankDiagnostics`（老字段不动；空结果早退 / 无命中路径也产出默认值，`enabled` 如实反映是否接入打分器）：

| 字段 | 类型 | 语义 |
|------|------|------|
| enabled | boolean | 本请求是否接入重排打分器（装配层注入且权重可用） |
| window | number | 重排窗口（规则序后前 N 名进重排；`SANGO_RERANKER_WINDOW` 覆盖，默认 50） |
| considered | number | 实际参与重排条数（窗口内非保证区） |
| skippedPinned | number | 因在保证区置顶（死亡意图 ∪ L3 锚点）而跳过重排条数 |
| applied | boolean | 是否按重排分实际改写池序 |
| reason | string \| null | 未重排的中文原因；applied=true 时为 null。取值：未接入重排打分器 / 窗口内无参与候选 / 重排打分异常 / 重排分数非法 |

- 每请求一行 `[sango]` 中文日志（console.error）：窗口 / 参与 / 跳过置顶 / 耗时 / 结果（生效或跳过 + 原因）。

### 5.5 重排开关（`SANGO_RERANKER` env，自助启用）

- 装配层按 `sango/.env` 的 `SANGO_RERANKER` 决定是否接入 cross-encoder 重排（`--env-file-if-exists=.env` 加载，Node v22 内置，无 dotenv 依赖）：
  - `on` → 接入 `createDataRerankScorer()`；权重 / 分词器缺失 → 不接入、走既有降级（不抛错），启动日志写明原因；
  - 未设 / `off` / 其他值 → 不接入，行为与默认基线逐字节一致（不改动提测基线）。
- **口径约束（必读）**：
  - `on` 只代表「接入重排」，**不等于 A030 验收通过**——定点不倒车（华雄 / 刘备）/ 拒答#5 结论仍待复评；
  - 默认 `off`，测试与既有快照不受影响；
  - 改 `sango/.env` 后需**重启 mcp-server** 生效。
- 调参：`SANGO_RERANKER_DIR`（换权重目录）/ `SANGO_RERANKER_WINDOW`（重排窗口，默认 50）/ 推理档位见 `src/search/reranker.ts` 顶部说明。

### 5.6 `_meta.diagnostics` 增 `allusionHit`（典故表诊断，镜像 eventHit）

```ts
export interface RetrievalAllusionHitDiagnostics {
  /** 典故路是否生效；false = 典故表缺失 / 加载失败 / 整表漂移降级（此时 groups 恒 []）。事件路不受影响。 */
  degraded: boolean;
  /** 典故表 meta.normVersion；未加载为空串。 */
  normVersion: string;
  /** 命中典故组数；0 = 未命中典故路。 */
  groupCount: number;
  /** 命中组明细，按组优先级（命中 alias 长度降序，同长 allusionId 升序）。 */
  groups: RetrievalAllusionHitGroup[];
}
export interface RetrievalAllusionHitGroup {
  allusionId: string;
  allusionName: string;
  /** 本组命中的 alias（归一化后 query 中子串命中者，组内最长）。 */
  matchedAlias: string;
  /** 组内有效 chunk 引用总数（漂移剔除后）。 */
  groupSize: number;
  /** 实际进出参条目的典故组 chunk 数（重排后自然进窗，= placedChunkIds.length）。 */
  placedCount: number;
  /** 进出参条目的典故组 chunkId（按重排后出参序）。 */
  placedChunkIds: string[];
}
```

- 与 eventHit 同机制：典故表经事件桥同机制加载匹配、命中组并池重排；典故加载失败只降级典故路（`degraded=true`），事件路不受影响。
- 空结果早退路径同样产出 allusionHit（未命中时 degraded / normVersion 仍可读，groups 空）。
- 诊断体积有界（placedChunkIds ≤ limit，既有 enforceDiagnosticsBudget 64 KB 预算兜底）。

## 6. mcp-orchestrator 契约

**结论：不需要 hu 分支。** 默认无契约变化。依赖的三条现状（均已存在，不改动）：

1. 快路径调 `sango_novel_search` 的 `limit: 10`（agent.ts 快路径与注入路径两处）；L1/L2 并池重排后不再依赖 6-10 插槽容量，默认 limit=5 路径事件段也可按自然序进窗（无插槽归零问题，见 §11）。
2. 注入策略：前 `INJECT_HEAD_GUARANTEE(5)` 段整段保底（可软超预算）+ 第 6 段起整段在 `INJECT_TOTAL_BUDGET(2000)` 预算内依次纳入、超预算丢整段、绝不段内裁剪（citation.ts）。
3. 诊断不透明透传：`recallDiagnostics.ts` / `storage/logs.ts` 原样落库回传，零改动（A009 / A016 先例）。

- **证据进窗成立机制**：L1/L2 事件段经并池重排按自然序进窗（rank 越前进窗概率越高，预算语义不变）；L3 锚点置顶段在保证区（rank 1-5 保底注入），唯一答案 case 必进窗。
- **触发 hu 分支的条件（本版不满足、明确不做）**：要求事件组跨预算豁免、L3 组参与池重排、或编排侧需感知事件组身份做选择。任一需求出现 → 先改本文档再评估 hu 分支。

## 7. 红线（零新增 LLM）

- 运行时检索 / 注入链路**零新增 LLM 调用**：事件名桥 = 子串匹配 + 并池重排 + L3 锚点置顶，纯规则；不改写键、不新增调用位点、不重编码向量；原有生成 1 次 / 复核 ≤ 1 次预算不变（需求验收 6）。
- 构建期初审材料 LLM 调用（生成 ≤ 6 + 复核 ≤ 1，按回分批，仅本次全集构建）已按原则 14 报备登记，与运行期无关。

## 8. A015 回归

- 命令（A015 §7）：`cd D:\workplace\mcp-server\sango` → `npm run dev`（build + SANGO_DEV_HTTP_PORT=8787）→ `POST http://127.0.0.1:8787/dev/benchmark/run`（runner 以 `search(question, 50)` 执行，快照落 `{SANGO_BENCHMARK_RESULTS_DIR}`）。
- **通过口径**：整体 `summary.top5 ≥ 0.608`（基线 60.8%）；**事件类逐类不倒退**——`summary.category` 中「战役 / 典故 / 事件关系 / 死亡」四类各自 top5 命中数 ≥ 同基线快照（`feat-A015-*.json`）对应类别值；tail / miss 记录留档对比。
- **实测门（2026-09-28 需求变更，取代构造免疫）**：非事件命中请求结构与现状逐字节一致；事件命中请求 top5 由并池重排 / L3 置顶改变，回归以实测为准——整体不倒车 + 事件类逐类不倒退 + bridge on/off 对照（事件问法 top5 证据命中率）。
- 事件类定点自查（实现轮）：`温酒斩华雄` / `三英战吕布` / `草船借箭` / `空城计` 等 traceId 请求：`eventHit.groups` 非空、`placedChunkIds` 与期望回区间吻合、编排侧注入视图（`[片段N]`）可核对事件组 chunk 在列。
- **L3 档位定档**：回测对照锚点 ±1 / ±2 / ±3 三档（证据进窗率 + 保证区占用 + 叙事完整性），v1 默认 ±1，定档结果随验收结论登记。
- **A030 合并验收（需求变更 2026-09-28）**：本期随 A030 一并提测验收——池覆盖探针、cross-encoder 重排 50→10 接入、top≤5 不低于无重排基线、定点（华雄 / 刘备）不倒车、延迟预算（P50 / P95）。

## 9. 边界（不做）

- 知识图谱本体 / 事件因果时序（需求非目标，BACKLOG BL-031 / feat-A021）。
- 问法骨架疑问句模板「组织改写 / 召回」（§3.4；增强查询 = 事件名并入重排已落地，模板改写另立课题）。
- 事件路加权打分 / 权重调参（不做权重加法；校准另议）。
- 事件组无分插槽 / 「整组进注入、事件内序子集」承诺（2026-09-28 取消，见 §3.3）。
- 改 chunk / 向量 / 语料（零重建，需求非目标）；向量 bin 不重跑（事件路不依赖向量）。
- 标注 chunk 对错（chunkIds 只列段、不判对错）；query 新增改写键（aliases 只匹配）。
- 改注入策略 / orchestrator（§6）。

## 10. 验收映射

| 需求验收 | 落点 |
|---|---|
| 4 事件名桥 + 并池重排 + L3 锚点置顶（L1/L2 整组并池重排自然取窗；L3 位点锚定 ±N 置顶保证区） | §1、§2、§3、§6 |
| 5 A015 同基线回归不倒车（top5 ≥ 60.8%，事件类逐类不倒退） | §8 |
| 6 运行时链路零新增 LLM | §7 |
| 1 表结构与 verify 校验（chunkIds 存在 / eventName 非空 / aliases 不冲突 / 无重复 / 跨回复核） | §1.2、§1.5（校验口径供 verify-events.mjs 与加载共用） |
| 长期机制（事件表 norm 版本化 + 语料重建漂移检测） | §1.4、§2.3 |
| 接口影响（出参结构不变；eventHit 复用 A009/A016 通道；orchestrator 默认无变化） | §5、§6 |

## 11. 已知约束与风险

- `candidates[].rank` 语义修订（§4）：事件命中请求下与最终出参序可能错位；最终序可由 candidates + eventHit.placedChunkIds 重建，前端展示按候选池序不变。
- 误匹配风险（白话误中 alias）：最长优先 + 单字禁用 + alias 跨行唯一 + A015 事件类回归门兜底；误匹配将增强查询引向错误事件名 → 池内重排偏移，代价 = 事件问法窗口质量下降（A015 事件类逐类门兜底）。
- 增强查询重排的组内证据定位强度：BM25 词项重合不足以区分组内证据段时，证据段可能仍在窗口边缘——回测对照 bridge on/off 量化；不足以则下一位为组内 BM25 证据定位（另行评估）。
- 预算断尾仍可能截掉 rank 6+ 自然段（L1/L2 事件段进窗概率随 rank 衰减）：不改注入策略（§6），进窗保证只对 L3 保证区成立。
- 语料重建后 chunkIds 失效：加载期漂移检测降级（§2.3，5% 阈值）；verify 每次落表全量校验。
- L3 锚点 ±N 档位为回测定档参数（v1 默认 ±1）；默认 limit=5 时 L3 置顶在保证区（rank 1-5）内仍成立，L1/L2 按自然序进窗——无插槽归零问题。
- 漂移阈值 5% 与剔除策略为首版口径：若语料重建频发或误报，按 bug 流程调整（先 Coco 复核）。

## 维护记录

| 日期 | 改动 | 拍板人 |
|------|------|--------|
| 2026-09-28 | §5.5 补重排开关口径：SANGO_RERANKER env 自助启用（默认 off 不改基线；on 仅代表「接入重排」、不等于 A030 验收通过，定点不倒车 / 拒答#5 仍待复评；改 .env 需重启生效） | 负责人 |
| 2026-09-28 | §5.4 补检索重排可观测契约：timing.rerank 独立分段（merge 收窄为不含 cross-encoder 重排）+ 顶层 rerank 诊断（enabled / window / considered / skippedPinned / applied / reason），保证区不参与、事件路增强查询重排计入 merge | 负责人（test-2031 提测反馈） |
| 2026-09-28 | §3.4 回测读数入档：A015 快照 feat-A015-2026-09-28-0519 top5=73/120（60.83%，基线 60.8% 达标，四类逐类零倒退）；桥对 top5 装配变化 0 题（构造免疫实测成立）；top6–10 变化 23 题（事件组占位），示例「赤壁之战发生在哪里」答案段 rank20(miss)→rank6(tail)；事件表加载实测 rows=708 aliases=1638 chunkRefs=8205 normVersion=ab25ac91 无漂移告警 | Coco |
| 2026-09-28 | 需求变更：契约重写——L1/L2 取消无分插槽与「整组进注入」，改整组并池 + 增强查询（事件名）BM25 重排自然取窗；L3 死亡/登场改标签位点锚定 ±N（回测定档 v1 ±1）置顶保证区（并入死亡意图通道、不参与池重排）；第二路召回兜底删除；A015 改实测门并与 A030 合并提测验收 | 负责人 |
| 2026-09-28 | 契约澄清：并池合并口径——三路候选与事件组 chunk 按 doc 下标并集去重、无来源配额，合并池硬上限 120 兜底；池内重排与三路同公式（0.6 / 0.3 / 0.1），唯一变化 = bm25Norm 按增强查询重算、cosine / tag 不变、增强作用于全池、事件组无独立加分项；截断在重排后（top50 为 A030 cross-encoder 输入；A030 本期必接，接入前过渡期直接取窗） | 负责人 |
| 2026-09-28 | §1.5 校验清单增 V8（L3 锚点结构）；数据侧 L3 行 chunkIds 重建为「标签位点段 ±N」口径（N=1 档位常量留回测口，rebuild-l3-anchors.mjs 零 LLM），11 行 tags 未覆盖 / 回号纠正行人工锚点核证（gap.md 登记） | Coco |
| 2026-09-28 | 契约裁定（Coco）：L3 数据口径 = 落表即「锚点 ±N」小位点组（rebuild-l3-anchors.mjs 产出），运行期直接消费组内序、不二次扩展；回测 N 档位（±1/±2/±3）经数据换版实现 | Coco |
| 2026-09-28 | 契约裁定（Coco）：事件请求下 candidates[].bm25Norm 回传增强查询归一值（内部 bm25NormOverride）——即 §3.4「唯一变化 = bm25Norm 按增强查询重算」，同时保住 bug-00013 复算恒等式；非事件请求取值零变化 | Coco |
| 2026-09-28 | §3.4 回测读数：真实问法「赤壁之战发生在哪里」答案段 0049:c0018 bridge off rank20 → on rank14（前移 6，未进 top10——该段仅含「赤壁」词元、增强查询直接增益≈0）；机制用例确定性进 top5；按 §3.4「组内 BM25 证据定位」为下一位、不阻塞本期 | Coco |
| 2026-09-28 | A030 实测落档（接/不接待负责人拍板）：池覆盖定点 4/4 证据段入 50 路池（100%）；拒答#5 证据段 rank6→0 跌出 top10（不倒车不达标）；延迟 P50 4134 / P95 4662ms（超预算）；重排窗口/打分器已实现可一行启用、库层默认不启用，改进方向待重评（截断 128-256 / 分桶批量 / 更小模型 / GPU / top-20）；§3.3⑤ 原「A030 本期必接」修订为「按负责人拍板」 | Coco |
| 2026-09-28 | A030 延迟预算口径拍板（负责人）：重排阶段 P95 ≤ 1000ms（P50 ≤ 600ms 为 Coco 建议值、未拍板）；4s 实测属「当前配置下延迟」（batch=1 未调线程/graph opt），归因矩阵进行中（首查电源计划 / CPU 频率——节能模式锁频放大延迟），接/不接待归因后定 | 负责人 |
| 2026-09-28 | A030 归因矩阵结论：4134/4662ms 属配置问题而非模型固有（平衡电源计划、CPU 满频 3.2GHz）；锁定配置 intra=8 + 截断 128 + batch=16 + 窗口 20，实测 P50 727ms / P95 787ms（smoke 档 20 次，P95 ≤ 1000ms 达标）；完整矩阵未跑，负责人 09-28 指示按 smoke 档继续 | Coco |
