# FEAT-A018 评测控制台：多评测集 + 组判分 —— 执行接口契约（story-A018-03）

> 用途：老陈按此实现 sango 本地 dev 评测接口多集化 + 组判分 runner；小叶按此实现评测控制台多集下拉与组判分页面。
> 契约定稿人：Coco；契约变更先问 Coco，不得自行改接口 / 字段。
> 需求依据：`requirements/feat-A018-event-table.md`（story-A018-03 任务，负责人 2026-10-10 定案：多评测集下拉 + 组判分）。
> 前置契约：`docs/feat-A015-benchmark-api.md`（单集形态，本文在其上扩展）；组判分口径与 `test/events/events-recall-probe.mjs`（story-A018-02 交付的离线探针）逐条一致，禁止分叉。

## 1. 范围与总体约束

- 本次扩展在 A015 单集执行接口之上做「多评测集 + 组判分」，A015 既有契约与行为完全向后兼容（缺省 setId = 标准集；老快照可读）。
- 判定逻辑只存一份：锚判定 = `benchmark/runner.ts`（A015 收敛），组判分 = `benchmark/group-runner.ts`（与 `test/events/events-recall-probe.mjs` 同口径）；禁止另造并行实现。
- 响应信封 / 启动控制 / 仅绑定 `127.0.0.1` / 日志走 stderr 等均沿用 A015（§1 / §2），本文只描述新增与变更。

## 2. 评测集注册表

服务端注册表（代码内定义于 `benchmark/sets.ts`，env 仅覆盖两集路径）：

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | string | 稳定标识：`standard`（标准评测集）/ `events`（事件 / 典故组召回） |
| `name` | string | 页面下拉展示名 |
| `file` | string | 评测集文件路径（anchor=md，group=json） |
| `judge` | `'anchor'` \| `'group'` | 判分模式 |
| `resultsDir` | string | 快照目录（按评测集隔离；服务端内部，不随 GET /sets 暴露） |
| `runIdPrefix` | string | `feat-A015` / `feat-A018`（快照文件名 / runId 按评测集区分） |

路径配置（env，均有默认值，仅本地 dev）：

- 标准集：`SANGO_BENCHMARK_FILE` / `SANGO_BENCHMARK_RESULTS_DIR`（沿用 A015，默认不变）。
- 事件集：`SANGO_EVENTS_EVAL` / `SANGO_EVENTS_RESULTS_DIR`（与探针同名；默认 `test/standard-set/events/eval-set.json` / 其同级 `results` 目录）。

### GET /dev/benchmark/sets

出参 `data`：`[ { id, name, file, judge } ]`（按注册顺序：standard、events）。页面以此渲染评测集下拉。

## 3. 多集运行接口

Base：`http://127.0.0.1:{port}/dev/benchmark`

| 方法 | 路径 | 入参 | 出参 `data` |
|---|---|---|---|
| POST | `/dev/benchmark/run` | body `{ setId? }`（可空 body） | `202 { runId, state: 'running', setId }` |
| GET | `/dev/benchmark/run-status` | — | `{ state, runId, setId?, elapsedMs?, error? }` |
| POST | `/dev/benchmark/run-abort` | 无 body | 沿用 A015（200 / 409） |
| GET | `/dev/benchmark/latest` | `?setId=` | 该集最近一次快照 `{ runId, time, summary, results }`；无则 `data: null` |
| GET | `/dev/benchmark/history` | `?setId=` | 该集快照列表 `[ { runId, time, summary } ]`（时间倒序，不含 results） |
| GET | `/dev/benchmark/snapshot` | `?runId=&setId=` | 该次快照 `{ runId, time, summary, results }`；无则 `404` |
| GET | `/dev/benchmark/sets` | — | 注册表列表（见 §2） |

