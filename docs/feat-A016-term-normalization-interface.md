# FEAT-A016 术语口径统一 —— 执行接口契约（表 / 检索侧 / 工具侧 / 缓存侧）

> 用途：老陈按此实现器坊侧表加载与检索改造；小胡按此实现总台缓存侧归一化衔接。
> 契约定稿人：Coco；契约变更先问 Coco，不得自行改接口 / 字段。
> 需求依据：`requirements/feat-A016-term-normalization.md`（已定稿，口径唯一来源）；表结构见 `docs/feat-A016-entity-table-design.md`（本契约的 schema 支撑）。
> 前置契约：feat-A013 §1.7.1（`sango_query_embed` 工具契约，本文 §3 为其修订件）；feat-A004（BGE-M3 同空间编码）；feat-A009（diagnostics 形状）。
> 故事号：story-A016-01。日期：2026-09-26。

## 0. 范围

- 本文定三件事：① 单表文件（别名 / 换说法表）的格式、加载与降级；② 检索侧 query 改写 + 双侧归一化；③ `sango_query_embed` 工具契约修订与缓存侧衔接。
- 表文件的具体 schema 与合并规则（草稿 JSON 到最终表）见表设计文档，本文不重复。

## 1. 单表文件契约

### 1.1 落位与命名

- 文件：`sango/data/entity-table.json`（与退役的 `alias.json` 同目录）。alias.json 并入本表后不再被读取；`scripts/build_alias.py` 停用。
- 「检索侧与缓存侧读取同一份表」（验收 2）：检索侧直接加载文件；缓存侧经 §3 工具承接。同一文件、同一模块、同一归一化口径，无第二份实现。

### 1.2 文件格式

顶层三段：

| 段 | 类型 | 说明 |
|---|---|---|
| `meta` | object | `{ schemaVersion: 1, normVersion, generatedAt }` |
| `rows` | array | 执行数据：type / id / canonical / aliases / rewriteKeys / fragmentOnly / organGuard / note |
| `policy` | object | 审计与校验数据 `{ bannedRewriteKeys: string[], ambiguityGuard: [...] }`，不参与替换执行 |

- `normVersion` = rows 段规范化序列化的 8 位内容 hash（不含 meta 与 generatedAt）；表内容变更即换代。检索诊断、工具响应、缓存 version_tag 复用同一值。
- rows 列定义与 type 枚举见表设计 §2；示例行也见表设计 §2.4。

### 1.3 规范形口径（取消 df 选名）

- 规范形由表直接指定（canonical 列）。删除 loadAliases 的「原始语料 chunk 级 df 最大者选名」逻辑与对应「两遍构建」，索引构建改为一遍（对归一化文本直接建 postings / df）。
- 理由：df 选名选不出语料外说法的规范形，无法覆盖换说法表；表指定使检索、评测与缓存口径由同一份数据决定（验收 6 的切换前提）。

### 1.4 构建方式

- 表 = 合并产物：由 `test/term-diff/report/feat-A016-entity-table-draft.json`（表起草）+ 表设计 §3 合并规则派生，产物入库（git 跟踪）。
- 实现轮可写一次性合并脚本或手工合并；产物必须通过表设计 §8 校验清单。运行时零计算：sango 只读文件，不跑任何统计 / 归并逻辑。

### 1.5 加载时机

- `load()` 启动阶段加载（现行 loadAliases 的位置）；postings / df / 标签倒排随后按新表构建。
- 表内容变更生效方式 = 重启进程（重新 load()）。无持久化索引产物，向量 bin 的处理见 §2.5。

### 1.6 加载失败与违规降级（裁定）

- 文件缺失 / JSON 损坏 / 结构非法 / 有效行数 0 → stderr 告警 `[sango] entity-table 加载失败：{原因}，降级为不做归一化`，normalize 退化为恒等，检索与工具继续工作——与现行 alias.json 失败口径逐条一致。
- 表内违规键（命中 policy.bannedRewriteKeys / 单字 / 跨行重复键 / 跨行 canonical 真子串键（K4，bug-00036））→ 告警并剔除该键（不拒绝全表、不崩溃），其余键照常生效。理由：白名单表宁降级不可崩，违规即数据缺欠，告警留痕供排查。
- 检索侧与工具侧共用同一加载实例（同进程同模块），降级行为同时生效，不产生口径分裂。

## 2. 检索侧契约

### 2.1 归一化实现（单一模块）

