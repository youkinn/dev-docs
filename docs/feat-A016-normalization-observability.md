# FEAT-A016 归一化过程可观测（提测增补方案）

> 来源：负责人 test-1921 第 2 项——A016 增加大量名称归一化处理，后台日志页不体现、不易排查，要求日志页能清晰看到过程。拍板并入 A016（2026-09-26）。
> 契约依据：`docs/feat-A016-term-normalization-interface.md` §5；验收口径：`requirements/feat-A016-term-normalization.md` 验收 8。

## 问题

- 归一化是 A016 核心环节（query 改写 + 双侧归一化），但日志页只显示结果（`query.normalized` / `env.aliasCount`），看不到「命中哪些键、改成了什么」。
- 排查「为什么没改 / 改成什么」只能拿 raw 与 normalized 人工比对——桃园三结义问题即靠 trace 实测 `normalized=桃园桃园结义` 才定位。

## 方案

- 契约（**09-29 修订**）：`tool_retrieval_logs.diagnostics` 增 `query.expansionHits`（`[{from, to}]`：query 原文命中可双写键 → 规范形；语义 = 索引侧已按等价写法双写覆盖，**不改写问句**）与 `env.normVersion`；`query.rewrites` 保留但恒 `[]`（检索侧不改写）。老字段不动、老消费方零影响；缓存侧 `cache_logs` 不变。
- 日志页（mcp-web）两处展示：
  1. 检索诊断 Query 区（raw → normalized → tokens 链，新 trace `normalized == raw`）：展示「双写扩展」明细（from → to，标注「未改写问句、仅索引侧等价覆盖」）；无命中显示「无扩展」。
  2. 「召回漏斗」头部环节由「归一化改写」更名「索引双写扩展」（仍位于「语料 chunk」之前），显示扩展命中数；tooltip 改为「等价写法在索引侧双写覆盖，问句未被改写」。
- 编排侧：diagnostics 为不透明透传（`recallDiagnostics.ts` / `storage/logs.ts` 原样落库回传），零改动。
- 实现分布：mcp-server `normalizeDetail` + 诊断字段（老陈）；mcp-web 面板与漏斗标注（小叶）。不引入 LLM、不动索引 / 缓存键 / 检索权重。

## 代价与取舍

- 备选 1：不动契约、只渲染已有 normalized —— 代价：仍看不到命中明细与表版本，桃园类问题依旧要拿 trace 人工比对，不解决排查缺口根因，否决。
- 备选 2：`query.rewrites` 含「尝试命中但被邻接延伸检查保护、未替换」的键 —— 信息更全但噪声大、实现复杂，先不做，有需要另议。
- 体积：hits 通常 0~3 条，诊断落库体积可忽略；无 LLM 调用增加（原则 14 不触发）。

## 验证

- 历史 trace（旧口径）：三 trace（96bbe8ae / f8aa23ba / 4f04f5f3）仍按旧口径可见「桃园结义 → 桃园三结义」改写明细、「归一化改写」环节命中数 > 0（新 trace 不再产生该形态）。
- 新口径 trace：`query.rewrites = []`、`query.normalized == raw`、`query.expansionHits` 非空时页面显示「索引双写扩展」环节与 from → to 明细；无命中显示「无扩展」。
- `过五关斩六将` 请求可见改写明细。
- 无改写请求显示「改写明细：无改写」、漏斗头部命中数 0。
- 2026-09-29：口径跟随 bug-00046 定案修订——改写明细改 `query.expansionHits`、漏斗环节更名「索引双写扩展」、补历史 trace 渲染分支。Coco。