- `POST run`：`setId` 缺省 / 空 body = `standard`（完全向后兼容）；`setId` 未知 → `404 { code:404, message:'unknown benchmark set: <id>' }`；已在执行中 → `409`（沿用单飞）；body 非法 JSON / 超限（64KB）→ `400`。runId 在启动时生成：`standard` = `feat-A015-YYYY-MM-DD-HHMM`（沿用 A015）；`events` = `feat-A018-YYYY-MM-DD-HHMMSS`（组集单次约 17s，秒级粒度避免同分覆盖）。`data.setId` 恒返回本次所属集。
- `GET run-status`：多返回 `setId`（本次 job 属于哪个集，页面据此联动）；无在跑且无最近记录仍 `{ state:'idle', runId:null }`。其余 state 语义（running / done / failed / aborted）、内存态单进程、重启即丢、不做进度，全部沿用 A015。
- `POST run-abort`：语义与 A015 一致（停止不落快照、终态 aborted、单飞释放）。
- `latest` / `history`：`setId` 缺省 = `standard`（A015 行为不变）；`setId` 未知 → `404`。按集隔离：各集快照落各自 `resultsDir`，不互覆盖、不混入同一 history。
- `GET snapshot`：`setId` 可省略——省略时服务端按 runId 前缀解析所属集（`feat-A018-` → events，否则 standard），保证老前端（无 setId）行为不变；`runId` 不存在 → `404`。

## 4. 组判分快照 JSON 顶层与字段（judge=group）

落盘：`{resultsDir}/feat-A018-YYYY-MM-DD-HHMMSS.json` 及同名 `-summary.md`。JSON 顶层 `{ summary, results }`（与 A015 同信封，readSnapshot / GET latest / history / snapshot 通用）。

### summary

| 字段 | 类型 | 说明 |
|---|---|---|
| `runId` / `time` | string | runId；`time` = 运行完成 ISO 时间 |
| `setId` / `setName` / `judge` | string | 注册表原值；`judge` 恒 `'group'` |
| `benchmark` | string | 评测集文件路径 |
| `evalSetMeta` | object | 评测集 JSON 自带 `meta`（schemaVersion / generatedAt / source 等，溯源 norm 版本） |
| `engine` | object | `{ sango, indexN, inferLimit: 50 }` |
| `total` | number | 题数 |
| `hit5` / `hit10` / `hit50` / `miss` | number | 组内首段分别进 1-5 / 6-10 / 11-50 / 未进池（=0） |
| `noBridge` | number | 桥未命中题数（`bridgeHit=false`） |
| `missNoBridge` | number | 未进池且桥未命中（归因：桥未命中） |
| `dropped` | number | 未进池但桥已命中（归因：并池后掉窗） |
| `sumHits5` / `sumCap5` | number | cover@5 分子 / 分母累计 |
| `hit10Rate` | number | `hit10 / total`（0-1） |
| `cover5` | number | `sumHits5 / sumCap5`（0-1） |
| `byCategory` | object | `{ L1 / L2 / 典故: { 同上计数 } }` |
| `byBucket` | object | `{ 单段 / 多段(2-10) / 大组(>10): { 同上计数 } }`（按 segCount 分档） |
| `compare` | object \| null | 与上一份该集快照逐题比环：`{ prevFile, prevTime, regressed[], improved[] }`；`prevFile` = 上一份快照 runId（与 `/history` 的 runId 对应，供页面定位基准快照）；每项 `{ id, question, from:'<status>@<firstRank>', to }`；无上一份 → `null` |
| `elapsedMs` | number | 服务端计时（毫秒；run 开始 → 逐题检索判分结束，不含落盘与 HTTP 传输） |

### results[]（单题）

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | string | 题 id（`L1#E00101` / `L2#…` / `典故#AL…`） |
| `question` | string | 题面 |
| `category` | string | `L1` / `L2` / `典故` |
| `segCount` / `crossChapter` | number / boolean | 组内段数 / 跨回 |
| `status` | `'hit5'` \| `'hit10'` \| `'hit50'` \| `'miss'` | 组内首段分档 |
| `firstRank` | number | 组内段最小排名（0 = 未进 50 路池） |
| `hits5` / `hits10` | number | top5 / top10 命中组内段数 |
| `hit5` / `hit10` / `hit50` | boolean | 组命中标志（firstRank 落在各档） |
| `bridgeGroups` | number | 事件 / 典故名桥命中组数（`eventHit.groupCount + allusionHit.groupCount`） |
| `bridgeHit` | boolean | `bridgeGroups > 0` |
| `chunkIds` | string[] | 该题判分组（评测集原值，页面可展示组内段） |
| `top10Ids` | string[] | 池内前 10 候选 chunkId（= `poolIds` 前 10） |
| `poolIds` | string[] | 50 路池有序 chunkId（下标 +1 = 池内名次）；「原文」弹框据此展示组内段在池中的位置；老快照缺此字段 → 页面降级只列 `top10Ids` |

### summary.md（组集）

