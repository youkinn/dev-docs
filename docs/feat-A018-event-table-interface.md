# FEAT-A018 事件表 + 事件名桥 —— 执行接口契约（表设计 / 加载 / 桥 / 诊断 / 回归）

> 用途：老陈按此实现 mcp-server 检索侧事件表加载、事件名桥与组内闭环注入装配；表结构同时供 Coco 落表与 verify-events.mjs 校验。
> 契约定稿人：Coco；契约变更先问 Coco，不得自行改接口 / 字段。
> 需求依据：`requirements/feat-A018-event-table.md`（已定稿，口径唯一来源）。
> 前置契约：feat-A016（归一化 / entity-table 改写位点）、feat-A009（diagnostics 形状与透传）、feat-A015（dev benchmark runner / 回归基线）、feat-A004（语料 schema v2 / chunk.id 规则）。
> 故事号：story-A018-01。日期：2026-09-28。

## 0. 范围

本文定四件事：① `events.json` 表结构与 norm 版本 / 漂移挂钩；② 事件表加载、降级与内存口径；③ 检索侧事件名桥 + 组内闭环 topK 装配契约；④ 诊断 eventHit 与 A015 回归口径。运行期检索 / 注入链路零新增 LLM（§7）。

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
- **事件内序** = chunk 在原文出现顺序 = (chapter 升序, 回内 c 序号升序)。跨回事件按回号升序拼接。运行时统一按该序重排后作为组内子集序，不依赖表内书写顺序（防御乱序）。
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
- 多组命中：命中组不再参与后续匹配；对其余组按同规则继续。组优先级（进插槽顺序）= 命中 alias 长度降序，同长 eventId 升序。

### 3.3 组内闭环与 topK 装配（最终出参序算法）

输入：`naturalTop` = 三路合并排序后的候选（含死亡置顶，现状实现）；`groups` = matchEvents 结果（已按事件内序）；`limit`（工具 limit，≤ 20）。输出：`final`（长度 ≤ limit）。

```
final = []; placed = Set<chunkId>
① 头保底：naturalTop[0..4] 原序入 final（naturalTop 不足 5 则全取）；记 placed
② 事件组插槽：按组优先级依次，组内按事件内序逐 chunk：已 placed 跳过，否则入 final；
   直至 final.length == limit 或组耗尽（大组 = 事件序前缀截断）
③ 补足：naturalTop[5..] 未 placed 的按原序补入，直至 limit
```

性质（契约承诺）：

- **组内闭环**：事件命中时，事件组作为整体优先占用出参窗口；组 ≤ 插槽容量（limit − 已占头保底段数）时整组进入，大组按事件内序取前缀子集。插槽容量与编排侧预算（§6）是对组内子集的双重截断，截断均按事件内序。
- **第二路召回**：三路 combined 为空而事件命中时，final 由事件组构成（自 rank 1 起按事件内序）——白话问法在词法 / 向量 / 标签全未命中时仍可召回证据组。
- **top5 语义严格不变**：naturalTop[0..4] 原序、原分，事件组只影响 rank 6+ 装配 → A015 top5 由构造免疫（§8）。
- 空事件路（表降级 / 未命中）→ §3.3 恒等于现状实现（`hits = combined.slice(0, min(limit, n))` 逐字节一致）。

### 3.4 事件路不加分（不弱加权）

- 事件组 chunk **不进入**三路加权公式（`0.3·bm25Norm + 0.6·cosine + 0.1·label`），不做 0.1 式弱加权（需求 §14 教训：0.1 权重被量纲吃掉、名存实亡）；其「提权」= §3.3 插槽保证（rank 6+ 连续占用）。
- **实测校准意图**：实现轮回测记录桥对 top6–10 装配的影响（组 chunk 占位后 displaced 的自然候选清单与相关性），回测读数记入本文档「维护记录」；若后续需在组内与自然候选间做排序调整（组内不打散的前提下），另行评估，不阻塞本期。
- **问法骨架（检索侧配置，不进表）本期不实现**：表内 exampleQuestion 仅验收用。理由：组内闭环已由桥保证证据进注入窗口，骨架模板「组织改写 / 召回」属后续覆盖扩张课题（由覆盖率 KPI 驱动），本期范围不膨胀（需求验收 4 不依赖）。

