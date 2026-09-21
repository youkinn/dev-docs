# feat-A009: 检索诊断（召回可解释）—— 接口文档

> 作者：老陈
> 对应特性号：feat-A009
> 故事号：story-A009-02
> 涉及项目：mcp-orchestrator（transport.ts / storage/logs.ts / agent 作答路径）、mcp-server（sango：检索诊断产出）、mcp-web（小叶对接：日志详情面板）
> 日期：2026-09-21
> 前置：feat-A004（sango RAG / `sango_novel_search` 出参）、feat-A006（citations 形状）、feat-A007（链路日志：主表 / `tool_call_logs` / 查询接口）
> 修订（2026-09-21 Coco 审查）：§1.3 与验收 7 的 `candidates` 排序口径明确为「最终返回序（死亡意图置顶优先，组内 `finalScore` 降序）」；文末「待落实细节」回填实现落地口径。

## 概述

给 sango 检索链路加「召回可解释」诊断：总台在 `transport.callTool` 转发 `tools/call` 时向请求 `params._meta` 注入 `traceId`（SDK 1.30.0 已验可行）；sango 检索工具返回时在 `result._meta.diagnostics` 回传结构化诊断（召回漏斗数字 / 候选分数表 / query 处理链 / 环境与降级 / 死亡意图）；总台在落 `result_summary` 前剥离诊断、回填「注入视图 / 被引用」口径后单独落新表 `tool_retrieval_logs`；`GET /api/v1/logs/:traceId` 的工具明细增 `diagnostics` 字段暴露。**`content` 出参契约不变，诊断全程不进模型上下文。**

诊断面向两个基准：
- 基准 1（结果对不对）：给定 traceId 能看出参全貌（不被 8000 截断）、条数 / 耗时 / 状态、top-N 是否命中答案段、第 N+1 名差多少分、answer 与 citations 是否与召回自洽。
- 基准 2（原因可解释）：召回漏斗每级数字可核、候选分数表逐条可读、能说出某条被哪一路顶上来 / 为什么没进 top-N、query 处理链可见、环境与降级可见。

## 一、MCP 请求与响应契约

### 1.1 `tools/call` 请求：`params._meta.traceId` 透传

总台 `transport.callTool`（`mcp-orchestrator/src/transport.ts`）在向 MCP server 转发 `tools/call` 前，统一向请求 `params` 注入 `_meta.traceId`（对**所有**工具调用注入，weather / fengyunsanguo 等忽略该字段，协议允许未知 `_meta` 键）。

| 字段 | 类型 | 说明 |
|------|------|------|
| `params._meta.traceId` | string | 当前 HTTP 请求上下文 traceId（前端 `X-Trace-Id` 或服务端兜底值）；上下文缺失时不注入 |

**请求示例（总台 → sango）：**

```json
{
  "jsonrpc": "2.0",
  "id": 3,
  "method": "tools/call",
  "params": {
    "name": "sango_novel_search",
    "arguments": { "source": "sanguo-yanyi", "query": "关羽千里走单骑的经过", "limit": 10 },
    "_meta": { "traceId": "dc1b7b5b-2db8-4288-ba06-f4711e0b7a30" }
  }
}
```

sango 侧取用：MCP SDK 1.30.0 工具 handler 第二参 `extra._meta.traceId`（已验证可行）。**收到 `_meta.traceId` 才产出诊断**；未收到（理论不出现）则照常返回、不产诊断。

### 1.2 `tools/call` 响应：`result._meta.diagnostics` 诊断回传

sango 检索工具（`sango_novel_search`）成功时，在响应 `result._meta.diagnostics` 回传诊断；`content` 形状与 A004 契约**完全不变**（结构化条目数组的 JSON 字符串，文本照常）。非检索工具 / 工具失败（`isError`）/ 未收到 traceId → 不携带 `_meta.diagnostics`。

**响应示例（sango → 总台）：**