- 新增 `sango/src/normalize/entity-table.ts`：加载表 → 建「改写键 → 规范形」替换映射 + 校验 + normVersion；导出 `loadEntityTable(dataDir)`、`normalize(text)`、`rewriteKeyCount`、`normVersion`。
- SangoIndex 与 `sango_query_embed` 共用同一实例（进程内单例）——编排侧不另写归一化实现（防 D4 口径分裂）。
- 替换算法沿用现有结构：改写键按长度降序构造 alternation 正则，全局替换（最长匹配口径不变）；替换前做**邻接延伸检查**（bug-00036）：键命中处若与邻接字符能延伸为表内已知词（任意行 canonical / aliases / rewriteKeys 中最长命中）则不替换该键——防 canonical 原文被真子串键二次扩张（长坂坡 不再变成 长坂坡坡），独立语境改写不受影响（博望之战 → 博望坡之战）。
- 现行 loadAliases 私有结构（pidOf / canonOf / aliasPattern）废弃；人物 PID 信息改由表行 id 承载，死亡类 / 人物标签逻辑复用入口不变（表设计 §7）。

### 2.2 query 改写必须在 embed 之前（硬约束）

- `search(query)` 固定顺序：`normalized = normalize(query)` → `tokenize(normalized)` 供 BM25 → `embedQuery(normalized)` 供向量路。embedding 输入必须是改写后文本（现状路径已如此，本契约固化顺序为硬约束）。
- 换说法（`五关斩六将` → `过五关斩六将`、`千里走单骑` → `过五关斩六将`）、人物字号（`云长` → `关羽`）、身体方位（`右目` → `右眼`）等全部经 rewriteKeys 替换。
- `docs[].text` 恒保留原文；归一化只作用于索引 token、query 侧与标签侧（现状不变）。

### 2.3 片段侧同义素材（fragmentOnly，索引侧双写）

- fragmentOnly 不进替换集、不参与 query 改写；用途 = 索引侧双写扩展：建 postings 时，片段文本命中 fragmentOnly 短语处追加写入其规范形的 token（原文 token 保留，不改 docs[].text、不覆盖）。
- 双写只增倒排条目，不改文档长度（BM25 的 dl 仍取原文 token 数，不重算）。
- 目的：query 用规范形 / 通用说法可词法命中含口语写法的片段（如 query「死亡」命中含「自刎」的片段），同时杜绝歧义词改写 query 的误伤（如「天子」不改写为「皇帝」）。
- 已知约束：被双写的规范形 token 的 df 略升，属可接受偏差，不追平。

### 2.4 标签侧与共享实体标签多挂

- 标签三路召回机制不变：标签文本先 normalize（替换 rewriteKeys）再入 tagPostings；原始标签文本由 tagTextsByDoc 保留供 hitLabels。
- 跨主条目词（fragmentOnly，如文帝 / 陈留王 / 魏王）不进改写键，但按 referentVerdicts 的 dist / topPid 做「共享实体标签多挂」：同一标签词挂在多个候选主条目上，经标签倒排第三路召回（复用 tagPostings，不新增召回路），与原文直配双轨并行（需求表设计约束）。
- 标签内容如何多挂在标签建设轮细化；本契约承诺机制入口与数据依据（referentVerdicts），不承诺标签内容清单。

### 2.5 索引重跑要求

- 表变更 → 重启 sango 进程即重建 postings / df / 标签倒排（内存态，无落盘索引）。
- 向量 bin（`data/vectors/sanguo-yanyi.bin`）以原文嵌入（现状），本期不重跑。理由：向量侧归一化需离线全量重嵌 2344 chunk，且非任何验收项前置；query 侧在改写后文本上编码已满足验收 3。若后续把归一化引入向量侧，另立课题。
- recall-bench / 评测 runner 与检索共用同一 normalize 实现（维持「检索实现与评测口径一致」既有契约；表指定规范形后依 §1.3 同步）。

### 2.6 键约束落地（检索侧执行五条）

