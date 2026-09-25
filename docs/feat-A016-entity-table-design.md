# FEAT-A016 术语口径统一 —— 单表设计与合并规则（entity-table.json）

> 用途：老陈按此做表合并（alias.json 并入新表）+ 表加载实现；小胡按此理解缓存侧消费的字段与口径。
> 契约定稿人：Coco；契约变更先问 Coco，不得自行改表格结构 / 字段。
> 依据：需求 `requirements/feat-A016-term-normalization.md`（口径唯一来源）；表起草 `test/term-diff/report/feat-A016-entity-table-draft.json`（唯一起草输入）；素材底稿 `docs/sango-entity-normalization.md`（唯一事实源）；执行行为契约 `docs/feat-A016-term-normalization-interface.md`。
> 故事号：story-A016-01。日期：2026-09-26。

## 1. 表总览

- 单表一份，落位 `sango/data/entity-table.json`；alias.json 并入后退役，`scripts/build_alias.py` 停用；检索侧与缓存侧（经工具）共用同一文件（需求验收 2）。
- 起草规模：person 193 行（aliases 473 条，其中素材增量 newAliases 264 条；120 行源自 alias.json、73 行为新增）、nonPerson 214 行（aliases 429 条；战役 41 / 时间 33 / 地名 32 / 典故 31 / 身体 24 / 器物 19 / 势力 15 / 官职 12 / 数字称谓 4 / 登场 2 / 死亡 1）；referentVerdicts 89 条；ambiguityGuard 29 条。
- **草稿 rewriteKeys 为候选改写键**：合并轮按 §3 规则过滤（终审 / 类别级判定 / 冲突）后才是最终改写键；referentVerdicts 判定优先于草稿值（草稿 note：疑似跨主条目词以 referentVerdicts 判定为准）。
- 草稿 person 行的 `newAliases` / `inAliasJson` 为迁移信息，不进入最终表（aliases 合并后即终态）。

## 2. schema

### 2.1 文件结构（顶层三段）

| 段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `meta` | object | 是 | `{ schemaVersion: 1, normVersion, generatedAt }`；normVersion = rows 段规范化序列化的 8 位内容 hash |
| `rows` | array | 是 | 执行数据（列定义见 §2.2） |
| `policy` | object | 是 | 审计与校验数据 `{ bannedRewriteKeys: string[], ambiguityGuard: object[] }`，不参与替换执行 |

`policy.bannedRewriteKeys` = 终审禁入改写键词表（referentVerdicts 禁入类 verdict 的全部 term + bug-00031 冲突词，见 §3.2 R2/R5），供加载校验与未来新增防回归。

### 2.2 rows 列定义

| 列 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `type` | string | 是 | 枚举见下；取表起草实际取值 |
| `id` | string | 人物行必填 | 人名沿用 PID（P001..P148 保持不动）；重复 / 空 id 修复规则见 §2.3；非人物行填 null |
| `canonical` | string | 是 | 规范形（表指定，取消 df 选名）；type 内唯一、**不得出现在任何行的 rewriteKeys / fragmentOnly 中** |
| `aliases` | string[] | 是 | 素材别名全量（含被禁入项，供审计 / 追溯）；继承起草行覆盖范围后合并 newAliases 去重 |
| `rewriteKeys` | string[] | 是（可为空）| 可作 query 改写键的安全别名；⊆ aliases，与 fragmentOnly 互斥 |
| `fragmentOnly` | string[] | 是（可为空）| 禁入改写键、仅片段侧同义素材；⊆ aliases |
| `organGuard` | object \| null | 否 | 身体行歧义防护审计（引用 policy.ambiguityGuard 条目，如 嘴 行引用 口）；非身体行 null |
| `note` | string | 否 | 裁决备注（如「终审：跨主条目（多主条目候选）禁入改写键」；R2 / R5 / R6 命中处必记） |

type 枚举（12 值，= 表起草实际取值）：`人物` / `地名` / `战役` / `时间` / `典故` / `身体` / `器物` / `势力` / `官职` / `数字称谓` / `登场` / `死亡`。