```json
{
  "jsonrpc": "2.0",
  "id": 3,
  "result": {
    "content": [
      { "type": "text", "text": "[{\"id\":\"sanguo-yanyi:0073:c0007\",\"text\":\"…\",\"chapter\":73,\"title\":\"玄德进位汉中王　云长攻拔襄阳郡\",…}]" }
    ],
    "_meta": {
      "diagnostics": {
        "truncated": false,
        "truncatedCount": 0,
        "query": {
          "raw": "关羽千里走单骑的经过",
          "normalized": "关羽 千里走单骑 经过",
          "tokens": ["关羽", "千里", "走单骑", "经过"]
        },
        "env": {
          "vectorScheme": "bge-m3",
          "degradedBm25Only": false,
          "corpusChunks": 2344,
          "aliasCount": 87,
          "vectorDim": 1024
        },
        "funnel": {
          "corpusChunks": 2344,
          "lexicalHits": 42,
          "vectorTop50": 50,
          "labelHits": 3,
          "mergedCandidates": 45,
          "topN": 10,
          "injected": null,
          "cited": null
        },
        "candidates": [
          {
            "rank": 1,
            "chunkId": "sanguo-yanyi:0073:c0007",
            "chapter": 73,
            "title": "玄德进位汉中王　云长攻拔襄阳郡",
            "bm25": 12.34,
            "bm25Norm": 0.8,
            "cosine": 0.8,
            "labelHit": true,
            "hitLabels": ["人物之死-关羽之死", "结盟/外交-满宠使吴"],
            "finalScore": 0.88,
            "sources": ["lexical", "vector", "label"],
            "injected": null,
            "cited": null
          }
        ],
        "nextRank": {
          "rank": 11,
          "chunkId": "sanguo-yanyi:0074:c0012",
          "chapter": 74,
          "title": "庞令明抬榇决死战　关云长放水淹七军",
          "bm25": null,
          "bm25Norm": null,
          "cosine": 0.7,
          "labelHit": false,
          "hitLabels": [],
          "finalScore": 0.51,
          "sources": ["vector"],
          "injected": null,
          "cited": null,
          "gapToTopN": 0.19
        },
        "deathIntent": {
          "detected": false,
          "pinned": false,
          "chunkIds": []
        }
      }
    }
  }
}
```

### 1.3 诊断字段口径（全表）

**载荷顶层：**

| 字段 | 类型 | 说明 |
|------|------|------|
| `truncated` | boolean | 64 KB 预算截断标记（§5） |
| `truncatedCount` | number | 截断丢弃的候选条数；未截断恒 0 |
| `query` | object | query 处理链（基准 2-④） |
| `env` | object | 环境与降级（基准 2-⑤） |
| `funnel` | object | 召回漏斗各阶段数字（基准 2-①） |
| `candidates` | array | 候选分数表，按**最终返回序**（死亡意图置顶优先，组内按 `finalScore` 降序；与工具出参、`rank` 同序），**≤20 条**（基准 2-②） |
| `nextRank` | object \| null | 第 N+1 名（未进 top-N），候选不足为 null（基准 1-④） |
| `deathIntent` | object | 死亡意图判定与置顶（基准 2-⑤） |

**`query`：**

| 字段 | 类型 | 说明 |
|------|------|------|
| `raw` | string | 工具入参 `query` 原文 |
| `normalized` | string | alias 归一化后文本 |
| `tokens` | string[] | 分词 tokens |

**`env`：**

| 字段 | 类型 | 说明 |
|------|------|------|
| `vectorScheme` | string \| null | 向量 scheme（BGE-M3 构建头 `scheme=1`）；向量未加载为 null |
| `degradedBm25Only` | boolean | true = 本次检索降级纯 BM25（权重缺失 / 推理失败，静默降级） |
| `corpusChunks` | number | 语料 chunk 总数 N |
| `aliasCount` | number | alias 条数 |
| `vectorDim` | number \| null | 向量维度；降级为 null |

**`funnel`（各阶段数字，基准 2-①）：**

| 字段 | 类型 | 说明 |
|------|------|------|
| `corpusChunks` | number | 语料 N chunk（= env.corpusChunks，漏斗起点） |
| `lexicalHits` | number | 词法命中 x |
| `vectorTop50` | number | 向量路 top50 条数；降级为 0 |
| `labelHits` | number | 标签命中 y |
| `mergedCandidates` | number | 合并去重后候选数 z |
| `topN` | number | 最终返回条数（= 工具出参条数，≤ limit） |
| `injected` | number \| null | 进注入视图条数；sango 产出阶段为 null，总台回填（§3.2） |
| `cited` | number \| null | 被引用条数（去重后 chunk 计数）；同上 |

