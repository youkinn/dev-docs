# bug-00047 评测控制台历史快照：比较功能（需求追加）+ test-2031 第 6 项剩余三条

> Bug 号：bug-00047
> 状态：修复中（待验收）
> 关联特性：**feat-A015（需求追加）** + feat-A018（提测批次）
> 涉及项目：mcp-web（本轮唯一改动方）；mcp-server（评估完成，本轮零改动）
> 登记：Coco ／ 报告：负责人 ／ 登记日期：2026-09-29

## 性质与范围（**属需求追加，非缺陷**）

- **需求追加**：历史快照「比较功能」（负责人 test-2031 第 9 项）。feat-A015 需求文档 2026-09-25 已归档（归档后冻结），本项作为该特性**归档后新增能力**，需求文档按红线不动，备忘落 docs/feat-A015-benchmark-api.md §9。
- 随票同批（test-2031 第 6 项剩余三条，提测反馈）：① 历史快照点击 loading + 防重复点击；② 摘要后显示整体耗时；③ 「请求超时，请稍后重试。」止血。

## 口径与事实（负责人 2026-09-29 拍板 + 老陈评估）

- 比较功能：**纯前端实现、后端零改动**；复用 GET /dev/benchmark/history 与 GET /dev/benchmark/snapshot?runId=（{ summary, results } 逐项 id / question / rank / status；summary.category 计数）；**只比较题量一致的快照**（题量不一致不做比较），id 行号漂移不兼容。
- 超时根因（实测）：全量 run 61.4s（246 题，历史快照推算 3.6～4.1min，波动大）；前端 enchmarkClient.timeout = 120_000（client.ts:384）触发 ECONNABORTED → 报错文案；Vite 代理未配 proxyTimeout；后端 POST /dev/benchmark/run 同步阻塞（前端断开后仍跑完并落盘，这是「报错但历史里有快照」的原因）。
- 止血 A（本轮落地）：前端 timeout 提至 300s **且** ite.config.ts 补 proxyTimeout（必须同改，否则代理先掐）。根治 B（后端异步 job + 轮询）属方案性改动，另立课题、接口文档先出，本票不做。

## 验收

- 比较：选另一条题量一致快照 → 逐项名次升降 / 入榜出榜 / 类别计数变化可见（真浏览器 + 真快照数据）。
- 第 6 项：历史快照点击后 loading 且重复点击被拦；摘要后出现整体耗时读数；正常 run 不再误报超时。
- 门禁：mcp-web 	est / lint / uild exit 0；**零新增 LLM 调用**。

## 追加项：test-2031 第 11 项（评测集「出场」类不入汇总）

- 现象：题库新增「出场」类问题后，评测控制台汇总列表永远不展示该类。
- 根因：评测集 docs/sango-rag-regression-benchmark_v0.1.md 有 ## 十一、出场（第 286 行），但 sango/src/benchmark/parser.ts 的 CATEGORIES 白名单硬编码 12 类、缺「出场」→ 解析时整行被 continue 丢弃。
- 修复：parser.ts 白名单补「出场」（顺序对齐评测集：事件关系 → 出场 → 死亡 → 拒答）；snapshot.ts 的 CATEGORY_LABEL 补「问法归一」「出场」两项（此前仅 11 项、与 CLI 13 项漂移）；dev-docs 	est/term-diff/term-diff.mjs 同类清单 STD_CATEGORIES 一并补齐。
- 验证（零 LLM 真实全量 run）：246 题、summary.category 13 类齐全，出场: { total: 30, top5: 19, tail: 3, miss: 8 }，summary.md 出「出场」行 | 出场 | 30 | 19 | 3 | 8 | 63.3% |；
pm run build exit 0 + 既有测试 102/102 绿。
- 未决（提请负责人）：① 该白名单是否数据化（改为按评测集小节动态识别、标签表只做显示名映射），避免以后每加一类改三处；② 事实库与评测集头部仍写「120 题 / 12 类」，实际 246 题 / 13 类，需同步文档。

## 备注（负责人 2026-09-29 裁定）

- 解析白名单是否数据化的建议（把 parser.ts 的 CATEGORIES 改为「按评测集小节动态识别 + 标签表只做显示名映射」，避免每加一类改三处）**跟本票一起备注即可**，本轮不重构、不另立票。