> 章回类（素材底稿 120 行「第N回 ↔ 第n回」）未纳入表起草，本期不入表；按素材底稿「④ 无别名不占位」口径，待统计脚本实测命中后另行补入，不阻塞本期。

### 2.3 主键与 id 规则

- 主键：人物行 = `id`（PID）；非人物行 = `(type, canonical)`。
- id 全局唯一、不重用：alias.json 现号（P001..P148）原样保留；起草重复 id（P019 孙亮 / 吕蒙、P026 徐晃 / 管辂、P030 曹仁 / 孙和、P099 曹奂 / 刘协）→ `inAliasJson=true` 行保留现号，其余行按 rows 顺序从最大号 +1 续号；起草空 id（73 个新增人物行）同样续号。
- 后续维护新增人物沿用「max+1」续号；已分配即不回收。

### 2.4 示例行

人物（关羽，终审移出 3 个跨主条目词）：

```json
{ "type": "人物", "id": "P002", "canonical": "关羽",
  "aliases": ["关公","云长","关云长","美髯公","汉寿亭侯","关某","关将军","关二爷","赤面长须"],
  "rewriteKeys": ["云长","关云长","美髯公","关某","关二爷","赤面长须"],
  "fragmentOnly": ["关公","汉寿亭侯","关将军"],
  "note": "R2：关公/汉寿亭侯/关将军 终审跨主条目（多主条目候选）禁入改写键" }
```

非人物（必现案例行，验收 5 锚点）：

```json
{ "type": "战役", "canonical": "过五关斩六将",
  "aliases": ["五关斩六将","千里走单骑"],
  "rewriteKeys": ["五关斩六将","千里走单骑"], "fragmentOnly": [] }
```

禁入案例（官职行，类别级不设改写键）：

```json
{ "type": "官职", "canonical": "皇帝",
  "aliases": ["天子","陛下","至尊"],
  "rewriteKeys": [], "fragmentOnly": ["天子","陛下","至尊"],
  "note": "R7+R2：皇帝 终审跨主条目，泛官职裸词禁入改写键" }
```

## 3. 键约束与合并规则

### 3.1 键约束四条（表内表达方式）

禁入的落地 = 进 `fragmentOnly`（保留素材）或出表（彻底移除）；可改写 = `rewriteKeys`；`rewriteKeys ∪ fragmentOnly ⊆ aliases`。

| # | 约束 | 表内表达 |
|---|---|---|
| C1 | 单字词（目 / 口 / 头 / 死 / 亡 等）不作改写键、不作片段侧单字替换 | 单字不出现在 rows（起草已全出）；加载校验兜底（len==1 → 剔键告警） |
| C2 | 跨主条目词（魏王 / 文帝 / 陈留王 等）禁入改写键 | 终审判定词进 fragmentOnly + policy.bannedRewriteKeys；多挂为共享实体标签（§4） |
| C3 | 数字称谓年号键约束：裸年号不作键、带年份短语作键 | 时间行 rewriteKeys 仅收年份短语（建兴元年 → 蜀汉建兴）；同串跨行键（甘露元年 / 甘露二年 → 魏甘露 / 吴甘露）剔除、不进 fragmentOnly |
| C4 | 身体器官 organGuard 口径 | 身体行 rewriteKeys = 白名单安全短语（左目 / 双目 / 口中 等）；organGuard 字段审计引用；单字与部分词（唇 / 舌 / 齿 / 牙）不出键 |

### 3.2 合并规则（表合并轮按序应用，全部命中即全部应用）