**`candidates[]` / `nextRank`（分数表，基准 2-②）：**

| 字段 | 类型 | 说明 |
|------|------|------|
| `rank` | number | 排名（1 起） |
| `chunkId` | string | chunk 唯一 ID（如 `sanguo-yanyi:0073:c0007`） |
| `chapter` | number | 回号 |
| `title` | string | 回目 |
| `bm25` | number \| null | 原始 BM25 分（round3，仅调试用）；词法未命中为 null |
| `bm25Norm` | number \| null | BM25 归一化值（词法命中集合内 min-max，全精度，实际参与 0.3 权重）；词法未命中为 null |
| `cosine` | number \| null | 原始向量余弦（全精度，向量路可用时对每条候选都回传，不限于 top-50）；降级纯 BM25 为 null；复算用 `(cosine+1)/2` |
| `labelHit` | boolean | 标签是否命中 |
| `hitLabels` | string[] | **命中了哪个 / 哪些标签**：该 chunk 命中的标签表原始文本（`tags/*.json` 中 `|` 拆分后的单个标签，如 `人物之死-关羽之死`）；未命中为 `[]`；恒满足 `labelHit === (hitLabels.length > 0)`。与 `labelHit` 同判定口径（标签文本与 query 同口径归一化 + 分词，取长度 ≥ 2 的词元求交），只作展示 / 排查用，不参与计分 |
| `finalScore` | number | 最终分（合并排序分） |
| `sources` | string[] | 命中来源子集：`lexical` / `vector` / `label`，说明被哪一路召回 / 顶上来（基准 2-③） |
| `injected` | boolean \| null | 是否进注入视图；总台回填 |
| `cited` | boolean \| null | 是否被引用；总台回填 |
| `gapToTopN` | number | 仅 `nextRank`：与 top-N 最后一名 `finalScore` 的分差，≥0（基准 1-④）。**精度 6 位小数**（不用 3 位口径——真实分差常 < 0.0005，3 位会被四舍五入成 0 而看不出「差多少」）；前端按 4 位小数展示 |

**`deathIntent`：**

| 字段 | 类型 | 说明 |
|------|------|------|
| `detected` | boolean | 是否判定死亡意图 |
| `pinned` | boolean | 是否触发置顶 |
| `chunkIds` | string[] | 被置顶的候选 chunkId；未置顶为 `[]` |

**计分口径（供复算最终分，接口已回传参与计算的两个分量 `bm25Norm` 与 `cosine`）：**

`finalScore` = `0.3 × bm25Norm` + `0.6 × 向量映射` + `0.1 × 标签命中`，三项均在 `[0,1]`，故 `finalScore ∈ [0,1]`。

- 向量映射 = `(cosine + 1) / 2`（余弦 ∈ [-1,1] → [0,1]）；`cosine` = null（降级纯 BM25）→ 该项 0
- `bm25Norm` 由 sango 预先算好（词法命中集合内 min-max：最高分 → 1、最低分 → 0；单条命中恒 1）；`null`（非词法命中）→ 该项 0
- 标签命中 = `labelHit ? 1 : 0`
- 逐条复算：`finalScore = round3(0.3*(bm25Norm ?? 0) + 0.6*(cosine === null ? 0 : (cosine+1)/2) + 0.1*(labelHit ? 1 : 0))`；`bm25Norm` / `cosine` 全精度输出，复算结果与 `finalScore` 严格一致。
- **前端复算展示口径（feat-A009 验收 6b）**：候选表「最终分」列 hover 浮层按上式**代入实际值**展示，代入值取 4 位小数（与列内展示口径一致），乘积与求和用全精度计算，最后显式写出 `round3` 步骤，例如：`0.3 × 1 + 0.6 × 0.811 + 0.1 × 1 = 0.8866 → round3 = 0.887`。`bm25Norm` / `cosine` 为 null 的候选按 `0` 代入并标注原因（非词法命中 / 降级纯 BM25），不得只展示最终数字。

