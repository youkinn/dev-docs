# bug-00063 A015 评测缺「回级命中」维度致失败归因失真
- 状态：已修复（2026-10-14）

## 现象

A015 回归快照 `test/standard-set/results/feat-A015-2026-10-13-1158.json`（235 题）段级通过 165/235 = 70.2%。失败的 70 条一律记为「兜底 / 未命中」，无法区分两类完全不同的原因：

- 检索**没找到**该回目（真检索缺口，才该改检索）；
- 检索**已找到**该回目、只是不是标准集指定的那一段（该改分段或标准集锚，改检索无用）。

两者混在同一个读数里，会让整改方向误判。

## 机制读数（快照 feat-A015-2026-10-13-1158）

- 段级 = 标准集证据段进候选 top5 = **165/235 = 70.2%**（现行通过率口径）。
- 回级 = 期望回目（`chapterRefs`）中任意一段进候选 top5 = **195/235 = 83.0%**。
- 差 **30 题** = 回级已命中、段级未中。
- 70 条段级失败按回级名次分层：≤5 → 30 条；6–10 → 21 条；11–50 → 16 条；>50 / 未进池 → 3 条。
- 逐条清单与分派见 `docs/a015-benchmark-gap-routing.md`。

## 修复口径（契约）

本票只补「观察维度」，**不改现有通过率口径与判分逻辑**：

- 单题新增 `chapterRank: number` = 该题 `chapterRefs` 在本题候选池（`index.search(question, 50)` 的 entries）中最早出现的名次（1 起）；未出现或 `chapterRefs` 为空 = `0`；`chapterRefs` 多回时取最早。
- 类别新增 `category[cat].chapterTop5: number` = 该类 `chapterRank ∈ [1,5]` 的题数。
- 顶层新增 `summary.chapterTop5: number` = 全量 `chapterRank ∈ [1,5]` 的题数。
- `noAnchor` 题（无有效证据锚、不参与判分）不计入 `chapterTop5`，`chapterRank` 记 `0`。
- 不改动 `rank` / `status` / `top5|tail|miss|top3|top10|inPool50` 的语义与取值。
- 评测台：汇总表并列「回级命中」列（`chapterTop5`），明细并列「回名次」列（`chapterRank`，0 显示「未进池」）；老快照缺字段读侧按 0 兜底。比较弹框与「通过率趋势」不接入本字段。

## 验证方式

- 单测：`chapterRank` 覆盖单回命中 / 多回取最早 / 未进池=0 / `noAnchor`=0；`chapterTop5` 的分类与合计口径。
- 对拍：以快照 1158 的 `results[].chapterRefs × candidates[].chapter` 逐题复算，`summary.chapterTop5` 应 = 195，段级失败中 `chapterRank ∈ [1,5]` 应 = 30。
