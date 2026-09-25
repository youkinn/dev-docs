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
| POST | `/dev/benchmark/run` | 无 body | `{ runId, summary, results }`（同步返回，执行中页面等待） |
| GET | `/dev/benchmark/latest` | — | 最近一次快照 `{ runId, time, summary, results }`；无快照时 `data: null` |
| GET | `/dev/benchmark/history` | — | 快照列表 `[ { runId, time, summary } ]`（不含 results，按时间倒序） |
| GET | `/dev/benchmark/snapshot` | `runId` | 该次快照 `{ runId, time, summary, results }`；无快照 `data: null` |

- `POST run`：评测集文件缺失 / 解析失败 → `500 { code:500, message }`（message 含路径）；已在执行中收到新请求 → `409 { code:409, message:'benchmark already running', data:{ runId } }`（页面执行按钮禁用兜底，正常不会触发）。
- `GET snapshot`：runId 不存在 → `404 { code:404, message }`。
- **原文查看不需要新接口**：候选 chunkId 格式 `{source}:{回号4位零补}:c{回内序号4位零补}`（例 `sanguo-yanyi:0085:c0011`），前端解析出回号后复用前厅既有 `SangoChapterReader`（`chapter` 必填 + `chunkId` 选填定位高亮，feat-A010 契约）。若实现中发现该组件无法按 chunkId 定位，向 Coco 报备后再补只读 chunk 原文入口。
- `GET /dev/benchmark/snapshot` 为需求验收 8「可切换查看任意一次历史执行」的直接支撑（history 只回摘要，明细按 runId 拉取），属契约落实而非接口范围扩张。

## 4. 快照格式（与 CLI 产物同构，禁止另造格式）

落盘：`{SANGO_BENCHMARK_RESULTS_DIR}/feat-A015-YYYY-MM-DD-HHMM.json` 及同名 `-summary.md`（同日多次执行不重名）。

JSON 顶层：`{ summary, results }`

- `summary`：`{ tool, version, time, benchmark, engine, total, top5, tail, miss, top3, top10, inPool50, noAnchorCount, noAnchor, category, runId }`；`category` = `{ 类别名: { total, top5, tail, miss } }`；`runId = feat-A015-YYYY-MM-DD-HHMM`。
- `results[]`（单题）：`{ id: "类别#序号", question, answer, evidence, textAnchors[], titleAnchors[], chapterRefs[], rank /* 0=未召回 */, status: 'top5'|'tail'|'miss', hit: { id /* chunkId */, chapter, title, text } | null, candidates: [ { id, chapter, title } ] /* top50 候选，页面列候选与点 chunkId 看原文 */ }`。
- `summary.md` 沿用 CLI 模板：引擎/判分口径头 + 「十三段模板 COPY」类别表 + 兜底（rank 6–10）列表 + 未命中（>10 / 未召回）列表。

## 5. 页面（mcp-web，小叶）

- 路由 `/benchmark` → `views/BenchmarkView.vue`，导航菜单入口。
- Vite dev 代理新增 `/sango-bench` → `http://127.0.0.1:8787`（`vite.config.ts`）；页面基址 `VITE_BENCHMARK_API_BASE` 默认 `/sango-bench`（不硬编码后端地址）。
- 汇总表列：类别 / 总题数 / 通过数 / 失败数 / Top5命中数 / 通过率；口径：通过数 = 命中数 = `summary.top5`、失败数 = `summary.tail + summary.miss`、通过率 = `top5 / total`。
- 「执行」按钮：点击调 `POST run`，执行中禁用并展示等待态，异常展示 `message`。
- 类别行可展开：该类别每题明细（序号 1–110 / 问题 / 参考答案 / 期望命中 / 排名 / 状态）+ 候选列「查看」按钮打开候选弹框（全部候选：短 chunkId 去 {source}: 前缀 + 回目），点条目打开 `SangoChapterReader` 定位原文核对。
- 历史快照列表：`GET history`（runId / 时间 / 摘要），点击切换表格 / 展开明细 / 图表为该次数据（`GET snapshot`）；通过率趋势折线按 runId 依次展示历史整体对比。
- 筛选下拉：全部 / top5（rank 1–5）/ top10（rank 6–10）/ top10+（rank>10 或未召回，rank=0 归此类）；筛选后明细与图表跟随变化。
- 图表用 echarts（已有依赖，CacheView 先例）：类别 ×（通过 / 兜底 / 未命中）堆叠柱状图 + 整体通过率；点击柱 / 图例联动展开对应类别明细；跟随当前选中快照。

## 6. 验收映射（需求验收 6–9）

- 验收 6 → §3 `POST run` + §5 汇总表 / 执行按钮；验收 7 → §5 类别展开 + 图表联动；验收 8 → §3 history/snapshot + §5 历史切换 + 趋势折线；验收 9 → §5 筛选下拉。

## 7. 联调运行

```powershell
cd D:\workplace\mcp-server\sango
npm run dev:benchmark   # 构建 + SANGO_DEV_HTTP_PORT=8787 + node dist/index.js（加载语料 + 向量约 12 秒）
# 等价手写：npm run build; $env:SANGO_DEV_HTTP_PORT = "8787"; node dist/index.js
```

## 8. 边界（不做）

- 不做检索 / 切片 / 重排 / 拒答策略改动；不做 LLM 判定；不评价答案文本；不改评测集与既有 CLI 产物格式；不写回评测集。

## 维护记录

- 2026-09-25 提测验收调整同步：汇总列改「类别 / 总题数 / 通过数 / 失败数 / Top5命中数 / 通过率」；明细字段口径改「序号 / 问题 / 参考答案 / 期望命中 / 排名 / 状态」；候选交互改「查看」按钮 + 候选弹框（短 id + 回目，点条目开原文）；页面分「类别汇总」「图表」两标签页，标签选择跨刷新持久化 — Coco
*** End Patch