例（trace `60aa5476-6ea1-4d2d-a560-c8287101ab4a` 的 rank 1）：`bm25Norm=1`（原始 BM25=38.979 为该次最高分）、`cosine=0.622` → 向量映射 `(0.622+1)/2 = 0.811` → `0.3×1 + 0.6×0.811 + 0.1×1 = 0.8866` → `round3 = 0.887`。rank 2 这类「不在向量 top-50」的候选，`cosine` 也照常回传（不再为 null）。

**载荷纪律（硬约束 3）：**只放结构化小数据——top20 候选的 `chunkId` + 三路分 + 最终分 + 元数据（回目 / 来源 / 置顶标记），**不放 chunk 文本**。预计正常载荷 < 10 KB，64 KB 预算为安全网（§5）。

## 二、表结构：`tool_retrieval_logs`（新表）

```sql
CREATE TABLE tool_retrieval_logs (
  trace_id     TEXT NOT NULL,
  seq          INTEGER NOT NULL,   -- 与 tool_call_logs.seq 对应（同 trace 内工具调用序号，1 起）
  diagnostics  TEXT NOT NULL,      -- 诊断 JSON（≤64KB 截断后原样落库；含 truncated / truncatedCount 标记）
  created_at   INTEGER NOT NULL,   -- 落库时间，毫秒
  PRIMARY KEY (trace_id, seq),
  FOREIGN KEY (trace_id, seq) REFERENCES tool_call_logs(trace_id, seq) ON DELETE CASCADE
);
CREATE INDEX idx_tool_retrieval_logs_created ON tool_retrieval_logs(created_at);
```

- **关联**：`trace_id + seq` 复合主键 / 复合外键关联 `tool_call_logs`；一次工具调用至多一条诊断行，无诊断则不插行。
- **保留**：沿用 A007 保留策略（`LOG_RETENTION_DAYS`，默认 30 天）；清理以 `request_logs.created_at` 为准，经 `tool_call_logs` 双重级联删除本表，无需独立清理逻辑。
- **内容**：`diagnostics` 为截断后的 JSON 原样存储（含 `truncated` 标记），不拆列、不做派生列（口径见 §3.3）。

## 三、落库与回填口径

### 3.1 `result_summary` 剥离诊断（硬约束 2）

**现状**：`transport.callTool` 用 `summarizeJson(result)` 落 `result_summary`（`mcp-orchestrator/src/transport.ts`，`summarizeJson` 定义于 :12、落库于 :244），序列化**整个 result 含 `_meta`**；若诊断走 `result._meta.diagnostics` 而不剥离，会一并写入并挤掉出参尾部（8000 预算），直接违反基准 1。

**契约（落地口径）**：落 `result_summary` 前剥离 `_meta.diagnostics`——只存 `content` + 非诊断 `_meta`（`_meta` 仅剩空对象时整体置空），剥离后再 `summarizeJson`。诊断单独落新表（§3.3）。

```ts
// transport.callTool 落库前：
const { diagnostics: _dropped, ...restMeta } = result._meta ?? {};
const rest = Object.keys(restMeta).length > 0 ? restMeta : undefined;
const summary = { ...result, _meta: rest };
result_summary = summarizeJson(summary);   // 不含 _meta.diagnostics
```

**实测基线**：trace `dc1b7b5b-2db8-4288-ba06-f4711e0b7a30` 出参 `result_summary` = **7170 字符（未截断）**；剥离诊断后 ≤ 7170，8000 预算不被诊断挤占。

### 3.2 `injected` / `cited` 总台回填

`injected`（注入视图）与 `cited`（被引用）**只有总台知道**：注入视图拼接与 citations 组装都在总台 agent 作答路径（快路径服务端拼接；citations 按 A006 由总台渲染）。sango 在工具返回时点无从得知，故载荷中恒为 null 占位。

**回填口径（总台 agent 收尾，answer 与 citations 确定后）：**