沿用探针 summary.md 模板：引擎 / 判分口径头 + 总分档表（byBucket）+ 合计（hit@5 / 10 / 50、未进池、桥未命中 / 掉窗、hit@10 通过率、cover@5）+ 桥命中行 + 分类别表 + 环比 + 未进 50 路池列表。

## 5. 组判分口径（与探针一致，禁止分叉）

- 判分单位 = 该题 `chunkIds` 组。
- `hit@k` = top-k（1 起）含组内任一段（组内首段进 top-k 即计）。
- `firstRank` = 组内段最小排名；0 = 未进返回窗口。
- `cover@5` = top5 命中组内段数 / `min(5, segCount)`；汇总 = `Σhits5 / Σmin(5, segCount)`。
- `status` = `hit5`（1-5）/ `hit10`（6-10）/ `hit50`（11-50）/ `miss`（0）。
- `bridgeHit` = `search()` 诊断 `eventHit.groupCount + allusionHit.groupCount > 0`；未进池按 bridgeHit 分「桥未命中（missNoBridge）」与「并池后掉窗（dropped）」两类计数。
- 检索：逐题 `index.search(question, 50, { diagnostics: true })`；零 LLM。
- 主判据：`cover@5` + 未进池（含桥命中率分列）；`hit@10` 作「不得下降」红线。

## 6. 与 A015 契约的关系与兼容口径

- 兼容：无 `setId` 的 `POST run` / `latest` / `history` / `snapshot` 语义与 A015 一致（标准集、`feat-A015` runId、老快照可读）；`POST run` 的 202 响应新增 `data.setId` 为超集字段，不破坏老调用方。
- 老快照与新字段互相兼容：锚集 summary 无 `setId` / `judge` / `evalSetMeta` / `byBucket` 等组集字段；组集 summary 恒含 `judge:'group'` + `setId`。前端判定快照所属集：按 runId 前缀（`feat-A018-` → 组集）或下拉选中集上下文；缺字段一律显示「—」。
- 判定逻辑单一来源：锚 = `runner.ts`（A015），组 = `group-runner.ts`（A018），快照读写共用 `snapshot.ts`。
- 探针为组判分口径参考实现；sango `group-runner.ts` 与探针同口径（仅快照信封按本文 §4，探针不改）。

## 7. 前端映射要点（mcp-web，小叶）

- 评测集下拉：`GET /dev/benchmark/sets` → id / name / judge；选中后本次页面上下文带 `setId`。
- 执行：`POST run` body `{ setId }`；`run-status` 轮询（沿用 A015）；下拉切换集时 history / latest 带 `setId` 重拉。
- 汇总：`judge=anchor` 沿用 A015 汇总；`judge=group` 读 summary 的 `hit5 / hit10 / hit50 / miss`、`cover5`、`hit10Rate`、`noBridge`、`missNoBridge`、`dropped`、`byCategory`、`byBucket`；主判据列 cover@5 与未进池（桥命中率分列），hit@10 作红线。
- 明细：组集行展示 question / category / status / firstRank / hits5 / hits10 / cover（单题可算 `hits5 / min(5, segCount)`）/ bridgeHit；「原文」列点「查看」开弹框：按 `poolIds` 列出池内有序列表（名次 + 回目 + 片段，组内段高亮），点行 → SangoChapterReader（沿用 A015 chunkId 解析口径）；老快照缺 `poolIds` 只列 `top10Ids`。
- 历史环比：复用既有比较弹框（bug-00047）；组集比较字段用 `status@firstRank`（只比较题量一致的快照）。
- 缺字段兜底：老快照 / 异集快照缺失字段一律显示「—」。
- 路由 / 代理沿用 A015 §5（`/sango-bench`）。

## 8. 边界（不做）

- 不做检索 / 切片 / 重排 / 事件桥改动；不做 LLM 判定；不做进度百分比；不改评测集文件与探针脚本。
- 不做评测集动态注册（注册表为代码内定义 + env 覆盖路径）。

## 9. 联调运行

```powershell
cd D:\workplace\mcp-server\sango
npm run dev   # 构建 + SANGO_DEV_HTTP_PORT=8787 + node dist/index.js（加载语料 + 向量约 12 秒）
# 验证：GET /dev/benchmark/sets 看两集；先后 POST run（缺省 + { "setId": "events" }）跑两集，页面下拉切换核对
```