| 规则 | 内容 | 依据 |
|---|---|---|
| R1 | 候选改写键：nonPerson 行 = 起草 `rewriteKeys`；person 行 = 起草 `aliases`（人物行无 rewriteKeys 列） | 起草结构 |
| R2 | term ∈ referentVerdicts 且 verdict ∈ {禁入改写键（泛官职裸词）, 跨主条目, 跨主条目（多主条目候选）, 跨主条目（同串跨人组）} → 从 rewriteKeys 移入 fragmentOnly，并写入 policy.bannedRewriteKeys | 终审（验收 7）|
| R3 | verdict = 唯一指称候选 或 语料未出现 → 保留 rewriteKeys | 终审 |
| R4 | verdict = 语料未出现 且 term ∈ {疑似, 待统计复核）}（解析残渣，非真实别名）→ 从 aliases / rewriteKeys / fragmentOnly 全删除 | 数据修整 |
| R5 | bug-00031 冲突词（子明 / 公明 / 子孝 / 子远）→ 从所在人物行 aliases 全删除（rewriteKeys / fragmentOnly 均不留），并写入 policy.bannedRewriteKeys；同字组合词（吕子明 / 徐公明 / 曹子孝 / 许子远 等）唯一指称，保留 | 需求红线（冲突组不进表）|
| R6 | 同串跨行键（同 term 指向多 canonical，如 甘露元年 / 甘露二年）→ 从相关行 rewriteKeys 剔除，不进 fragmentOnly（双目标无法扩展），aliases 保留 | 目标歧义（机械查重①）|
| R7 | 官职 / 势力类行：rewriteKeys 置空，aliases 全落 fragmentOnly（类别级不设改写键；组合词由人物节覆盖） | 素材底稿「不设改写键，仅作片段侧词汇素材」|
| R8 | 死亡类行：rewriteKeys 置空，多字死亡短语全落 fragmentOnly | 已定决策「多字死亡短语仅作片段侧素材」|
| R9 | 典故行两字茎（美人 / 疑兵 / 诈降 / 反间 / 拖刀 / 连环 / 空城）→ 移入 fragmentOnly（或去别名）；苦肉 / 假途 / 反客 / 韬晦 保留 rewriteKeys | 茎词独立语义占比核查 |
| R10 | 数字称谓：六出 / 九伐 → fragmentOnly（过泛不作键）；五虎将 / 五虎大将 / 五虎上将军 / 十八镇诸侯 保留 | 全类别审查（缩略词实测）|
| R11 | 身体行 rewriteKeys = 起草值（已 = ambiguityGuard.good 白名单安全短语）；单字与部分词已全出表 | 身体器官核查 |
| R12 | 时间行 rewriteKeys 仅含年份短语（起草已满足：裸年号不出现在 aliases）；多国年号 canonical 带国别前缀（魏甘露 / 吴甘露 / 蜀汉建兴 / 吴建兴）| 年号键约束（建兴 = 蜀汉 / 吴）|
| R13 | 最终全集校验：rewriteKeys 无单字、全表唯一（无跨行重复键）、与 policy.bannedRewriteKeys 不相交、⊆ aliases 且与 fragmentOnly 互斥 | 本表 §8 加载校验 |
| R14 | person 行 id 修复与续号（§2.3）；R2 / R5 / R6 命中处写 note（记终审摘要与依据） | 本表 |

合并示例（终审改键）：
- 关羽行：`关公` / `关将军` / `汉寿亭侯` 终审多主条目候选 → fragmentOnly（R2）；`美髯公` 唯一指称候选、`云长` / `关云长` / `关某` / `关二爷` / `赤面长须` 无终审记录 → 保留（R1 / R3）。
- 司马昭行：`文帝` 同串跨人组（曹丕 / 司马昭）→ fragmentOnly + banned（R2 / R6）；`文王` / `晋王` 唯一指称候选 → 保留（R3）。
- 吕布行：`吕温侯` 多主条目候选 → fragmentOnly（R2）；`温侯` 唯一指称候选（13 / 13）→ 保留（R3）。
- 刘备行：`先主` 唯一指称候选 → 保留；`刘皇叔` / `刘使君` / `昭烈皇帝` 多主条目候选 → fragmentOnly（R2）。

## 4. referentVerdicts（89 条）落表

- 落表方式：不复制进 rows；以 `policy.bannedRewriteKeys` 落地禁入词（终审判定词表，验收 7 落档）+ 合并轮消费（R2 / R3 / R4）。明细（dist / share 等）以统计报告 JSON 为据，不复制进执行表（保持轻量）。

判定 → 处置映射（以 verdict 值为准，不分档细究 share）：