- `funnel.injected` = 实际进入注入视图的候选条数（快路径：top5 整段保底 + 第 6–10 段预算兜底的实际纳入数）；LLM 自主 tool-use 路径无注入视图 → 0。
- `funnel.cited` = 最终 `data.citations` 引用的不同 chunk 数（按 citations 组装时的片段 → 候选映射去重）。
- `candidates[].injected` / `candidates[].cited`：逐条布尔，同一映射。
- 兜底路径（无召回 / 人名校验不过）按实际映射计数：兜底片段若来自某候选则计入 `cited`，未经过注入视图故不计入 `injected`。

### 3.3 落库时序与幂等

- `tool_call_logs` 仍在 `transport.callTool` 返回时落（A007 不变，`result_summary` 已剥离诊断）。
- `tool_retrieval_logs` 在 **agent 作答路径收尾（回填完成后）一次性 INSERT**（同 `trace_id + seq`）。回填 / 落库任一环节失败 → 诊断不落库，查询接口该工具 `diagnostics` 为 null（旁路，§6）。
- 无 UPDATE 语义：同 trace 重复调用工具时 `tool_call_logs.seq` 递增，各自独立诊断行；落库失败不重试（告警即可，避免干扰主流程）。

## 四、查询接口扩展

### GET /api/v1/logs/:traceId —— 明细

- **路由、主表、llmCalls、前端路由均不变**（A007）。
- `toolCalls[]` 每项**新增 `diagnostics` 字段**：object \| null。有诊断行为解析后的诊断对象（含总台回填后的 `injected` / `cited`）；无诊断 / 旁路丢失 / JSON 解析失败 → null（解析失败兜底 null，不炸前端）。
- 与 `resultSummary` 不同：`diagnostics` 返回**解析后的对象**（前端直接读字段），`resultSummary` 仍为原样字符串。

**扩展示例（工具明细项）：**

```json
{
  "seq": 1,
  "mcpServer": "sango",
  "toolName": "sango_novel_search",
  "argsSummary": "{\"source\":\"sanguo-yanyi\",\"query\":\"关羽千里走单骑的经过\",\"limit\":10}",
  "callSentAt": 1789884003200,
  "callReturnedAt": 1789884003800,
  "resultSummary": "[{...A004 结构化条目，不含 _meta...}]",
  "status": "success",
  "errorMessage": "",
  "diagnostics": {
    "truncated": false,
    "truncatedCount": 0,
    "query": { "raw": "关羽千里走单骑的经过", "normalized": "关羽 千里走单骑 经过", "tokens": ["关羽", "千里", "走单骑", "经过"] },
    "env": { "vectorScheme": "bge-m3", "degradedBm25Only": false, "corpusChunks": 2344, "aliasCount": 87, "vectorDim": 1024 },
    "funnel": { "corpusChunks": 2344, "lexicalHits": 42, "vectorTop50": 50, "labelHits": 3, "mergedCandidates": 45, "topN": 10, "injected": 5, "cited": 3 },
    "candidates": [
      { "rank": 1, "chunkId": "sanguo-yanyi:0073:c0007", "chapter": 73, "title": "玄德进位汉中王　云长攻拔襄阳郡", "bm25": 12.34, "cosine": 0.812, "labelHit": true, "finalScore": 0.92, "sources": ["lexical", "vector"], "injected": true, "cited": true }
    ],
    "nextRank": { "rank": 11, "chunkId": "sanguo-yanyi:0074:c0012", "chapter": 74, "title": "庞令明抬榇决死战　关云长放水淹七军", "bm25": 3.10, "cosine": 0.451, "labelHit": false, "finalScore": 0.51, "sources": ["vector"], "injected": false, "cited": false, "gapToTopN": 0.19 },
    "deathIntent": { "detected": false, "pinned": false, "chunkIds": [] }
  }
}
```

**错误响应：**沿用 A007（400 traceId 非法 / 404 不存在 / 500 内部错误），无新增错误码。列表接口 `GET /api/v1/logs` 与 `token-stats` **零改动**（诊断只在明细）。

## 五、截断口径（硬约束 3）

