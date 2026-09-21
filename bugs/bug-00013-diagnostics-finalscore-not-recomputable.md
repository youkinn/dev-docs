# bug-00013：检索诊断 finalScore 无法由接口数据复算（接口只回原始 bm25/cosine，缺 BM25 归一化与全量余弦）

> Bug 号：bug-00013
> 状态：修复中（2026-09-21 三侧落地：mcp-server `99fa77e` / mcp-orchestrator `ab8c13b` / mcp-web `f19ff8b`，均在 feat-A009 各分支上，待 Coco 审查）
> 关联特性：feat-A009（检索诊断，§1.3 `candidates[]` 分数表）
> 涉及项目：mcp-server（sango 诊断产出）、mcp-orchestrator（诊断透传 / 落库 / 查询，仅测试断言）、mcp-web（日志页「检索诊断」面板展示）
> 登记：负责人 ／ 报告：负责人 ／ 登记日期：2026-09-21
> 决策（2026-09-21 负责人拍板）：当 bug 修，单独文件跟踪（feat-A009 提测阶段发现，未归档）

## 现象

feat-A009 提测中，负责人尝试用 `GET /api/v1/logs/{traceId}` 返回的 `toolCalls[0].diagnostics.candidates[].finalScore` 反推最终分：

- 按「BGE-M3*0.6 + BM25*0.3 + TAG*0.1」代入接口字段，candidates[0] 得到 `0.622*0.6 + 38.979*0.3 + 0.1 = 12.1669`；
- 但接口给出的 `finalScore = 0.887`，对不上。

结论：**权重没错，错在「接口给的是原始值，不能直接乘权重」**。candidates[0] 的实际计算结果 0.887 是正确的（见根因与修复口径）。

## 复现数据（trace `60aa5476-6ea1-4d2d-a560-c8287101ab4a`，query「关羽过五关斩六将」）

query 归一化「云长过五关斩六将」，funnel：`lexicalHits=2107 / vectorTop50=50 / labelHits=61 / mergedCandidates=2107 / topN=10`。

`candidates[0]`（`sanguo-yanyi:0050:c0011`）：

```json
{ "rank": 1, "bm25": 38.979, "cosine": 0.622, "labelHit": true, "finalScore": 0.887, "sources": ["lexical", "vector", "label"] }
```

`candidates[1]`（`sanguo-yanyi:0027:c0020`）：

```json
{ "rank": 2, "bm25": 25.843, "cosine": null, "labelHit": true, "finalScore": 0.734, "sources": ["lexical", "label"] }
```

## 根因

`mcp-server/sango/src/search/sango-index.ts`：

- 合并重排真正用的公式（`:527-530`）：`score = 0.3*bm25Norm[d] + 0.6*max(0,(cosine[d]+1)/2) + 0.1*(tagHit?1:0)`；
- `bm25` 参与的是**词法命中集合内 min-max 归一化**后的值（`:475-485`），不是原始分；
- `cosine` 参与的是**映射到 [0,1]** 的值 `(cosine+1)/2`，且对**所有候选**都参与计算（`:528`）；
- 但诊断回传时（`:707-708`）：
  - `bm25` 回传 `round3(原始 bm25)`，没回传归一化值 → 外部无法复现 0.3 那一路；
  - `cosine` 仅在向量 top-50（`vectorTopSet.has(d)`）回传，其余置 null → **null 不代表向量项为 0**，该候选 still 有向量加分被「藏」掉了（上面 candidates[1] 正属此类）。

因此「接口数据 → finalScore」存在两处断链：缺 BM25 归一化值 + 缺非 top-50 候选的余弦。

## 修复候选（2026-09-21 拍板走候选 1）

1. **回传「参与计算的值」**（推荐）：`candidates[]`/`nextRank` 每条增加全精度归一化值，并把余弦扩到全量 —— 外部用三条分量即可严格复算。
2. 只加 BM25 归一化值 + 余弦扩全量，但保留 3 位小数 → 四舍五入边界偶发差 0.001，不满足「严格相等」。
3. 不加字段，靠接口文档文字解释 → 不解决「接口数据算不出」，不收。

## 契约变更（候选 1 定稿）

`candidates[]` / `nextRank` 字段调整：

| 字段 | 现状 | 改为 |
|------|------|------|
| `bm25` | 原始 BM25，`round3`，词法未命中 null | **不变**（仅调试用原始分） |
| `cosine` | 原始余弦，`round3`，**仅向量 top-50 回传** | **向量路可用时每个候选都回传，改全精度不 round3**；降级纯 BM25 才 null |
| `bm25Norm`（新增） | — | **新增** `number|null`，全精度：实际参与 0.3 权重的 BM25 归一化值；非词法命中 null（计 0） |
| `labelHit` | boolean | 不变（参与值 = `labelHit?1:0`） |
| `finalScore` | `round3` | 不变 |

