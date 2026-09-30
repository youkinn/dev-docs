# FEAT-A015 执行接口契约（story-A015-02）

> 用途：老陈按此实现 sango 本地 dev 执行接口 + 评测 runner 收敛；小叶按此实现 mcp-web 执行结果页。
> 契约定稿人：Coco；契约变更先问 Coco，不得自行改接口/字段。
> 需求依据：`requirements/feat-A015-eval-standard-set.md`（已定稿）；判分口径以需求文档为准。

## 1. 总体约束

- 仅本地 dev：sango 进程内 HTTP 服务，只绑定 `127.0.0.1`，不注册为 MCP 工具，不经总台（mcp-orchestrator）。
- 启动控制：环境变量 `SANGO_DEV_HTTP_PORT`（默认 `8787`）——设置即启动 dev HTTP；未设置不启动（生产 stdio MCP 零影响）。
- **判定逻辑只存一份**：评测集解析 / 证据锚匹配 / 汇总逻辑从 dev-docs CLI 收敛到 sango `src/benchmark/` 单模块；HTTP 接口与命令行脚本共用同一实现，禁止两份漂移。dev-docs CLI 随后改为调 `POST /dev/benchmark/run` 的薄壳（由 Coco 在接口落地后跟进，属 story-A015-02 范围）。
- 路径配置（env，均有默认值，仅本地 dev）：
  - `SANGO_BENCHMARK_FILE` → 评测集 md，默认 `D:\workplace\dev-docs\docs\sango-rag-regression-benchmark_v0.1.md`
  - `SANGO_BENCHMARK_RESULTS_DIR` → 快照目录，默认 `D:\workplace\dev-docs\test\standard-set\results`
- 响应信封（对齐 mcp-web `api/client.ts` 惯例）：成功 `{ code: 200, message: 'ok', data }`；失败 `{ code: 4xx/5xx, message }`。前端以 `code === 200` 判成功。

## 2. 模块划分（mcp-server `sango/src/`）

| 文件 | 职责 |
|---|---|
| `benchmark/parser.ts` | 解析评测集 md：`## 类别` 小节 + `\| # \| 问题 \| 标准答案 \| 证据 \|` 表格行；「十二/十三」小节不计题（结构契约见评测集文件头部） |
| `benchmark/matcher.ts` | 证据锚匹配：正文优先、回目锚限回次之；中文标点归一化；长锚失配回退短语（≥4 字）——与 `dev-docs/test/standard-set/feat-A015-verify.mjs` 现行逻辑同口径移植，禁止另起炉灶 |
| `benchmark/runner.ts` | 逐题 `SangoIndex.search(question, 50)` + 判定 top5/tail/miss + 类别汇总；串行执行（并发由 server 层挡） |
| `benchmark/snapshot.ts` | 快照 JSON + summary md 落盘（格式见 §4，与 CLI 产物同构） |
| `benchmark/server.ts` | HTTP 路由（`node:http` 原生，零新增依赖） |
| `index.ts` | 装配：env 设置 `SANGO_DEV_HTTP_PORT` 时用已 `load()` 的 SangoIndex 实例启动 server |

## 3. 接口

Base：`http://127.0.0.1:{port}/dev/benchmark`

| 方法 | 路径 | 入参 | 出参 `data` |
|---|---|---|---|
| POST | `/dev/benchmark/run` | 无 body | `202 { runId, state: 'running' }`（bug-00049 B 案：异步 job，立即返回，不再同步等待） |
| GET | `/dev/benchmark/run-status` | — | `{ state: 'running'\|'done'\|'failed'\|'aborted'\|'idle', runId, elapsedMs?, error? }`（内存态，只保留最近一次 job） |
| POST | `/dev/benchmark/run-abort` | 无 body | `200 { code: 200, message: 'ok', data: { state: 'aborted' } }`（停止请求已受理，run 在当前题结束后中断）；无在跑 → `409 { code: 409, message: 'no running benchmark', data: { runId: null } }` |
| GET | `/dev/benchmark/latest` | — | 最近一次快照 `{ runId, time, summary, results }`；无快照时 `data: null` |
| GET | `/dev/benchmark/history` | — | 快照列表 `[ { runId, time, summary } ]`（不含 results，按时间倒序） |
| GET | `/dev/benchmark/snapshot` | `runId` | 该次快照 `{ runId, time, summary, results }`；无快照 `data: null` |