| verdict | 条数 | 处置 |
|---|---:|---|
| 唯一指称候选 | 28 | rewriteKeys 保留（R3）|
| 禁入改写键（泛官职裸词） | 8 | → fragmentOnly + banned（R2）|
| 跨主条目 | 11 | 同上 |
| 跨主条目（多主条目候选） | 27 | 同上 |
| 跨主条目（同串跨人组） | 2（文帝 / 陈留王）| 同上 + 共享标签多挂两侧（§2.4 接口）|
| 语料未出现 | 13（11 词 + 2 解析残渣）| rewriteKeys 保留（R3）；残渣删词（R4）|

> 裁定说明：share=1 但 verdict 为多主条目候选的词（如 关公 topPid=P002 share=1）仍按终审判定禁入改写键——终审为「初审分级 + 同串跨人组 + 指称份额」联合裁决，合并轮不自行重算、不以 share 单判覆盖 verdict。

- 字段语义（供消费方理解报告与 policy 依据）：`term` 候选词 / `source` 来源 / `prior` 初审分级 / `note` 备注 / `occurrences` 语料次数 / `windowCount` 归属窗口数 / `dist` 邻近主条目分布（[PID, 次数] 列表）/ `topPid` 首位主条目 / `share` 首位占比 / `verdict` 终审判定。
- 共享实体标签多挂依据：dist / topPid（如 文帝 dist 前二 P083 / P055 → 曹丕与司马昭双挂；陈留王 P099 / P011 → 刘协与曹奂双挂）；多挂标签词不在 rewriteKeys，原文直配保持（接口 §2.4）。

## 5. ambiguityGuard（29 条）落表

- 落表方式：`policy.ambiguityGuard` 原样保留（term / semantic / total / bad / good / hasAmbiguity）。
- 语义：单字 / 部分词禁入词表——query 改写键与片段侧单字替换全禁；`bad` = 歧义复合词语境清单（误伤证据），`good` = 语料实测安全短语（身体行 rewriteKeys 与片段侧素材的来源）。
- hasAmbiguity=true（22 条）与 false（7 条：肤 / 颜 / 牙 / 薨 / 殂 / 殒 / 殁）一律禁入单字替换——false 为单字低歧义，仍不做单字替换（防切齿 / 唇亡齿寒类固定表达误伤）。
- 消费：① rows 不得出现 guard.term（生成时已满足）；② 加载校验 `rewriteKeys ∩ (guard.term ∪ guard.bad)` 为空 → 违规剔键告警；③ 身体行 `organGuard` 字段引用对应条目（示例：嘴 行 organGuard 引用 口 条目，rewriteKeys=[口中, 口吐, 开口, 口内, 口称] 来自 good 清单）。

## 6. 两路分流（改写键 vs 片段侧同义素材）

- 语义：改写键 = 可安全替换（query 侧无语境可消歧：白名单 + 非单字 + 唯一指称 / 低风险候选）；片段侧素材 = 禁入改写键、但片段侧有语境价值（跨主条目 / 泛官职裸词 / 死亡短语 / 过泛缩略）。
- 决策理由：歧义判定依赖片段语境，query 侧无语境 → 歧义词禁入改写；片段侧用上下文可消歧且扩展不覆盖原文（双写）→ 保 recall 不引入误伤。
- 表内表达：`rewriteKeys` / `fragmentOnly` 两列（互斥，并集 ⊆ aliases），自上而下可追溯。

各侧消费矩阵（实现口径见接口文档 §2–§3）：

| 消费方 | rewriteKeys | fragmentOnly |
|---|---|---|
| query 改写（检索与缓存工具 embed 前） | 替换 | 不参与（原文保留）|
| 索引侧（postings 构建）| 替换（双侧同表）| 双写扩展（原文 token + 规范形 token）|
| 标签侧（tagPostings 构建）| 替换归一化 | 共享实体标签多挂（第三路召回）|
| 缓存 embed（编排侧经工具）| 替换后编码 | 不参与 |

## 7. 加载后内存结构（对照现行 alias.json 用法）