- **预算**：诊断 JSON 序列化后 UTF-8 字节数 ≤ **64 KB**（`Buffer.byteLength`）。
- **截断次序**（按优先级从后往前丢，保住头部关键信息）：① `candidates` 尾部（从 rank 大往小丢，保头部名次）；② `nextRank`；③ `deathIntent.chunkIds`（保留 `detected` / `pinned`）。`query` / `env` / `funnel` 恒保留。
- **标记**：截断后 `truncated=true`、`truncatedCount` = 被丢弃的候选条数；落库原样存截断后的 JSON。
- **正常预期**：top20 候选（无文本、含回目）实测约 5–10 KB，64 KB 是安全网，正常不触发。
- **stdio 上限（10 MB，不可降级）**：MCP stdio `ReadBuffer` 单条 JSON-RPC 消息上限 10 MB，超限**抛错并关闭连接**（协议层硬错误，不是降级路径）。64 KB 预算远低于该上限，保证诊断载荷永不触碰；**未来放宽载荷必须先评审**，禁止无预算放开。

## 六、错误与降级约定（硬约束 4：旁路原则）

诊断产出 / 透传 / 落库任一环节失败，都不得影响 `/api/chat` 主流程与响应：

| 环节 | 失败行为 | 查询接口表现 |
|------|----------|--------------|
| sango 产出诊断 | 不带 `_meta.diagnostics` 返回，`content` 照常（trySafe 告警） | `diagnostics: null` |
| 总台透传 / 回填 | 剥离照常（无诊断可剥即跳过），主流程不变 | `diagnostics: null` |
| 落库失败 | 告警静默，不重试、不阻塞 agent 收尾 | `diagnostics: null` |

- **降级（纯 BM25）**：`env.degradedBm25Only=true`、`vectorScheme` / `vectorDim` / `cosine` 为 null、`funnel.vectorTop50=0`，诊断照常产出（不因降级而不产）。
- **协议层硬错误**：stdio 消息超 10 MB → 抛错关连接（既有行为，非本特性降级路径）；64 KB 预算保证不触发。
- **故障注入验收**：三个环节分别注入失败，`/api/chat` 均正常返回（§8 专项）。

## 七、前端对接（小叶）

路由不变：仍走 `GET /api/v1/logs/:traceId` 行展开。工具明细 `toolCalls[].diagnostics` 为 `object | null`，面板分区与字段口径如下：

| 分区 | 数据来源 | 渲染口径 |
|------|----------|----------|
| 顶部状态条 | `diagnostics.truncated` / `truncatedCount` | `truncated=true` 显示黄条「诊断已截断（64KB），候选显示不全」，附丢弃条数 |
| 召回漏斗 | `diagnostics.funnel` | 流程条：`corpusChunks` → `lexicalHits` \| `vectorTop50` \| `labelHits` → `mergedCandidates` → `topN` → `injected` → `cited`；各阶段数字可直接核对 |
| 候选分数表 | `diagnostics.candidates` | 列：排名 / chunkId / 回目（`chapter`+`title`）/ BM25（null 显「—」）/ 余弦（null 显「—」）/ 标签命中 / 最终分 / 来源（`sources` 标签）/ 注入 / 引用；`rank ≤ funnel.topN` 高亮「进 top-N」。**标签命中列**：命中显「是」（可 hover 展示 `hitLabels` 全部标签，多个逐行）、未命中显「否」；`hitLabels` 缺失（历史 trace 诊断）时不展示 tooltip，不显示 `undefined`。**最终分列**：hover 展示算式代入过程（原样列算式 + 逐项代入 `bm25Norm` / 向量映射值 / 标签命中 → 三个乘积、求和、`round3` 结果），不只给最终数字（验收 6b） |
| 第 N+1 名 | `diagnostics.nextRank` | 独立卡片：chunkId + 回目 + 三路分 + `gapToTopN`（「差 0.19 分未进 top-N」）；`nextRank=null` 隐藏。最终分同 6b 口径（hover 展示算式代入过程） |
| query 处理链 | `diagnostics.query` | `raw` → `normalized` → `tokens`（chip 展示） |
| 环境与降级 | `diagnostics.env` | scheme / chunk 数 / alias 条数 / dim；`degradedBm25Only=true` 红色告警「已降级纯 BM25」 |
| 死亡意图 | `diagnostics.deathIntent` | `detected && pinned` 提示置顶 chunkId 列表 |
| 自洽提示（前端现算） | `data.log.citations` + `diagnostics` | citations 数组条数 vs `funnel.cited` 不一致 → 黄条「引用与召回不自洽」；被引用候选（`cited=true`）不在 top-N → 红条提示。深度自洽（answer 人名校验等）由服务端既有引用硬校验负责，面板只呈现 |
| 无诊断 | `diagnostics === null` | 显示「该调用无检索诊断」（非检索工具 / 未透传 / 旁路丢失） |