| # | 约束 | 落地 |
|---|---|---|
| K1 | 单字词（目 / 口 / 头 / 死 / 亡 等）不作改写键 | 表内无单字键；加载校验 len==1 → 剔键告警 |
| K2 | 跨主条目词（魏王 / 文帝 / 陈留王 等）禁入改写键 | 以 referentVerdicts 终审判定为准，表合并已滤 + 加载校验比对 policy.bannedRewriteKeys |
| K3 | 数字称谓年号键约束 | 裸年号不作键；年份短语可作键（建兴元年 → 蜀汉建兴）；同串跨行键弃用（甘露元年 → 魏甘露 / 吴甘露 双目标） |
| K4 | 身体器官 organGuard 口径 | 身体行改写键 = 白名单安全短语（左目 / 双目 / 口中 等）；单字与部分词（唇 / 舌 / 齿 / 牙）不出键 |
| K5 | 死亡类口径 | 单字（死 / 亡 / 卒 / 薨 / 崩 / 殂 / 殒 / 殁）禁入；多字死亡短语仅作片段侧素材（fragmentOnly，不作改写键） |

## 3. `sango_query_embed` 工具契约修订（feat-A013 §1.7.1）

### 3.1 入参（不变）

- `query` = 用户输入原文（trim 后），1 ≤ len ≤ 300，超限 isError 固定文案不变。
- **编排侧传原文，不自行改写**。归一化由工具承接；编排侧删除自实现（小胡：删 cache.ts `normalizePersonNames` 19 对硬编码），不复制、不镜像。

### 3.2 处理（变更）

- 工具内部：`query` → `normalize(query)`（entity-table 实例，rewriteKeys 替换）→ `embedQuery(normalized)` → 返回向量。
- 归一化落在 mcp-server 的 `sango/src/normalize/entity-table.ts`（与检索共用同一实例）；工具注册处注入该实例（沿用现有 embedFn 注入模式，测试可注入假实现）。

### 3.3 出参（扩展）

- `{ dim, encoding, data, normVersion }`：新增 `normVersion`（= 表 meta.normVersion，字符串）。
- 用途：缓存侧识别键空间（§4.5）；JSON 解析兼容，老消费方仅读前三字段不受影响。

### 3.4 降级（不变 + 补一条）

- 表加载失败：工具退化为原文嵌入（与检索侧同降级）；编码失败维持固定文案 isError；长度 / 空串校验不变。

### 3.5 不变量

- A013「三不」原则不变：不落 tool_call_logs、不注入 `_meta.traceId`、不进模型可见白名单；不产 diagnostics。

## 4. 缓存侧契约（总台小胡照做）

### 4.1 判定前归一化承接

- 删除 cache.ts `normalizePersonNames`（19 对硬编码）；embedding 一律经 §3 工具获取（已含归一化），编排侧不再有任何归一化实现。

### 4.2 命中语义

- 换说法与规范形经同一归一化后同串 → 同向量 → cosine≈1 → 命中同一缓存条目（验收 4：缓存日志可读证一次 LLM 调用）。
- 示例：`云长是怎么死的` 与 `关羽是怎么死的` 同条目；`五关斩六将…` 与 `过五关斩六将…` 同条目。

### 4.3 日志口径（不变）

- `cache_logs.user_query`、缓存条目 `queryText`、`nearest_query` 仍存用户原文（A013 §2.2 不变）；归一化结果不落任何缓存日志字段。

### 4.4 焦点校验口径（变更声明）

- A013「判定前归一化作用于 embedding / cosine / 焦点校验」中的焦点校验改为基于 query 原文。理由：焦点类来自疑问词（怎么 / 谁 / 哪里 / 什么时候），不含人名与换说法，归一化对焦点类判定无增益；若实测发现焦点词含别名影响，另开 bug 处理。

### 4.5 键换代与清缓存

- 缓存键 = 归一化后文本的 embedding；规范形口径（表）变化即键空间变化。
- 换代机制复用 A013 §1.6，不加新接口：`CACHE_VERSION` 换代（范围含 normVersion）；lookup 发现条目 `versionTag != CACHE_VERSION` → 全量清除一次 + console.warn；新写入条目带当前版本。
- version_tag 建议形如 `${CACHE_VERSION}-${normVersion}`（示例口径，由总台实现轮定稿）；表变更部署 = 重启 sango（§2.5）+ 编排侧 CACHE_VERSION 换代；`cache_logs` 不清（审计保留）。

## 5. diagnostics 字段语义变更（表结构不变）