- `POST run`（bug-00049 B 案：异步 job）：触发即回 `202 { runId, state: 'running' }`，不等 run 结束；已在执行中收到新请求 → `409 { code:409, message:'benchmark already running', data:{ runId: <在跑的那个> } }`（沿用单飞，页面执行按钮禁用兜底）。runId 仍在启动时生成，格式不变。
- `GET run-status`（bug-00049 B 案：轮询）：`state` 取值——`running`（在跑，无 `elapsedMs`）/ `done`（`elapsedMs` = 该次 `summary.elapsedMs`，口径同 §4）/ `failed`（`error` 为摘要文本，不含大段堆栈）/ `aborted`（test-2241 追加：停止请求已生效，只带 `runId`、不带 `elapsedMs`，且不落快照——见下条）/ `idle`（无在跑且无最近记录，`runId: null`）。内存态、单进程、只保留最近一次 job，重启即丢；评测集缺失 / 解析失败等 run 内错误经此回 `failed`，不再由 POST 返回。**不做进度百分比**（负责人 2026-09-29 拍板）。
- `POST run-abort`（test-2241 追加，负责人 2026-09-29 拍板）：停止请求——仅「有在跑」时受理，回 `200 { code: 200, message: 'ok', data: { state: 'aborted' } }`（= 请求已受理，run 在**当前题结束后**中断；逐题之间检查，单题约 0.8s，点击后 1–2 秒内转 `aborted`）；无在跑 / 已 done 一律 `409 { code: 409, message: 'no running benchmark', data: { runId: null } }`（不幂等 200）。中止经专用 `BenchmarkAbortedError` 映射为终态 `aborted`（**不落成 `failed`**）；**停止不落快照**：部分结果与 summary / summary.md 一律不写盘，`latest` / `history` / `snapshot` 均不出现该 run；`run-status` 转 `aborted` 只带 `runId`、不带 `elapsedMs`；aborted 后单飞锁释放，可立即再发起新 run。
- `GET snapshot`：runId 不存在 → `404 { code:404, message }`。
- **原文查看不需要新接口**：候选 chunkId 格式 `{source}:{回号4位零补}:c{回内序号4位零补}`（例 `sanguo-yanyi:0085:c0011`），前端解析出回号后复用前厅既有 `SangoChapterReader`（`chapter` 必填 + `chunkId` 选填定位高亮，feat-A010 契约）。若实现中发现该组件无法按 chunkId 定位，向 Coco 报备后再补只读 chunk 原文入口。
- `GET /dev/benchmark/snapshot` 为需求验收 8「可切换查看任意一次历史执行」的直接支撑（history 只回摘要，明细按 runId 拉取），属契约落实而非接口范围扩张。

## 4. 快照格式（与 CLI 产物同构，禁止另造格式）

落盘：`{SANGO_BENCHMARK_RESULTS_DIR}/feat-A015-YYYY-MM-DD-HHMM.json` 及同名 `-summary.md`（同日多次执行不重名）。

JSON 顶层：`{ summary, results }`