## 4. 变体多路合并 topK 契约（与现有合并的交互）

- 三路候选、加权分公式、归一化、死亡置顶、`funnel.mergedCandidates`、`nextRank` / `gapToTopN` 口径全部不变。
- 桥只改变 topK 装配的条目来源构成：rank 1–5 恒为 naturalTop 前 5；rank 6+ 先事件组（事件内序）后 naturalTop 6+。
- `diagnostics.candidates[]` 仍按 combined（三路合并去重后的候选池）计算，**不随桥插入变化**——避免语义漂移，且非事件请求下 candidates 数据与现状逐字节一致（强回归性质）。
- **candidates[].rank 语义澄清**（契约修订）：原「按最终返回序」改「三路合并候选池序（topK 装配前）」。事件命中时最终出参序 = naturalTop 前 5 → `eventHit.groups[].placedChunkIds`（组优先级 + 事件内序）→ naturalTop 6+，可由 candidates + eventHit 完全重建；rank 与最终出参序的错位只出现在事件命中请求。
- 事件组插槽的计数不进「召回漏斗」（漏斗只描述三路召回），由 eventHit 承载（§5.2）。

## 5. 出参与诊断契约

### 5.1 sango_novel_search 出参结构不变

- entries 仍为裸 JSON 数组的 `SearchEntry[]`，字段（id / text / chapter / title / type / segFrom / segTo / quoteBalanced / quotes）一字不动；事件组 chunk 以普通条目出现，无新增条目字段。
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
  /** 实际进出参条目的事件组 chunk 数（事件内序前缀；= placedChunkIds.length）。 */
  placedCount: number;
  /** 进出参条目的事件组 chunkId（事件内序）。 */
  placedChunkIds: string[];
}
```

- 非 traceId 请求不产诊断（现状不变，事件路照常工作）；诊断体积有界（placedChunkIds ≤ 插槽容量，既有 enforceDiagnosticsBudget 64 KB 预算兜底）。
- 空结果早退路径也要产出 eventHit（未命中时 degraded / normVersion 仍可读，groups 空）。

### 5.3 `candidates[].sources` 扩展

- 可选新增枚举值 `'event'`：该候选同时属某命中事件组（来源标记，便于漏斗核对）；其余字段与语义不变。老消费方（前端）零影响（宽容展示未知枚举值；如不宽容按 A016 增字段先例前端同步展示）。

## 6. mcp-orchestrator 契约

**结论：不需要 hu 分支。** 默认无契约变化。依赖的三条现状（均已存在，不改动）：

1. 快路径调 `sango_novel_search` 的 `limit: 10`（agent.ts 快路径与注入路径两处）——闭环所需的插槽容量（10 − 5 头保底 = 5 段）由此保证；工具默认 limit=5 时插槽容量不足，见 §11。
2. 注入策略：前 `INJECT_HEAD_GUARANTEE(5)` 段整段保底（可软超预算）+ 第 6 段起整段在 `INJECT_TOTAL_BUDGET(2000)` 预算内依次纳入、超预算丢整段、绝不段内裁剪（citation.ts）。
3. 诊断不透明透传：`recallDiagnostics.ts` / `storage/logs.ts` 原样落库回传，零改动（A009 / A016 先例）。

- **组内闭环成立机制**：sango 将事件组连续置于出参 rank 6–10（事件内序）→ 编排侧按既有顺序与预算注入：预算截尾 = 整段丢弃，保留事件序前缀，即「大组按事件内序组内子集」。预算 2000 与插槽 5 双约束下，组内子集序恒为事件内序前缀。
- **触发 hu 分支的条件（本版不满足、明确不做）**：要求组内跨预算豁免（组内不因预算断尾）、组内与自然候选交错重排、或编排侧需感知事件组身份做选择。任一需求出现 → 先改本文档再评估 hu 分支。

## 7. 红线（零新增 LLM）

- 运行时检索 / 注入链路**零新增 LLM 调用**：事件名桥 = 子串匹配 + 插槽装配，纯规则；不改写键、不新增调用位点；原有生成 1 次 / 复核 ≤ 1 次预算不变（需求验收 6）。
- 构建期初审材料 LLM 调用（生成 ≤ 6 + 复核 ≤ 1，按回分批，仅本次全集构建）已按原则 14 报备登记，与运行期无关。

## 8. A015 回归

- 命令（A015 §7）：`cd D:\workplace\mcp-server\sango` → `npm run dev`（build + SANGO_DEV_HTTP_PORT=8787）→ `POST http://127.0.0.1:8787/dev/benchmark/run`（runner 以 `search(question, 50)` 执行，快照落 `{SANGO_BENCHMARK_RESULTS_DIR}`）。
- **通过口径**：整体 `summary.top5 ≥ 0.608`（基线 60.8%）；**事件类逐类不倒退**——`summary.category` 中「战役 / 典故 / 事件关系 / 死亡」四类各自 top5 命中数 ≥ 同基线快照（`feat-A015-*.json`）对应类别值；tail / miss 记录留档对比。
- **结构性保证 + 实测双口径**：top5 由 §3.3 构造免疫（naturalTop[0..4] 原序原分），但回归仍须执行并落快照（顺带门，防实现偏移，需求验收 5）。
- 事件类定点自查（实现轮）：`温酒斩华雄` / `三英战吕布` / `草船借箭` / `空城计` 等 traceId 请求：`eventHit.groups` 非空、`placedChunkIds` 与期望回区间吻合、编排侧注入视图（`[片段N]`）可核对事件组 chunk 在列。