| 现行（alias.json） | 新（entity-table.json） |
|---|---|
| `pidOf`：别名 → PID | `keyToCanon`：改写键 → 规范形（替换映射，含人物与非人物；现行正则构造输入）|
| `canonOf`：PID → 规范名（df 选名）| 取消；`canonToRow`：规范形 → `{ type, id, aliases, fragmentOnly, organGuard, note }`（人物行 id 承载 PID）|
| `aliasPattern`（长度降序 alternation，全局替换）| 沿用（构造自 keyToCanon 键集）|
| — | `fragmentKeys`：fragmentOnly 全表并集（索引构建期双写扩展）|
| — | `bannedRewriteKeys`：Set（policy，加载校验）|
| — | `guards`：ambiguityGuard 明细（审计 / organGuard 引用）|
| — | `normVersion` / `rewriteKeyCount`：诊断、工具响应、缓存换代共用（接口 §3.3 / §5）|

- 死亡类 / 遗言逻辑（deathByPerson / deathSpeechByPerson）消费边界不变：标签「人物之死-XX之死」normalize 后按 XX（= 规范形）建人名词典；人物行 id 供标签建设侧回查 PID。
- 规范形替换目标一致性约束：canonical 不得是任何行的 rewriteKeys / fragmentOnly（防循环 / 二次替换；构造正则前校验，违例 = 数据错误告警剔除）。

## 8. 校验清单与维护流程

加载校验（接口 §1.6 违规降级口径：告警 + 剔键，不拒全表）：
1. `meta.schemaVersion == 1`；2. canonical 在 type 内唯一；3. rewriteKeys ⊆ aliases 且与 fragmentOnly 互斥；4. rewriteKeys 无单字（len==1）；5. rewriteKeys ∩ bannedRewriteKeys 为空；6. rewriteKeys 全表唯一（无跨行重复键）；7. 人物行 id 非空且全局唯一；8. canonical 不出现在任何行的 rewriteKeys / fragmentOnly。

维护流程（表内容变更全程）：
改素材底稿（如需）→ 重跑 `test/term-diff/term-diff.mjs`（零 LLM）→ 表合并（R1–R14）→ normVersion 换代 → 提交入库 → 部署重启 sango（索引重建，接口 §2.5）→ 编排侧 CACHE_VERSION 换代（接口 §4.5）→ 回测（验收 5 / 6）。

验证方式（实现轮自查）：
- 启动日志：`[sango] entity-table loaded: rows={n} keys={k} normVersion={v}`；
- 合并断言样例：`五关斩六将` ∈ 过五关斩六将行 rewriteKeys；`甘露元年` ∉ 任何 rewriteKeys；`子明` / `公明` / `子孝` / `子远` ∉ 任何 aliases；`天子` ∉ 任何 rewriteKeys；人物行 id 无重复且 73 个新增行已续号；
- 行为断言（接口 §6 验证方式）：`normalize('五关斩六将') === '过五关斩六将'`、`normalize('云长') === '关羽'`、`normalize('右目') === '右眼'`、`normalize('天子') === '天子'`。

## 9. 风险与已知约束

- 草稿 rewriteKeys 为候选值：本文 §3 合并规则是最终口径；与草稿不一致处以本文档为准（表设计 = 契约）。
- 「语料未出现」词保留为改写键：无歧义证据亦无词面证据；语料扩展后须重跑核查（与接口 §8 同口径）。
- fragmentOnly 双写使规范形 token 的 df 略升（接口 §2.3 已知约束）。
- organGuard 为审计字段不参与执行；未来新增身体行素材须遵守 guards.good 白名单，否则加载校验剔键。
- 同串跨行键（R6）只剔除不改写，aliases 保留——若未来需要片段侧扩展，需先裁决目标归属，另行登记。

## 10. 边界（不做）

- 不做实体库建设 / LLM 参与 / 注入与权重调整（见接口 §7）；bug-00031 冲突组不进表（R5）；referentVerdicts 明细（dist / share 语料归属）不复制进执行表，以统计报告为据；章回类本期不入表（§2.2 说明）。