- `summary`：`{ tool, version, time, benchmark, engine, total, judged, top5, tail, miss, top3, top10, inPool50, noAnchorCount, noAnchor, category, runId, rerank, elapsedMs }`；`judged = total - noAnchorCount`（bug-00052：无锚题单列、不进通过率分母，通过率分母一律用 `judged`；老快照无此键 → 前端显示「—」）；`category` = `{ 类别名: { total, top5, tail, miss } }`（不含无锚题）；`runId = feat-A015-YYYY-MM-DD-HHMM`。
- `summary.rerank`（test-2241 第 5 项新增；**dev server 扩展字段，老快照无此键 → 前端显示「—」**）：`{ mode: 'on'|'off', wired: boolean, window: number, maxTokens: number, batch: number, intraThreads: number|null }`。口径：`mode` = `SANGO_RERANKER` 原始取值归一（仅 `'on'` 为 on，未设 / 其它值一律 off）；`wired` = 本次 run 是否真的接入 cross-encoder 打分器（权重缺失退回规则序时为 false）；`window` = 实际生效窗口（`sango-index.ts` `rerankWindowSize()`，非 .env 原文）；`maxTokens` / `batch` / `intraThreads` = `resolveRerankTuning()` 生效值（含默认回落；`intraThreads` 未设 → null）。
- `summary.elapsedMs`（test-2241 第 5 项新增；**dev server 扩展字段，老快照无此键 → 前端显示「—」**）：本次 run 服务端计时（毫秒；run 开始 → 逐题检索判分结束，不含落盘与 HTTP 传输）；同为 `GET run-status` done 态 `elapsedMs` 的来源。
- `results[]`（单题）：`{ id: "类别#序号", question, answer, evidence, textAnchors[], titleAnchors[], chapterRefs[], rank /* 0=未召回 */, status: 'top5'|'tail'|'miss'|'noAnchor', noAnchor /* bug-00052：无有效证据锚 → 不参与判分、单列；有锚题恒 false */, hit: { id /* chunkId */, chapter, title, text } | null, candidates: [ { id, chapter, title } ] /* top50 候选；无锚题为 [] */ }`。
- `summary.md` 沿用 CLI 模板：引擎/判分口径头 + 「十三段模板 COPY」类别表 + 兜底（rank 6–10）列表 + 未命中（>10 / 未召回）列表。

## 5. 页面（mcp-web，小叶）

- 路由 `/benchmark` → `views/BenchmarkView.vue`，导航菜单入口。
- Vite dev 代理新增 `/sango-bench` → `http://127.0.0.1:8787`（`vite.config.ts`）；页面基址 `VITE_BENCHMARK_API_BASE` 默认 `/sango-bench`（不硬编码后端地址）。
- 汇总表列：类别 / 总题数 / 未参与评分 / 可判题数 / 通过数 / 失败数 / Top5命中数 / 通过率；口径：通过数 = `summary.top5`、失败数 = `summary.tail + summary.miss`、通过率 = `top5 / judged`（bug-00052：无锚题单列、不进通过率分母；整体用 `summary.judged` / `summary.noAnchorCount`，类别行零锚数由 `results[].noAnchor` 计数）。
- 明细：无锚题整行灰显 + 状态列「未参与评分」标签、排名列显示「—」；有锚题行为不变。
- 「执行」按钮：点击调 `POST run`，执行中禁用并展示等待态，异常展示 `message`。
- 类别行可展开：该类别每题明细（序号 1–110 / 问题 / 参考答案 / 期望命中 / 排名 / 状态）+ 「召回列表」列「查看」按钮打开召回列表弹框（全部候选：短 chunkId 去 {source}: 前缀 + 回目），点条目打开 `SangoChapterReader` 定位原文核对。
- 历史快照列表：`GET history`（runId / 时间 / 摘要），点击切换表格 / 展开明细 / 图表为该次数据（`GET snapshot`；列表 5 条/页分页，当前快照行绿色高亮）；通过率趋势折线按 runId 依次展示历史整体对比（hover 摘要卡 + 首次执行基线虚线）。
- 筛选下拉：全部 / top5（rank 1–5）/ top10（rank 6–10）/ top10+（rank>10 或未召回，rank=0 归此类）；筛选后明细与图表跟随变化。
- 图表用 echarts（已有依赖，CacheView 先例）：类别 ×（通过 / 兜底 / 未命中）堆叠柱状图 + 整体通过率；点击柱 / 图例联动展开对应类别明细；跟随当前选中快照。

## 6. 验收映射（需求验收 6–9）

- 验收 6 → §3 `POST run` + §5 汇总表 / 执行按钮；验收 7 → §5 类别展开 + 图表联动；验收 8 → §3 history/snapshot + §5 历史切换 + 趋势折线；验收 9 → §5 筛选下拉。

## 7. 联调运行

```powershell
cd D:\workplace\mcp-server\sango
npm run dev   # 构建 + SANGO_DEV_HTTP_PORT=8787 + node dist/index.js（加载语料 + 向量约 12 秒）
# 等价手写：npm run build; $env:SANGO_DEV_HTTP_PORT = "8787"; node dist/index.js
```

## 8. 边界（不做）