`diagnostics` 恒为对象或 null，字段齐全性由 sango 保证；前端不做字段缺省兜底渲染（除 null / 三路分 null 显「—」）。

## 八、接口侧验收清单（覆盖需求 13 条）

### 需求验收（13 条）

| # | 验收点（对应需求条目） | 通过标准 |
|---|------------------------|----------|
| 1 | 基准 1 · 出参全貌 | 复现带诊断请求：`result_summary` 含完整出参且不被 8000 截断（剥离后 ≤ 7170 基线字符）；对照注入诊断不剥离的故障场景，出参尾部被截断 |
| 2 | 基准 1 · 条数 / 耗时 / 状态 | 明细接口主表 + llmCalls + toolCalls 条数、时间点、状态与 A007 一致，新增 `diagnostics` 不改变既有字段 |
| 3 | 基准 1 · top-N 命中答案段 | `candidates` 中被 `cited=true` 的候选 `rank ≤ funnel.topN` 且 `injected=true`（答案段命中 top-N 可判） |
| 4 | 基准 1 · 第 N+1 名 | `nextRank` 存在、`rank = topN + 1`、`gapToTopN` = 与 top-N 最后一名 `finalScore` 的分差（≥0）；候选不足时为 null |
| 5 | 基准 1 · answer 与 citations 自洽 | `funnel.cited` = citations 去重后 chunk 数；citations 引用的候选均 `injected=true`（服务端引用硬校验既有逻辑不变） |
| 6 | 基准 2 · ① 漏斗数字可核 | `funnel` 各字段有值且满足管道约束：`mergedCandidates ≤ lexicalHits + vectorTop50 + labelHits`（去重后）、`topN ≤ mergedCandidates`、`injected ≤ topN`、`cited ≤ injected`（兜底路径按 §3.2 口径） |
| 7 | 基准 2 · ② 分数表 | `candidates` 每条含 rank / chunkId / chapter / title / bm25 / bm25Norm / cosine / labelHit / hitLabels / finalScore / sources / injected / cited；`labelHit === (hitLabels.length > 0)`；按最终返回序（死亡意图置顶优先，组内 `finalScore` 降序，与工具出参同序）、≤20 条 |
| 8 | 基准 2 · ③ 顶上来 / 未进 top-N 原因 | `sources` 能说明每条被哪一路召回；`nextRank.gapToTopN` 说明第 N+1 名差多少分 |
| 9 | 基准 2 · ④ query 处理链 | `query.raw` = 工具入参；`normalized` / `tokens` 与 sango 实际 alias 归一化、分词结果一致（抽 1 例人工核对） |
| 10 | 基准 2 · ⑤ 环境与降级 | `env.vectorScheme` / `corpusChunks` / `aliasCount` / `vectorDim` 与 sango 实际加载一致；`deathIntent` 字段齐全；降级场景 `degradedBm25Only=true` 且 `cosine` / `vectorDim` 为 null |
| 11 | traceId 透传 | `tools/call` 请求 `params._meta.traceId` 恒注入且与 HTTP `X-Trace-Id` 一致；sango 经 `extra._meta` 取到并据此产出诊断（对照无 traceId 不产诊断） |
| 12 | 诊断回传 + 模型不可见 | `result._meta.diagnostics` 返回且 `content` 契约与 A004 完全一致；LLM 明细 `request_summary` 不含诊断内容；模型输出行为与未加诊断时一致（硬约束 1） |
| 13 | 新表 + 查询接口 | `tool_retrieval_logs` 落库（`trace_id + seq`，复合 FK）；明细接口 `toolCalls[].diagnostics` 返回回填后的完整对象；非检索工具 / 旁路丢失 → null；列表接口与前端路由零改动 |

### 硬约束专项（4 条）