**复算公式（写入接口文档 §1.3）：**

```text
finalScore = round3(
  0.3 × (bm25Norm ?? 0)
+ 0.6 × (cosine 为空 ? 0 : (cosine + 1) / 2)
+ 0.1 × (labelHit ? 1 : 0)
)
```

- `bm25Norm`、`cosine` 全精度输出，仅最后一步 `finalScore` 做 `round3` → 逐条复算**严格相等**。
- 载荷增长 ≤ 21 条 × 1~2 个数，仍远低于 64 KB 截断预算（硬约束 3 不破）。

验证样例（trace `60aa5476`）：

- `candidates[0]`：`bm25Norm=1`（38.979 为词法命中最大值）、`cosine≈0.622` 全精度 → 向量映射 `(0.622+1)/2≈0.811`、`labelHit=true` → `0.3×1 + 0.6×0.811 + 0.1 = 0.8866` → `round3 = 0.887` ✔
- `candidates[1]`：改后 `cosine` 不再为 null（该候选本就有向量贡献），三路齐全可逐条复算出 `0.734`。

## 修复口径（改动清单）

- **mcp-server（老陈）**：
  - `sango/src/types.ts`：`RetrievalCandidateDiagnostics` 增 `bm25Norm: number|null`；`cosine` 语义注释更新。
  - `sango/src/search/sango-index.ts`：`DiagnosticsBuildContext` 增 `bm25Norm`（`:85` 区间）；`search()` 构建诊断上下文时补传本地 `bm25Norm`（`:586-600` 区间，无需新计算）；`emptySearchDiagnostics()` 补 `bm25Norm: new Float64Array(0)`；`buildDiagnosticCandidate()`（`:693-711` 区间）`cosine` 去掉 `vectorTopSet` 门槛与 `round3`，新增 `bm25Norm` 输出；顶部 `round3` 注释同步。
  - 测试 `sango/src/test/feat-A009/sango-diagnostics.test.ts`：每条候选含新字段；逐条断言 `round3(0.3*(bm25Norm??0) + 0.6*((cosine??-1)+1)/2 + 0.1*(labelHit?1:0)) === finalScore`；`bm25Norm` 命中集合内 min-max 口径；降级夹具 `cosine`/`bm25Norm` null 语义；截断 fixture 补字段。
- **mcp-orchestrator（老陈）**：存储 / 查询**零代码改动**（`storage/logs.ts` 为 `JSON.stringify`/`JSON.parse` 泛化透传，无字段白名单）；仅补测试 `src/test/feat-A009/logs-api-diagnostics.test.ts`：固定 trace 样本查询返回含 `bm25Norm` 且可复算。
- **mcp-web（小叶）**：`src/api/client.ts` 类型增 `bm25Norm`；`src/utils/retrievalDiagnostics.ts` + `src/components/RetrievalDiagnosticsPanel.vue`「三路分」改展示参与计算的三条分量（BM25 归一化 / 向量映射 / 标签），原始 `bm25`/`cosine` 放 tooltip 或副文案。
- **不属本 bug（2026-09-21 负责人）**：候选表「最终分」列的 hover 算式代入展示（原样列算式 + 逐项代入实际值）为展示能力追加，归 **feat-A009 验收 6b**，复用本 bug 补齐的契约字段（`bm25Norm` / `cosine` / `labelHit` / `finalScore`），不另立票。
- **dev-docs（Coco 审）**：`mcp-orchestrator/api/feat-A009-recall-diagnostics.md` §1.2 示例 + §1.3 字段表 + 计分口径 + 60aa5476 例；`requirements/feat-A009-recall-diagnostics.md` 验收 6 分数表描述同步。

## 验收标准（负责人）

1. 给定 `60aa5476-6ea1-4d2d-a560-c8287101ab4a`，`candidates[]`/`nextRank` 每条仅靠接口字段算出的值与 `finalScore` 逐条严格相等。
2. `cosine` 对非向量 top-50 候选不再误显示为 null（向量路可用时全覆盖）。
3. 回归：`dc1b7b5b` 与上述固定样本通过；mcp-server / mcp-orchestrator / mcp-web 全量测试与编译通过。

## 排期与依赖

- 修复在 feat-A009 各自分支（`chen/feat-A009_sango-diagnostics`、`coco/feat-A009_recall-diagnostics`、`ye/feat-A009_log-diagnostics`）上完成，随本特性一起复测；不另起新特性。
- 顺序：老陈先出接口文档（契约先行）→ 老陈 mcp-server 实现 + 测试 → 小叶前端对接 → Coco 审查 → 重新提测。