- 不做检索 / 切片 / 重排 / 拒答策略改动；不做 LLM 判定；不评价答案文本；不改评测集与既有 CLI 产物格式；不写回评测集。

## 9. 备忘：历史快照比较功能（bug-00047 已实现，待验收）

- **票号：bug-00047**（性质=**需求追加**；随票同批 test-2031 第 6 项剩余三条；实现已落地、待负责人验收）。来源：负责人 test-2031 第 9 项（`test/feat-A018/test-2031.md`）；归属 **FEAT-A015**（该特性 2026-09-25 已归档，需求文档按归档红线不改，本项作为其归档后新增能力的备忘落此处）。
- 口径（负责人 2026-09-29 拍板）：**纯前端实现，后端零改动** —— 复用既有 GET /dev/benchmark/history（快照列表）与 GET /dev/benchmark/snapshot?runId=（{ summary, results } 逐项 id / question / rank / status）；只比较**题量一致**的快照（题量不一致不做比较）；展示逐项名次升降 / 入榜出榜与类别计数变化。
- 交互（test-2031 原始需求）：历史快照列表末尾加操作列，点击弹出选择「与哪条历史快照比较」，结果需一眼看出变化。
- **test-2241 第 5 项**（历史快照加「是否开启重排」列 + 「本次耗时」列；负责人 2026-09-29 拍板 **A 案**：两项随快照落盘、前端只读快照 / 历史接口，不读当前 env）：后端只增字段 `summary.rerank` / `summary.elapsedMs`（契约见 §4），前端按字段具名取用即可；老快照无这两个字段时显示「—」。与 bug-00049 B 案同轮落地，不拆轮、不做进度条。
- **bug-00049 B 案**（负责人 2026-09-29 拍板）：`POST /dev/benchmark/run` 异步化——立即 `202` + `GET /dev/benchmark/run-status` 轮询到 `done` / `failed`；单飞 `409` 语义与 runId 生成口径不变，不做进度百分比。契约见 §3。
- **test-2241 追加「停止」按钮**（负责人 2026-09-29 拍板：**停止不落快照、不落一版**）：`POST /dev/benchmark/run-abort` → 受理后 run 逐题之间中断、终态 `aborted`、单飞锁释放；停止不写盘（部分结果与 summary / summary.md 一律不落，历史列表不出现该 run）。契约见 §3。

## 维护记录

- 2026-09-25 提测验收调整同步：汇总列改「类别 / 总题数 / 通过数 / 失败数 / Top5命中数 / 通过率」；明细字段口径改「序号 / 问题 / 参考答案 / 期望命中 / 排名 / 状态」；候选交互改「查看」按钮 + 候选弹框（短 id + 回目，点条目开原文）；页面分「类别汇总」「图表」两标签页，标签选择跨刷新持久化；sango 启动脚本由 `npm run dev:benchmark` 更名 `npm run dev`（负责人拍板），§7 与 CLI 头注同步；通过率趋势 hover 摘要卡 + 首跑基线虚线；历史表分页 5 条/页、当前行绿色高亮替代「当前」标签；类别分布三色（语义不变）— Coco
- 2026-09-29：新增 §9 备忘（历史快照比较功能，纯前端 / 后端零改动；归属 FEAT-A015 归档后新增，需求文档按红线不动）；移除文末误留的 `*** End Patch` 补丁标记。Coco。
- 2026-09-29：test-2241 第 5 项（历史快照加「是否开启重排」+「本次耗时」两列，随快照落盘）与 bug-00049 B 案（run 接口异步化 + run-status 轮询，不做进度）合并落地：§3 接口清单改异步形态并补 `/run-status` 与 state 取值，§4 补 `summary.rerank` / `summary.elapsedMs`，§9 备忘追加两条，文末维护记录合并一行（均负责人 2026-09-29 拍板）。老陈。
- 2026-09-29：test-2241 追加「停止」能力——§3 接口清单补 `POST /run-abort`（仅在跑受理 200 / 否则 409，不幂等），`run-status` 的 state 取值补 `aborted`（只带 runId，不落成 failed），并写明「停止不落快照」（部分结果与 summary 不写盘、历史列表不出现该 run）；§9 备忘追加一行。负责人 2026-09-29 拍板「停止不落一版」。老陈。