| 约束 | 验收点 |
|------|--------|
| 1 · 不进模型上下文 | 工具出参 `content` 不变；LLM 消息与 `request_summary` 均不含诊断；回归 A004 契约测试全绿 |
| 2 · 8000 预算不挤占 | trace `dc1b7b5b-2db8-4288-ba06-f4711e0b7a30` 重放：`result_summary` ≤ 7170 且不截断；构造大出参 + 大诊断，`result_summary` 仍完整 |
| 3 · 64 KB 限流 | 构造超限诊断：`truncated=true` + `truncatedCount>0`、头部字段保留、JSON 合法；消息体积 < 10 MB，stdio 连接不中断 |
| 4 · 旁路原则 | 故障注入三环节（产出 / 透传 / 落库）分别抛错：`/api/chat` 均正常返回、错误码与 message 与无诊断时一致 |

## 九、风险 & 开放问题落实（回填需求）

1. **`result._meta` 协议兼容性**：SDK 1.30.0 已验——请求 `params._meta` 可注入、handler 第二参 `extra._meta` 可取、响应 `result._meta` 随结果返回。结论：契约可行，无需协议层改动。
2. **诊断是否挤占 `result_summary` 8000 预算**：剥离后再序列化（§3.1），基线 7170 不增；诊断单独落 `tool_retrieval_logs`。结论：硬约束 2 落实。
3. **诊断是否进模型上下文**：`content` 契约不变 + 总台回灌 LLM 仅取 `content` 并剥离 `_meta`。结论：硬约束 1 落实（agent 侧在把工具结果拼入 LLM 消息时显式剥离 `result._meta`）。
4. **stdio 10 MB 上限**：64 KB 预算 << 10 MB；10 MB 超限为协议硬错误（抛错关连接，不可降级），故诊断必须守在 64 KB 内。结论：硬约束 3 落实。
5. **`injected` / `cited` 归属**：sango 在工具返回时点无法知道注入视图与 citations 结果（总台 agent 路径产物）→ 契约定为 sango 置 null 占位、总台收尾回填后落库。结论：见 §3.2；**回填失败则诊断不落库（查询 null），不做降级回填**。
6. **死亡意图判定规则**：契约只定形状（`detected` / `pinned` / `chunkIds`）；判定阈值与置顶策略属 sango 检索逻辑，实现时定稿，若涉及业务口径需与 Coco 对齐后再定（见「需拍板项」）。
7. **citations 无 chunkId 字段（A006 形状 `{text, chapter, title}`）**：`cited` 判定不依赖逐条文本比对，走总台组装 citations 时的「片段 → 候选」映射（服务端内部已知），前端不自算深度自洽（§7 自洽提示口径）。

## 待落实细节（2026-09-21 审查回填：实现落地口径）

- [x] 死亡意图判定规则（已落地）：判定与置顶沿用 feat-A004 既有逻辑（`matchDeathIntent` 问法分类 + 人名词典强命中置顶；不改分数、只改排序两级）；诊断只暴露 `detected` / `pinned` / `chunkIds`（= 实际置顶且仍在合并候选内的 chunkId），不暴露触发词与阈值 —— 与负责人 2026-09-21 拍板一致。
- [x] 兜底路径 `cited` / `injected` 计数口径（已落地，按 §3.2）：兜底选中片段（`pickBestFallbackFragment`）能映射到候选则计入 `cited`；未经注入视图故不计 `injected`。
- [x] LLM 自主 tool-use 路径 `injected=0`（已落地）：`injected` 只统计快路径确定性注入的片段，tool-use 片段计入 `cited`；citations 仍由总台渲染。
- [x] `createLogStore` 增量（已落地）：`appendRetrievalLog(trace_id, seq, diagnostics)` 写入 + 明细查询回填 `toolCalls[].diagnostics`（无诊断行 / JSON 解析失败 → null）。
- [ ] 混跑场景（快路径注入后又触发 LLM tool-use 复调检索）`injected` / `cited` 归属口径：实现按「`injected` 只计快路径片段、tool-use 片段计 `cited`」执行；**待负责人给一条混跑 trace 人工核对后定稿**（随本次验收一并核对）。