## 9. 边界（不做）

- 知识图谱本体 / 事件因果时序（需求非目标，BACKLOG BL-031 / feat-A021）。
- 问法骨架模板改写 / 召回组织（§3.4；覆盖率 KPI 驱动另立课题）。
- 事件路加权打分 / 权重调参（不弱加权；校准另议）。
- 改 chunk / 向量 / 语料（零重建，需求非目标）；向量 bin 不重跑（事件路不依赖向量）。
- 标注 chunk 对错（chunkIds 只列段、不判对错）；query 新增改写键（aliases 只匹配）。
- 改注入策略 / orchestrator（§6）。

## 10. 验收映射

| 需求验收 | 落点 |
|---|---|
| 4 事件名桥 + 组内闭环注入（接口文档先行实现；整组进注入；大组事件内序子集） | §1、§2、§3、§6 |
| 5 A015 同基线回归不倒车（top5 ≥ 60.8%，事件类逐类不倒退） | §8 |
| 6 运行时链路零新增 LLM | §7 |
| 1 表结构与 verify 校验（chunkIds 存在 / eventName 非空 / aliases 不冲突 / 无重复 / 跨回复核） | §1.2、§1.5（校验口径供 verify-events.mjs 与加载共用） |
| 长期机制（事件表 norm 版本化 + 语料重建漂移检测） | §1.4、§2.3 |
| 接口影响（出参结构不变；eventHit 复用 A009/A016 通道；orchestrator 默认无变化） | §5、§6 |

## 11. 已知约束与风险

- `candidates[].rank` 语义修订（§4）：事件命中请求下与最终出参序可能错位；最终序可由 candidates + eventHit.placedChunkIds 重建，前端展示按候选池序不变。
- 误匹配风险（白话误中 alias）：最长优先 + 单字禁用 + alias 跨行唯一 + A015 事件类回归门兜底；误匹配只影响 rank 6+（top5 结构免疫），代价 = 6–10 自然候选被占位。
- 预算断尾可能截掉组尾：按事件内序保留前缀，「组内子集」即此语义（§3.3 / §6）。
- 语料重建后 chunkIds 失效：加载期漂移检测降级（§2.3，5% 阈值）；verify 每次落表全量校验。
- 工具默认 limit=5 时插槽容量 = 5 − 头保底实占段数：N ≥ 5 时为 0（事件路仅诊断匹配、不改变出参），N < 5 时事件组可补足剩余段（第二路召回兜底）。整组闭环依赖编排侧快路径 limit=10（已存在）；如需默认 limit=5 也保证闭环，须改工具默认值，另议。
- 漂移阈值 5% 与剔除策略为首版口径：若语料重建频发或误报，按 bug 流程调整（先 Coco 复核）。