| 字段 | 现状 | 新语义 |
|---|---|---|
| `query.normalized` | alias.json 人名替换后文本（df 选名） | 表 rewriteKeys 替换后文本，人名与换说法同一口径。示例：raw `五关斩六将…` → `过五关斩六将…`；raw `夏侯惇的右目是怎么瞎的` → `…右眼…`；raw `云长…` → `关羽…` |
| `env.aliasCount` | 别名 PID 数（pidOf.size） | 表内 rewriteKeys 总数（含人物与非人物）；表加载失败为 0。最终值以启动加载日志为准 |
| `query.rewrites` | （新增，test-1921） | query 侧实际改写命中明细：`[{ from, to }]`，from = 原文片段、to = 规范形，按替换发生顺序排列；邻接延伸检查保护未替换的键不计入；fragmentOnly 键不在 query 侧替换、不计入；无改写为 `[]` |
| `env.normVersion` | （新增，test-1921） | 表 meta.normVersion（内容 hash）；表加载失败降级为空串，与 aliasCount=0 同口径 |
| `hitLabels` | 命中标签原始文本 | 取值语义不变（原始标签文本）；补充：跨主条目词经共享实体标签多挂命中后，同一标签词可能出现在多个主条目标签命中里，判定仍以原始标签文本为准 |

- 追溯：sango 启动 stderr 打印 `[sango] entity-table loaded: rows={n} keys={rewriteKeyCount} normVersion={v}`；请求级排查结合该日志与 cache_logs.version_tag 对照表版本。
- 页面口径（test-1921）：日志页「召回漏斗」头部在「语料 chunk」前新增「归一化改写」环节，显示 `query.rewrites` 命中数并标注「embed 前」；检索诊断 Query 区展示改写明细（原文片段 → 规范形），无改写显示「无改写」。方案见 docs/feat-A016-normalization-observability.md

## 6. 验收映射

| 验收 | 落点 |
|---|---|
| 2 表文件落地、双侧读取同一份表 | §1.1 / §2.1 / §3 |
| 3 query embed 前改写，换说法与规范形 top10 证据段一致 | §2.2 / §2.3 |
| 4 缓存键归一化，换说法与规范形命中同一缓存条目 | §3 / §4.2 |
| 5 漏召回测（过五关斩六将 与 五关斩六将 top10 同证据段） | §2.3 双侧替换 + 表行「过五关斩六将」 |
| 6 人名规范形口径切换不回退 | §1.3 / §2.5（重启重建）+ recall-bench 同基线复跑，华雄 / 刘备定点不倒车 |
| 7 跨主条目词核查落档、禁入改写键 | §2.6 K2 / 表设计 §3–§4 |

验证方式（实现轮自查；负责人验收按需求验收清单，过程性细节进代码注释）：
- 启动日志出现 entity-table loaded 行（normVersion / keys 数）；
- 样例断言：`normalize('五关斩六将') === '过五关斩六将'`、`normalize('云长') === '关羽'`、`normalize('右目') === '右眼'`、`normalize('天子') === '天子'`（fragmentOnly 不替换）；
- 缓存：同义两问先后各一次，cache_logs 显示第二次命中（一次 LLM 调用）；
- recall-bench 同基线复跑。

## 7. 边界（不做）

- 不改注入策略与检索权重（A020 / A014 范畴）；不引入 LLM 参与改写；不建大规模实体库（白名单式，只映射已确认条目）。
- 不做向量侧归一化（§2.5 理由）；不给缓存侧新增接口（换代复用 A013 §1.6）；bug-00031 冲突词（子明 / 公明 / 子孝 / 子远）不进表。

## 8. 已知约束与风险

- 换说法命中率未知：覆盖率低则扩大表或转语义改写评估（需求风险节，实现期不解决，回测供数）。
- fragmentOnly 双写使规范形 token 的 df 略升（§2.3）。
- 「语料未出现」词保留为改写键：无歧义证据亦无词面证据，语料扩展后需重跑核查。
- 焦点校验改原文口径（§4.4）：若实测发现回归，另开 bug 处理，不阻塞本期。
- 过归一化误匹配：白名单 + 漏召回测样例兜底（验收 5）。

## 维护记录

- 2026-09-26：bug-00036 定案修订——§1.6 违规键清单增「跨行 canonical 真子串键（K4）」；§2.1 替换算法增「邻接延伸检查」（防真子串键二次扩张 canonical）。机制与数据裁决以 `bugs/bug-00036-entity-table-key-substring-collision.md` 与 `docs/sango-entity-normalization.md`「键排斥规则」节为准（Coco 定案，老陈实施）。
- 2026-09-26：test-1921 增补——§5 增加 `query.rewrites` / `env.normVersion` 字段 + 「召回漏斗头部标注归一化改写环节」页面口径（负责人拍板并入 A016，Coco 定案；实现分布与验证见 docs/feat-A016-normalization-observability.md）
