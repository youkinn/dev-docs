# feat-A013: 三国演义问答缓存 —— 接口文档

> 作者：老陈
> 对应特性号：feat-A013
> 故事号：story-A013-02
> 涉及项目：mcp-orchestrator（缓存层 / 总台 / agent 接入）、mcp-web（小叶对接）、mcp-server（新增 1 个内部工具，见 §1.7）
> 日期：2026-09-23
> 前置：feat-A004（sango RAG / BGE-M3 离线 embedding）、feat-A006（citations 形状）、feat-A009（诊断 / 明细接口 / 最终分可解释先例）、feat-A012（日志字段扩展与迁移先例）、bug-00022（语义判定同族风险）

## 概述

应用层 query→answer 语义缓存，仅 `sango-novel` 域生效：同一 / 等价问题二次提问**命中缓存直接返回首次的最终答案对象**（`{ answer, citations }`，ChatData 契约），0 次 LLM 调用、0 次检索调用。未命中分两档走原链路：低相似（< 0.80）走完整 LLM 后**写缓存入池**（池子唯一增长入口）；灰色区（0.80 ≤ 相似度 < 命中线）走完整 LLM 后**不写缓存**，只落 `cache_logs`「差点命中谁」，为命中线调整供数。

后台提供：开关（一键启停，立即生效）、全量清除 / 单条删除（立即生效）、缓存概览（条目数 + 答案序列化字节合计，口径可复算）、条目明细、命中解释（对齐 A009 最终分展示口径）、三色分布图表（x 相似度 / y 请求数，桶宽 0.02 由本文档定）、灰色区 query 对明细、误判标记与误判率。

`/api/chat` 请求 / 响应形状零变更（命中时 `data` 就是缓存里的 ChatData）；前端展示零改动（命中解释在日志明细页新增卡片）。

### 核心口径（实现时逐条照做）

- **无字符串 key。** 缓存判定键 = query 语义相似度（embedding 全扫，条目规模 ≤ 1000 为毫秒级）；条目唯一标识 = 自增 `id`。原句 / 等价问法靠 cosine=1.0 附近恒命中，不做文本 hash 精确匹配。
- **相似度分区（边界口径，默认命中线 0.92）**：高置信命中 ≥ 命中线；灰色区 [0.80, 命中线)；低相似 < 0.80。**0.80 下沿本期固定写死、不对外配置**（参考 bug-00022 风云三国实测不相关 0.716 留余量；调整另立课题），命中线 `CACHE_HIT_LINE`（env，默认 `0.92`）为唯一可配置阈值。
- **命中判定两层防御（bug-00022 同族）**：① 歧义不命中——≥ 命中线的条目数 ≥ 2 即不命中；② 问点 / 疑问焦点一致性轻校验——双方都有焦点且焦点类不相交则不命中（规则见 §1.2.1）。
- **写缓存唯一入口**：低相似未命中走完 LLM 且答案非拒答类；命中不写、灰色区不写、歧义 / 焦点防御拒绝不写（防近似重复条目污染池子与歧义判定）、拒答类（`演义中未涉及`）不写（防错误拒答固化）。
- **命中解释 / 图表 / 误判率全部以 `cache_logs` 为数据源**；区间归类由 `similarity` + `hit` 派生，不新增枚举列；命中线变化只改图表着色分界与灰色区口径上沿，不改聚合逻辑。
- **桶宽 0.02**（50 桶）：0.80 = 40 × 0.02、0.92 = 46 × 0.02，**三色分界（0.80 / 命中线 0.92）恰好是桶边界**，着色不跨桶；0.01 桶宽 100 桶过密且低相似区绝大多数桶为空。
- **内部调用三不原则**：语义判定用的内部工具调用不落 `tool_call_logs`、不注入 `_meta.traceId`、不进模型可见白名单（§1.7.2）。
- **cache 相关写全部同步直写**（不经 A007 的 1 秒 / 50 条写缓冲），保证后台概览 / 删除 / 图表与内存、池子**强一致对账**；写频率 = 请求频率，better-sqlite3 同步事务开销可接受。

## 一、缓存层契约

### 1.1 条目结构（进程内 LRU）

池子 = 进程内 LRU（队首 = 最近使用端），**新写入与命中条目均放队首，淘汰从队尾逐出**（需求口径）。单条条目：

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | number | 自增主键（与 `cache_entries.id` 同值，内存与表一一对应） |
| `queryText` | string | 用户输入原文（trim 后） |
| `embedding` | Float32Array(1024) | BGE-M3 query 向量（L2 归一化，与 A004 检索同空间） |
| `answerObject` | ChatData | 服务端渲染后的最终答案对象 `{ answer, citations }`，**不含诊断 / 过程数据** |
| `answerBytes` | number | `Buffer.byteLength(JSON.stringify(answerObject), 'utf8')`，写入时算好（概览口径依据） |
| `hitCount` | number | 命中次数（命中计数接入点） |
| `lastAccessAt` | number | 最后访问（命中 / 写入）时间 epoch ms；命中 / 写入即更新并移队首 |
| `createdAt` | number | 写入时间 epoch ms |
| `versionTag` | string | 答案产物版本（§1.6） |

内存镜像落 `cache_entries` 表（§2.1）；**进程重启缓存清空**：启动时 `DELETE FROM cache_entries`（防镜像残留展示陈旧数据），不做持久化恢复（非目标）。

### 1.2 命中判定流程

仅 `route` 判定为 `sango-novel` 的请求进入（L1 标签 / L2 关键词 / 分类轮 1 均算；`fengyunsanguo`、auto 自由问答、随机一题不进入）。判定点：`src/agent.ts` `processQueryData` 路由判定完成之后、检索预调（`resolveUserContent`）之前。

```
0. 开关检查：cacheEnabled == false → 旁路：不查、不写、不落 cache_logs（数据断档可接受，需求口径），走原链路
1. embedding 获取（异步，唯一 await 点）：
   调 sango_query_embed(query) → vec
   失败（权重缺失 / 推理失败 / 通道异常）→ 降级旁路：不查、不写、不落 cache_logs，
   等同开关关闭，console.warn 一次，行为与验收 8 的关闭态一致
2. 同步判定段（内存 LRU，无 await；与后台清除 / 删除 / 开关 API 的执行序见 §1.8）：
   a. 池空 → 未命中（低相似档，similarity=null, nearestQuery=null, tieHits=null）
   b. 非空 → 逐条算 cosine(vec, entry.embedding)，取最高 similarity 与对应条目
      b1. 候选 = similarity ≥ hitLine 的条目；候选数 ≥ 2 → 未命中（歧义，reason=miss-tie，
          nearestQuery = 候选第一条（扫描序），tieHits = 候选数）
      b2. 候选数 == 1 → 焦点一致性轻校验（query vs 候选.queryText，§1.2.1）
          不一致 → 未命中（reason=miss-focus，similarity / nearestQuery 照记，tieHits=1）
          一致 → 命中：返回候选.answerObject 深拷贝；hitCount+1、lastAccessAt 刷新、移队首
3. 落 cache_logs：命中与未命中一律一行（旁路静默，失败不影响主流程），§2.2
4. 未命中 → 走原链路（检索 + LLM + 引用校验 guard），agent 拿到最终 ChatData 后调
   cache.record(...)（§1.4 写缓存决策，内部判定，agent 无感知细节）
```

`cosine` 用全精度计算、落库与回传按 **4 位小数**（`Math.round(x * 10000) / 10000`，A009 展示口径同款）；cosine=1.0 恒命中（原句重复提问不受命中线影响）。

**判定前归一化（字号/别称 → 本名）**：查询进入判定链路前，将三国人物字号/别称统一替换为本名（表驱动、长词优先，如 云长/关云长→关羽）；只作用于 embedding、cosine 比对与焦点校验，`cache_logs.user_query` 与缓存条目 `queryText`（nearestQuery）仍存原始文本（实现见编排侧 cache.ts `normalizePersonNames`）。

#### 1.2.1 焦点一致性轻校验（问点防御，规则定稿）

纯字符串包含匹配（本地执行，无 LLM、无工具调用、无 embedding）。焦点词表分两类（**词表为文档常量，实现照抄；按词条长度降序匹配，命中即停，一个 query 可命中多类**）：

| 焦点类 | 词条（越长越优先） |
|--------|--------------------|
| `chapter`（求回目 / 数字） | 是哪一回、第几回、哪一回、哪一回目、第多少回、多少回、回目、第几章、哪章、下一回、上一回、这一回、那一回 |
| `process`（求经过 / 过程） | 是怎么回事、经过、过程、为什么、为何、怎么样、怎样、怎么、如何、缘由、原因、结局、下场、然后、后来 |

判定规则：
- 提取 `F(A)`、`F(B)` = 各自命中的焦点类集合（可为空）。
- **拒判条件**：`F(A)` 非空 且 `F(B)` 非空 且 `F(A) ∩ F(B) == ∅` → 不命中（reason=miss-focus）。
- 单边无焦点（如「义释严颜是怎么回事」vs「严颜被义释」）→ 放行，靠相似度阈值判定。

示例（需求验收 2 / 3 用例照此推导）：

| query A | query B | F(A) ∩ F(B) | 结果 |
|---------|---------|-------------|------|
| 义释严颜是怎么回事 | 严颜是怎么被义释的 | {process} | 放行 → 相似度 ≥ 0.92 命中 |
| 严颜被义释是哪一回 | 义释严颜的经过 | ∅（{chapter} vs {process}） | 拒判不命中 |

焦点校验只作用于「唯一候选 ≥ 命中线」时（防御层 ②）；命中线以下的拒绝由阈值本身完成。

### 1.3 命中线 / 分区（默认 0.92，后台可调）

- `CACHE_HIT_LINE`（env，默认 `"0.92"`）为启动初始值；命中线支持后台运行时调整（`PUT /api/v1/cache/hit-line`，见 §3.2）：调整立即生效于后续判定与图表着色上沿；**运行时值不持久化**（重启回 `CACHE_HIT_LINE` 初始值），但每次调整落一条修改记录到 `cache_hit_line_changes`（§2.5，跨重启保留），概览 `lastHitLineChange`（§3.6）可取最近一条。
- 灰色区 = `0.80 ≤ similarity < hitLine`（默认即 [0.80, 0.92)）；图表三色 = 低相似 < 0.80 / 灰色区 / 高置信 ≥ hitLine，**着色分界 = 0.80 固定 + hitLine 变量**。
- 每条 `cache_logs` 落 `hit_line`（本次请求生效值），历史行解释不随配置漂移。

### 1.4 写缓存（唯一入池口）

`src/cache.ts` 的 `record(query, traceId, lookupInfo, data)`，由 agent 在最终 ChatData 就绪后调用一次，**内部判定**：

| 条件 | 动作 |
|------|------|
| 低相似未命中（最高相似度 < 0.80，含池空） | 写缓存（入队首 + INSERT 镜像 + 触发淘汰 §1.5） |
| 拒答类：`data.answer === NOVEL_NO_HIT_ANSWER` 且 `data.citations.length === 0` | **不写**（防错误拒答固化） |
| 灰色区（0.80 ≤ sim < hitLine） | **不写**（纯记录带） |
| 歧义（miss-tie）/ 焦点拒判（miss-focus） | **不写**（防污染池子与歧义判定） |
| reason=hit | 不写（条目已在池中，lookup 已计数） |

### 1.5 LRU 淘汰与上限（默认 500 条）

- `CACHE_MAX_ENTRIES`（env，默认 `"500"`）：命中 / 写入后若条目数 > 上限，从队尾（最久未用端）**逐出直至不超限**（逐出 = 内存删 + `DELETE FROM cache_entries`）。
- 校准公式（按实测答案体积，需求口径）：目标内存预算 `M`（如 20 MB）→ `maxEntries ≤ (M - 结构常数) / (avgAnswerBytes + 4 × 1024 + 256)`，其中 `avgAnswerBytes` 来自概览接口（§3.6），结构常数 = 每条约 256 B；实测读数后由负责人改 env 重启。**默认取 500（保守起步），实测后上调至 ≤ 1000。**
- LRU 顺序 = 内存链表，不依赖 `last_access_at` 列（列仅作概览展示与对账）。

### 1.6 开关 / 清除 / 删除 / 版本失效 / 降级

全部操作**立即生效**（内存与表同事务完成，事件循环内原子）：

| 操作 | 语义 |
|------|------|
| 开关 | 进程内状态，启动默认开（`CACHE_ENABLED` env 可设初始值）；运行时经 `PUT /api/v1/cache/status` 切换；**不做持久化**，重启回默认（与「不做缓存持久化」一致） |
| 全量清除 | `POST /api/v1/cache/clear`：内存清空 + `DELETE FROM cache_entries`；`cache_logs` **不动**（历史数据是图表 / 误判率数据源） |
| 单条删除 | `DELETE /api/v1/cache/entries/:id`：内存删 + 表删；仅该条目失效，其余命中不受影响 |
| 版本失效 | `CACHE_VERSION`（src/cache.ts 模块常量）：lookup 发现条目 `versionTag ≠ CACHE_VERSION` → **全量清除一次**（语料 / 提示词 / 路由相关版本变更防命中旧答案）+ `console.warn`；写入条目带当前版本 |
| embedding 降级 | `sango_query_embed` 失败 → 旁路不查不写不落（§1.2 步骤 1），等同开关关闭 |

### 1.7 语义判定设施落点裁决

**结论：mcp-server 轻量工具 `sango_query_embed`（本期 mcp-server 有改动：仅新增 1 个内部工具，不改任何现有工具契约）。**

理由：
1. **零口径漂移**：复用 A004 `embedQuery`（bge-m3-encoder.ts，已用 verify-embed-parity 与离线口径对齐）；判定与检索同一语义空间（同源同维度）。
2. **内存不翻倍**：orchestrator 内置需引 `onnxruntime-node`（native 依赖）+ 第二份 ~2.1 GB 权重常驻（sango 进程已加载一份，双份 ~4.2 GB+），且复制一份 encoder 实现（A004 明示避免二次口径漂移）。
3. **设施归属单点**：向量设施在 sango（检索域），消费方在总台；工具化后契约清晰、可单测，失败路径（权重缺失 → 降级）已在 A004 验证。
4. **延迟可控**：stdio 往返 + 1024×4 B base64 载荷为毫秒级，远小于 LLM 2~10 s，满足「命中链路延迟目标远低于 LLM 调用」。

代价：每次 sango-novel 请求多一次 stdio 往返（约数 ms~数十 ms；sango 进程冷启动首调加载权重约秒级，与 A004 首次检索同源、可接受）。

#### 1.7.1 工具契约（mcp-server 本期新增）

| 项 | 契约 |
|----|------|
| 工具名 | `sango_query_embed` |
| description | 内部工具：把 query 编码为 BGE-M3 1024 维 L2 归一化向量（base64-float32-le）。仅供编排层语义缓存判定调用，模型不可见，不产诊断 |
| inputSchema | `{ query: string }`（1 ≤ len ≤ 300，超限报 isError） |
| 成功出参 | `content: [{ type: "text", text: JSON.stringify({ dim: 1024, encoding: "base64-float32-le", data: "<base64>" }) }]`，单文本块约 5.5 KB；`data` = Float32Array(1024) 底层 buffer 的 base64（little-endian） |
| 失败出参 | `isError: true`，message 为固定文案（权重缺失 / 推理失败 / query 非法统一为内部错误文案），进总台 stderr 排查 |
| 诊断 | 不携带 `_meta.diagnostics`；与 traceId 无关 |
| 注册 | `sango/src/index.ts` 走 `registerTool`（同 sango_novel_search 模式），不依赖 SangoIndex 实例 |

**mcp-server 本期改动范围**：仅此 1 个工具。`sango_novel_search` / `sango_novel_chapter` / 出参契约 / 诊断契约零改动。

#### 1.7.2 总台装配

- `MCPTransport` 新增 `callInternal(name, args)`：按工具名路由到归属 server（`toolToServer` 表由 `listTools()` 重建，内部工具同样登记），**不落 `tool_call_logs`、不注入 `_meta.traceId`、不包装 `ToolExecutionError`**（失败以 `ToolCallResult.isError` 形态返回，缓存层降级旁路）。
- 模型不可见：`MODEL_VISIBLE_TOOLS` 白名单（agent.ts）不含 `sango_query_embed` → LLM 工具装配与 `GET /api/tools` 均不出现（A010 白名单机制原样生效，无需改白名单代码）。

### 1.8 并发与时序口径

`/api/chat` 已由 server.ts 串行队列处理；后台 `/api/v1/cache*` 操作不与 chat 共享该队列。**执行模型**：内存 LRU 的增删改查全部为同步操作（JS 事件循环内不被抢占，天然原子）；缓存判定唯一异步点是步骤 1 的 embedding 获取（await 期间内存未动）。因此「嵌入返回后判定」与「后台清除 / 删除 / 开关」之间是确定性的先后序：清除后再判定 → 池空 → 未命中 → 走 LLM → 重新写缓存（遵循写缓存条件）。不存在半可见状态，无需加锁。文档口径，验收按此推导。

## 二、存储层字段契约

> 三张新表进 `src/storage/logs.ts` 的 `SCHEMA_SQL`（`CREATE TABLE IF NOT EXISTS`，对旧库同样幂等，A012 迁移先例风格）；**cache 相关写一律同步直写**（不经 A007 写缓冲，见核心口径）。库仍为 `data/logs.db` 单库。

### 2.1 cache_entries（缓存条目镜像表）

| 列名 | 类型 | 说明 |
|------|------|------|
| `id` | INTEGER PRIMARY KEY AUTOINCREMENT | 与内存 LRU 条目 id 一一对应 |
| `query_text` | TEXT NOT NULL | 用户输入原文（trim 后） |
| `embedding_b64` | TEXT NOT NULL | embedding（Float32Array 1024）base64，供复算 / 排查 |
| `answer_json` | TEXT NOT NULL | 答案对象 `JSON.stringify({ answer, citations })`（**全文，不做 8000 截断**；request_logs.answer 截断口径互不干扰） |
| `answer_bytes` | INTEGER NOT NULL | `Buffer.byteLength(answer_json, 'utf8')`，写入时算好（概览 SUM 依据） |
| `hit_count` | INTEGER NOT NULL DEFAULT 0 | 命中计数 |
| `last_access_at` | INTEGER NOT NULL | 最后访问时间 epoch ms |
| `created_at` | INTEGER NOT NULL | 写入时间 |
| `version_tag` | TEXT NOT NULL | 答案产物版本（§1.6） |

角色：后台只读数据源（概览 / 条目列表 / 单条删除定位）；**启动时清空**（见 §1.1）。索引：`idx_cache_entries_last_access ON cache_entries(last_access_at)`。

### 2.2 cache_logs（判定审计表）

| 列名 | 类型 | 说明 |
|------|------|------|
| `id` | INTEGER PRIMARY KEY AUTOINCREMENT | 判定行 id（误判标记 / 灰色区清单定位用） |
| `trace_id` | TEXT NOT NULL UNIQUE REFERENCES request_logs(trace_id) ON DELETE CASCADE | 一个请求至多一行（开 + embedding 可用时恰好一行；旁路零行） |
| `user_query` | TEXT NOT NULL | 用户输入原文（trim 后） |
| `nearest_query` | TEXT | 最相近缓存条目原文（命中 = 命中条目；未命中 = 差点命中谁；池空 = NULL） |
| `similarity` | REAL | 最高相似度（4 位小数）；池空 = NULL |
| `hit_line` | REAL NOT NULL | 本次请求生效命中线（历史行复算解释不随配置漂移） |
| `hit` | INTEGER NOT NULL | 1 = 命中 / 0 = 未命中 |
| `tie_hits` | INTEGER | ≥ 命中线的候选条数：唯一候选=1；无候选=0；池空=NULL（歧义可查询 / 可解释的基础） |
| `marked` | INTEGER NOT NULL DEFAULT 0 | 误判标记（仅对 hit=1 行有意义；对未命中行标记不参与统计） |
| `marked_by` | TEXT | 标记人（接口入参，无登录体系，前端传固定「控制台」或用户输入） |
| `marked_at` | INTEGER | 标记时间 epoch ms |
| `created_at` | INTEGER NOT NULL | 判定时间 |
| `lookup_ms` | INTEGER | 本次请求缓存判定耗时（毫秒，含 embedding 冷启动）；历史行 / 未采集 = NULL（验收第七批） |

区间归类（派生，无枚举列）：`hit=1` → 高置信命中；`hit=0 且 similarity IS NULL` → 低相似（池空）；`hit=0 且 similarity < 0.80` → 低相似；`hit=0 且 0.80 ≤ similarity < hit_line` → 灰色区；`hit=0 且 similarity ≥ hit_line` → 歧义或焦点拒判（tie_hits ≥ 2 = 歧义）。索引：`idx_cache_logs_created`、`idx_cache_logs_hit_created(hit, created_at)`。

### 2.3 迁移 SQL（幂等，A012 先例）

```sql
-- 进 SCHEMA_SQL，每次启动执行；建表 IF NOT EXISTS 即幂等；旧库缺列走下方 ALTER（duplicate column 忽略）
CREATE TABLE IF NOT EXISTS cache_entries (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  query_text     TEXT NOT NULL,
  embedding_b64  TEXT NOT NULL,
  answer_json    TEXT NOT NULL,
  answer_bytes   INTEGER NOT NULL,
  hit_count      INTEGER NOT NULL DEFAULT 0,
  last_access_at INTEGER NOT NULL,
  created_at     INTEGER NOT NULL,
  version_tag    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_cache_entries_last_access ON cache_entries(last_access_at);
CREATE TABLE IF NOT EXISTS cache_logs (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  trace_id      TEXT NOT NULL UNIQUE REFERENCES request_logs(trace_id) ON DELETE CASCADE,
  user_query    TEXT NOT NULL,
  nearest_query TEXT,
  similarity    REAL,
  hit_line      REAL NOT NULL,
  hit           INTEGER NOT NULL,
  tie_hits      INTEGER,
  marked        INTEGER NOT NULL DEFAULT 0,
  marked_by     TEXT,
  marked_at     INTEGER,
  created_at    INTEGER NOT NULL,
  lookup_ms     INTEGER
);
CREATE INDEX IF NOT EXISTS idx_cache_logs_created ON cache_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_cache_logs_hit_created ON cache_logs(hit, created_at);
```

```sql
-- 旧库迁移（幂等，A012 先例）：A013 早期版本已建的 cache_logs 缺 lookup_ms，补列；
-- 新库建表已含该列，重复执行（duplicate column）忽略；历史行保持 NULL 不回填（未采集无法事后推断）
ALTER TABLE cache_logs ADD COLUMN lookup_ms INTEGER;
```

启动清镜像（每次初始化执行）：`DELETE FROM cache_entries;`（幂等，残留即清）。

### 2.4 落库点总览

| 操作 | 文件与函数 | 时机 |
|------|-----------|------|
| `cache_logs` 插入 | `src/cache.ts` `lookup()` → `src/storage/logs.ts` `LogStore.appendCacheLog`（同步直写，旁路静默） | 判定完成即落（命中 / 未命中一律一行），LLM 之前 |
| `cache_entries` INSERT / UPDATE / DELETE | `src/cache.ts`（写缓存 / 命中计数 / 淘汰 / 删除 / 清除）→ LogStore 镜像方法 | 与内存操作同一次调用内完成（事件循环内原子） |
| `cache_logs` marked 更新 | `src/api/v1/cache.ts` → LogStore | 误判标记 / 取消接口 |
| embedding 获取 | `src/cache.ts` → `transport.callInternal("sango_query_embed")` | 每次 sango-novel 判定前（开关开启时） |
| `cache_hit_line_changes` 插入 | `src/api/v1/cache.ts` PUT /hit-line → LogStore.`appendHitLineChange`（同步直写，旁路静默） | 每次命中线成功调整后立即落一条（改前 / 改后） |
| 开关状态 | `src/cache.ts` 内存态；API 读写 | 启动取 `CACHE_ENABLED`，运行时 API 切换 |

LogStore 新增方法（均旁路静默 / 同步直写）：`appendCacheLog(traceId, payload)`、`queryCacheLogByTrace(traceId)`、`queryCacheLogs(filter)`、`queryCacheDistribution(startAt, endAt)`、`querySimilarityRows(filter)`、`queryMisjudgeStats(startAt, endAt)`、`updateCacheLogMark(id, marked, markedBy)`、`appendHitLineChange(previous, current)` / `getLastHitLineChange()`（§2.5）、cache_entries 读写（`insertCacheEntry` / `updateCacheEntry` / `deleteCacheEntry` / `listCacheEntries` / `clearCacheEntries` / `countCacheEntries`）。编排侧判定 / LRU 逻辑在 `src/cache.ts`（新文件，CacheManager）；后台 API 在 `src/api/v1/cache.ts`（新文件，createCacheApi）。

### 2.5 cache_hit_line_changes（命中线修改记录表）

| 列名 | 类型 | 说明 |
|------|------|------|
| `id` | INTEGER PRIMARY KEY AUTOINCREMENT | 行号；读取恒取最大 id（最近一条） |
| `previous` | REAL NOT NULL | 调整前命中线 |
| `current` | REAL NOT NULL | 调整后命中线 |
| `changed_at` | INTEGER NOT NULL | 修改时刻（epoch ms） |

角色：命中线修改履历（§3.2 PUT hit-line 每次成功调整落一行；§3.6 `overview.lastHitLineChange` 数据源）。**运行时命中线值本身不持久化**（重启回 `CACHE_HIT_LINE`，§1.3），但修改履历持久化、跨重启保留。写入同步直写 + 失败旁路静默（不影响 PUT 成功语义）。

```sql
CREATE TABLE IF NOT EXISTS cache_hit_line_changes (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  previous   REAL NOT NULL,
  current    REAL NOT NULL,
  changed_at INTEGER NOT NULL
);
```

## 三、后台 API 契约

> 统一信封 `{ code, data, message }`，错误码语义对齐现有（400 参数非法 / 404 不存在 / 500 服务异常）；挂载 `app.use('/api/v1/cache', createCacheApi(cacheManager))`（server.ts），本组接口自身不落日志（防递归，同 /api/v1/logs*）。

### 3.1 GET /api/v1/cache/status —— 开关与配置状态

```json
{ "code": 200, "data": { "enabled": true, "hitLine": 0.92, "maxEntries": 500, "entryCount": 37 }, "message": "" }
```

`hitLine` = 当前生效命中线（`CACHE_HIT_LINE` 启动值，运行时不可改）；`entryCount` = 当前池条目数（内存与表恒等，同事务）。

### 3.2 PUT /api/v1/cache/status —— 开关切换

请求体 `{ "enabled": true }`（必须 boolean，否则 400「enabled 必须为布尔值」）。**立即生效**：关闭后同一问题二次提问走 LLM、不查缓存、不产生 cache_logs；开启后恢复命中。返回新 status（同 §3.1 形状）。重启回 `CACHE_ENABLED` 初始值。

另：`PUT /api/v1/cache/hit-line`，body `{ "hitLine": number }`（0 < hitLine ≤ 1，否则 400「hitLine 必须为 0~1 的数字」）：命中线运行时调整，立即生效于后续判定与图表着色上沿，返回 `{ code: 200, data: { hitLine }, message: "" }`；每次成功调整同步落一条修改记录到 `cache_hit_line_changes`（§2.5，改前 / 改后 / 时刻），写入失败旁路静默不影响成功语义；`/overview.lastHitLineChange`（§3.6）可取最近一条。运行时值本身不持久化（重启回 `CACHE_HIT_LINE` 初始值），历史 `cache_logs.hit_line` 不漂移（§1.3）。

### 3.3 POST /api/v1/cache/clear —— 全量清除

```json
{ "code": 200, "data": { "cleared": 37 }, "message": "" }
```

`cleared` = 清除前条目数。立即生效（被清 query 再问遵循写缓存条件：与剩余条目无 ≥ 0.80 近似则重新入池）。

### 3.4 DELETE /api/v1/cache/entries/:id —— 单条删除

`:id` 必须正整数（400「id 非法」）；不存在 → 404「缓存条目不存在」；成功 `{ "deleted": true }`。立即生效，仅该条目失效，其余命中不受影响。

### 3.5 GET /api/v1/cache/entries —— 条目明细（分页）

参数：`pageNo`（≥1，默认 1）/ `pageSize`（1~100，默认 20）/ `sortBy`（`lastAccessAt` 默认 / `hitCount`）/ `order`（`desc` 默认 / `asc`）。非法参数 400。

```json
{ "code": 200, "data": { "list": [
  { "id": 12, "queryText": "义释严颜是怎么回事", "answerBytes": 1842, "embeddingBytes": 4096,
    "hitCount": 3, "lastAccessAt": 1779408000000, "createdAt": 1779312000000,
    "traceId": "dc1b7b5b-2db8-4288-ba06-f4711e0b7a30" }
], "total": 37, "pageNo": 1, "pageSize": 20 }, "message": "" }
```

**载荷纪律**：不含 embedding 与答案全文（前端删除 / 概览用不到）；`answerBytes` 与概览对账（Σ = `answerBytesTotal`）。`embeddingBytes` = 4096（1024 × 4B，常量）。

**`hitCount` 口径（验收问题「缓存概览 4」修正）**：累计命中次数（同 §3.12 弹框口径，`cache_logs` 中 `hit=1` 且 `nearest_query` = 条目 `query_text`；含历史池，重启不归零）。`sortBy=hitCount` 按该累计值排序（同值按 id 升 / 降序）。

**`traceId` 口径（验收修正）**：最近一条同该条目 `queryText` 的 `cache_logs.traceId`（`user_query` = 条目 `query_text`，按 `id DESC` 取最新）；无关联行（池空 / 历史）为 `null`。数据源为 `cache_logs` 关联查询，`cache_entries` 镜像表不加列（§2.1 表结构不变）。供前端条目列表「查询（用户输入原文）」点击跳转日志明细（traceId 精确跳转 + 自动展开明细，同灰色区清单 §4.2）；字段名 `traceId`，前端按其取值跳转（非空才可跳转，`null` 不渲染跳转）。

### 3.6 GET /api/v1/cache/overview —— 缓存概览（口径可复算）

```json
{ "code": 200, "data": { "enabled": true, "hitLine": 0.92, "maxEntries": 500,
  "entryCount": 37, "answerBytesTotal": 68154, "embeddingBytesTotal": 151552,
  "approximateBytes": 239220, "avgAnswerBytes": 1842,
  "lastHitLineChange": { "previous": 0.92, "current": 0.85, "at": 1779408000000 } }, "message": "" }
```

口径（页面标注「近似」，接口给口径以便复算）：
- `answerBytesTotal` = `SUM(answer_bytes)`（可复算：§3.5 Σ `answerBytes` 恒等）。
- `embeddingBytesTotal` = `entryCount × 4096`（纯计算）。
- `approximateBytes` = `answerBytesTotal + embeddingBytesTotal + entryCount × 256`（256 = 条目结构开销常数，进程 heap 无法逐条归属，故为「近似」）。
- `avgAnswerBytes` = `answerBytesTotal / entryCount`（entryCount=0 时 0），供上限校准（§1.5）。
- `lastHitLineChange` = `cache_hit_line_changes` 最近一条（`ORDER BY id DESC LIMIT 1`），形状 `{ previous, current, at }`；无任何修改记录时为 `null`。

### 3.7 GET /api/v1/cache/stats/similarity-distribution —— 三色分布图表

参数：`startAt` / `endAt`（必填毫秒时间戳，校验同 token-stats）。数据源恒为 `cache_logs`。

```json
{ "code": 200, "data": {
  "hitLine": 0.92, "bucketWidth": 0.02, "bucketCount": 50,
  "buckets": [
    { "lower": 0.00, "upper": 0.02, "count": 3 },
    { "lower": 0.98, "upper": 1.00, "count": 11 }
  ],
  "totals": { "lowSimilar": 41, "grayZone": 9, "highConfidence": 12, "totalCount": 62 },
  "startAt": 1779408000000, "endAt": 1779494400000 }, "message": "" }
```

聚合口径：
- 桶 = `[i × 0.02, (i + 1) × 0.02)`，i = 0..48；**第 49 桶 = [0.98, 1.00]（含 1.0）**。
- `bucketIndex(sim)` = `sim === null ? 0 : Math.min(Math.floor(sim / 0.02), 49)`；`sim=1.0` → 49。请求计数 = 该桶区间内 cache_logs 行数（不去重，一行一请求）。
- 三档合计：`lowSimilar` = sim < 0.80 的行（含池空行 sim=null，落低相似档）；`grayZone` = 0.80 ≤ sim < hitLine（默认即 0.80 ≤ sim < 0.92）；`highConfidence` = sim ≥ hitLine（含歧义 / 焦点拒判行——三色是**区间着色**不是行分类，见展示契约 §4.2）。
- 对账：`Σ buckets[].count` == `totals.totalCount` == 区间内 cache_logs 行数。
- 命中线变化只改着色分界（前端按接口返回的 `hitLine` 着色），聚合逻辑不变。

### 3.8 GET /api/v1/cache/grayzone —— 灰色区 query 对明细

参数：`startAt` / `endAt`（必填）/ `pageNo` / `pageSize`（同 §3.5）/ `marked`（`all` 默认 / `marked` / `unmarked`）/ `similarityMin` / `similarityMax`（可选、可单传：0~1 数字，`min ≤ max` 否则 400 且消息点名参数；空字符串视为未传；在灰色区口径之上叠加过滤，边界按包含 `similarity ≥ min` / `similarity ≤ max`）。口径 = `hit=0 AND similarity ≥ 0.80 AND similarity < hit_line`（「差点命中谁」不去重，按次一行）。

```json
{ "code": 200, "data": { "list": [
  { "cacheLogId": 88, "traceId": "dc1b7b5b-2db8-4288-ba06-f4711e0b7a30", "createdAt": 1779408000000,
    "userQuery": "严颜被义释是哪一回", "nearestQuery": "义释严颜的经过",
    "similarity": 0.8512, "hitLine": 0.92, "marked": false }
], "total": 9, "pageNo": 1, "pageSize": 20 }, "message": "" }
```

支撑命中线附近误判识别与下调权衡：从 `nearestQuery` 可直接定位可删除的池条目（对照 §3.4）；后续若命中线下调，本清单即「可直接受益的候选面」。

### 3.9 误判标记 / 取消 / 误判率

- `POST /api/v1/cache/records/:id/mark`，body `{ "markedBy"?: string }`（缺省「控制台」）：对 cache_logs 行标记误判（`marked=1` / `marked_by` / `marked_at`）；已标记幂等 200；id 不存在 404。
- `POST /api/v1/cache/records/:id/unmark`：取消标记；未标记幂等 200。
- `GET /api/v1/cache/misjudge?startAt&endAt`：

```json
{ "code": 200, "data": { "hitTotal": 12, "markedMisjudge": 1, "misjudgeRate": 0.0833,
  "note": "误判率 = 区间标记误判数 / 区间命中总数；未标记不计为正确；hitTotal=0 时 rate 为 null" }, "message": "" }
```

口径：`hitTotal` = 区间内 `hit=1` 行数；`markedMisjudge` = 区间内 `marked=1` 行数（含未命中灰色区标记）；`misjudgeRate` = 两者之比（4 位小数）；`hitTotal=0` → `rate: null`（页面显示「—」）。不自动判定对错（无真值来源，需求口径）。

### 3.10 命中解释 —— 并入日志明细与列表

- `GET /api/v1/logs/:traceId` 新增 `data.cache`（cache_logs 无行时为 `null`）：

```json
{ "cacheLogId": 88, "hit": true, "hitLine": 0.92, "similarity": 0.9821, "tieHits": 1,
  "userQuery": "严颜是怎么被义释的", "nearestQuery": "义释严颜是怎么回事",
  "reason": "hit", "marked": false, "createdAt": 1779408000000, "lookupMs": 175 }
```

- `cacheLogId` = `cache_logs.id`（误判标记 / 取消按 §3.9 `records/:id` 定位，2026-09-23 契约补充，前端已按缺失降级实现）
`reason` 枚举：`hit` / `miss-low` / `miss-gray` / `miss-tie` / `miss-focus`（低相似 / 灰色区 / 歧义 / 焦点拒判）；`similarity` / `nearestQuery` / `tieHits` 语义同表列（池空 null）。
- `GET /api/v1/logs` 新增每行 `cacheHit`：`1`（命中）/ `0`（未命中）/ `null`（非 sango-novel、开关关闭、embedding 降级旁路，或 A013 前历史行）。派生方式：`LEFT JOIN cache_logs`（trace_id 唯一）。列表行 hover 展示（§4.2）。
- 明细 `data.cache.lookupMs`：本次请求缓存判定耗时（毫秒，含 embedding 冷启动；如 BGE-M3 首次加载 ~3.4s、权重就绪后 ~175ms，参考 trace 2631c162）；历史行 / 未采集 = `null`（验收第七批：耗时归因，前端按非 null 展示）。
- `GET /api/v1/logs` 每行 `durations` 增 `cacheLookupMs`（毫秒；无 cache_logs 行 / 未采集 = `null`），派生：queryList SQL `LEFT JOIN cache_logs` 取 `cl.lookup_ms`（trace_id 唯一，行数不放大）。前端耗时 tooltip 将「其他」拆出「缓存判定」独立成段展示（§4.2）。

### 3.11 GET /api/v1/cache/stats/similarity-rows —— 相似度分布桶明细（柱形下钻）

参数：`startAt` / `endAt`（必填毫秒时间戳，校验同 §3.7）/ `bucketIndex`（int 0~49，默认 0）/ `pageNo` / `pageSize`（同 §3.5）。数据源恒为 `cache_logs`，供前端点击分布图柱形（桶）查看该桶请求记录。

```json
{ "code": 200, "data": { "list": [
  { "cacheLogId": 88, "traceId": "dc1b7b5b-2db8-4288-ba06-f4711e0b7a30", "createdAt": 1779408000000,
    "userQuery": "严颜被义释是哪一回", "nearestQuery": "义释严颜的经过",
    "similarity": 0.8512, "hit": false, "tieHits": 0, "hitLine": 0.92, "marked": false }
], "total": 9, "pageNo": 1, "pageSize": 20 }, "message": "" }
```

过滤口径（与 §3.7 `bucketIndex(sim)` 同源，桶边界含下不含上）：`bucketIndex=0` → `similarity IS NULL OR similarity < 0.02`；`1 ≤ i ≤ 48` → `i × 0.02 ≤ similarity < (i + 1) × 0.02`；`49` → `0.98 ≤ similarity ≤ 1.00`（含 1.0）。排序 `created_at DESC`（同刻按 id DESC）。`total` = 该桶未分页行数；`hit` / `tieHits` 布尔化语义同表列（池空 `similarity` / `tieHits` 为 null）。

对账：同时间窗、无其他筛选时 `total === similarity-distribution.buckets[bucketIndex].count`（前端可用作下钻加载完成校验）。

### 3.12 GET /api/v1/cache/entries/:id/hits —— 缓存条目命中记录

参数：`:id`（条目 id，非法 400）/ `pageNo` / `pageSize`（同 §3.5，默认 1 / 20，1~100）。供前端「缓存条目列表」点命中次数 > 0 弹框展示哪些请求命中了该条目。

口径：`cache_logs` 中 `hit=1` 且 `nearest_query =` 该条目 `query_text` 的行（命中该条目的请求记录），按 `created_at DESC`（同刻按 `id DESC`）分页；条目不存在 404。`marked` 布尔化语义同表列。

```json
{ "code": 200, "data": { "list": [
  { "traceId": "dc1b7b5b-2db8-4288-ba06-f4711e0b7a30", "userQuery": "严颜被义释是哪一回",
    "similarity": 0.9821, "createdAt": 1779408000000, "marked": false }
], "total": 9, "pageNo": 1, "pageSize": 20 }, "message": "" }
```

### 3.13 检索分阶段耗时（toolCalls[].diagnostics.timing）

日志明细（`GET /api/v1/logs/:traceId`）的 `toolCalls[].diagnostics.timing`（sango 检索诊断，feat-A013 验收修正）：

```json
{ "bm25": 3.1, "vector": 4.2, "label": 0.4, "merge": 1.2 }
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `bm25` | number / null | BM25 打分循环 + 归一化段耗时（毫秒） |
| `vector` | number / null | 向量编码（embedQuery）+ cosineAll 段耗时（毫秒）；`useVectors=false` 降级（scheme=hash / 无向量文件）时为 null；编码失败也计入耗时（降级状态以 `env.degradedBm25Only` 表达） |
| `label` | number / null | 标签路由循环段耗时（毫秒） |
| `merge` | number / null | 多路候选合并 + 重排（含 topK / sort，到 hits 切片）段耗时（毫秒）；空结果早退路径未执行到合并产出时为 null |

口径：字段归属 sango 诊断契约（feat-A009 §1.3 的扩展；A009 文档已归档不再改，本小节为唯一权威）；**orchestrator 全量透传**（存储 / 接口零改动，不解析不裁剪）；64 KB 预算截断不丢 `timing`（`truncated=true` 时仍全量保留）。前端用于检索耗时展示（BM25 / 向量 / 标签路由 / 合并重排四段）。

## 四、命中时 trace 形态与前端展示契约

### 4.1 日志链路（命中 = 0 次 LLM + 0 次检索）

| 表 / 接口 | 命中请求的表现 |
|-----------|----------------|
| `request_logs` | 正常一行：t1 骨架 → t5 success；`answer` / `citations` = 缓存值（8000 截断口径照旧）；`route_source` 已回填（路由判定在缓存检查之前，label / keyword / classify 任一） |
| `llm_call_logs` | **无新增行**（0 次 LLM 调用；A011/A012 cached_tokens 等字段自然不产生数据） |
| `tool_call_logs` | **无新增行**（无检索；内部 embed 调用按「三不原则」不落明细） |
| `tool_retrieval_logs` | 无行（检索诊断面板空 → 前端按 data.cache 显示「缓存命中，未走检索」） |
| `cache_logs` | 1 行（hit=1，含相似度 / 命中线 / 最相近条目原文） |

### 4.2 前端展示契约（小叶照做）

- **日志详情页「缓存判定」卡片**（`data.cache` 非 null 时展示；null 不展示）：
  - 命中：绿标「缓存命中，未走检索」；用户输入原文 / 命中条目原文 / 相似度 / 命中线 / 命中时间；命中解释**算式代入**（对齐 A009 最终分 hover 口径，禁止只给最终数字）：`最高相似度 0.9821 ≥ 命中线 0.92 → 命中`（similarity 4 位小数）。
  - 未命中：灰 / 黄标（低相似 / 灰色区「差点命中谁」）；算式 `最高相似度 0.8512 < 命中线 0.92 → 未命中（灰色区）`；灰色区行高亮 `nearestQuery` 原文。
  - 歧义：`≥ 命中线候选 2 条 → 歧义，不命中`；焦点拒判：`最高相似度 0.9550 ≥ 命中线 0.92，焦点不一致（chapter vs process）→ 不命中`。
  - A009 检索诊断面板区：`data.cache.hit === true` 时显示「缓存命中，未走检索」，不展示空检索诊断（避免误判为链路故障，需求口径）。
- **日志列表行**：`cacheHit` 非 null 时，hover 该行类型标签弹 tooltip 一行：`缓存命中`（绿）/ `缓存未命中`（灰）（A012 §4.2 同款 hover 方式，不新增整列）；null 无标。
  - 耗时展示：`durations.cacheLookupMs` 非 null 时 tooltip 中「缓存判定」独立成段（`123ms` / `1.2s` 格式化，同耗时列口径），不再并入「其他」；null 无该段（历史行 / 未采集，§3.10）。
- **三色分布图**（§3.7 数据）：单柱直方图，x 轴相似度 0~1.0、y 轴请求数；**每根柱颜色由桶所在区间决定**（< 0.80 蓝 / [0.80, hitLine) 黄 / ≥ hitLine 绿）——区间着色，与行分类无关；命中线只改着色分界；池空行（sim=null）落第 0 桶（蓝区）。数值单位：请求数精确整数；相似度轴 2 位小数刻度。
- **柱形点击下钻**：点击分布图任一柱（桶）展示该桶明细（数据源 similarity-rows §3.11，字段 / 空态 / 对账见该小节）。
- **灰色区清单**（§3.8）：表格列 traceId / 时间 / 用户输入原文 / 最相近条目原文 / 相似度（4 位小数）/ 命中线 / 误判标记；行内可跳转日志详情（traceId）；误判标记 / 取消在命中解释卡片与灰色区清单均可操作；`markedBy` 输入框（缺省「控制台」）。
- **缓存概览页**（§3.6）：条目数 / 答案字节合计 / embedding 字节 / 近似内存（标注「近似」+ 口径 note）；条目列表（§3.5）排序切换；开关（§3.2）+ 全量清除（§3.3，二次确认）+ 单条删除（§3.4）。
- **误判率展示**（§3.9）：命中总数 / 标记误判数 / 误判率，`rate: null` 显示「—」，配 note 文案。

## 五、接口侧验收清单（文档级，逐条自检；判定式写法可直接当测试用例）

| # | 条目 | 判定式验收 |
|---|------|-----------|
| 1 | 原句二次提问命中 | 同一 query 连续两次（首问池内无 ≥ 0.80 近似且可写）：第二次 `llm_call_logs` 无新增行；`cache_logs` 两行（首行 hit=0 / similarity=null，次行 hit=1 / similarity=1.0000）；响应 answer / citations 与首次一致 |
| 2 | 等价问法命中 | 「义释严颜是怎么回事」入池后，「严颜是怎么被义释的」命中：hit=1 且 similarity ≥ 0.92；该次请求 `tool_call_logs` 无检索行 |
| 3 | 问点不同不命中 | 「严颜被义释是哪一回」vs「义释严颜的经过」：不命中（唯一候选 ≥ 0.92 时 reason=miss-focus；否则按分区 miss-low / miss-gray），正常走检索 + LLM |
| 4 | 低相似写缓存 | 明显不同问题：hit=0 且 similarity < 0.80（池空 similarity=null 同档）；LLM 后 `cache_entries` +1（非拒答答案）；`cache_logs` 记录最高相似度与最相近条目原文 |
| 5 | 灰色区不写缓存 | 0.80 ≤ similarity < hitLine：hit=0 走完整 LLM，`cache_entries` 不增；`cache_logs` 按次落行（同 query 重复提问每次一行，不去重） |
| 6 | LRU 淘汰 | 测试小容量（如 maxEntries=2）：写入 3 条不同问题 → 最早写入的被逐出、最近命中的保留；被逐出 query 再问 → hit=0 且（无 ≥ 0.80 近似则）重新入池 |
| 7 | 歧义不命中 | 构造两条缓存条目对新 query 均 ≥ hitLine：hit=0 且 tie_hits ≥ 2，reason=miss-tie，走原链路 |
| 8 | 开关 | 关闭后：同一问题第二次提问走 LLM、`cache_logs` 无新增行（cacheHit=null）；开启后恢复命中（真浏览器 + 真实数据验收） |
| 9 | 清除立即生效 | 全量：清后 `cache_entries` 0 条、内存池空，被清 query 再问走 LLM；单条：仅该 id 失效，其余条目命中不受影响（真浏览器验收） |
| 10 | 图表对账 | `Σ buckets[].count == totals.totalCount == startAt~endAt 区间 cache_logs 行数`；桶宽 0.02 / 50 桶 / 第 49 桶含 1.0；sim=null 行落桶 0；三档合计与区间行派生一致 |
| 11 | 命中解释 | 命中请求 `data.cache` 全字段存在、类型正确；前端按 §4.2 算式代入展示（0.9821 ≥ 0.92 → 命中），非只给数字；未命中请求 reason / similarity / nearestQuery 正确 |
| 12 | 回归 | 随机一题、`auto` / `fengyunsanguo` 请求：无 cache_logs 行、`/api/chat` 行为与缓存开关状态无关 |
| 13 | 概览复算 | `entryCount == GET /api/v1/cache/entries total`；`answerBytesTotal == Σ list[].answerBytes`；`embeddingBytesTotal == entryCount × 4096`；`approximateBytes` 按 §3.6 公式 |
| 14 | 误判口径 | mark 后 `misjudge.markedMisjudge` +1、`misjudgeRate = markedMisjudge / hitTotal`（未标记不计为正确）；unmark 恢复；hitTotal=0 → rate=null |
| 15 | 语义工具 | `sango_query_embed` 出现在 sango `tools/list`，但不在 `GET /api/tools` 与模型可见工具集；内部调用不落 `tool_call_logs`、不注入 `_meta.traceId`；权重缺失 → 旁路行为与开关关闭一致（验收 8）且不抛 503 |
| 16 | 旧库兼容 | 存量 db 升级后两新表可建（幂等），明细 / 列表 / 既有接口全部 200；`data.cache` 与 `cacheHit` 对历史行为 null |
| 17 | 内部调用旁路 | 故障注入（权重缺失 / embed 异常）：/api/chat 正常返回，错误码与 message 与原链路一致；cache 判定旁路且 console.warn 一次 |
| 18 | 图表下钻对账 | 某桶下钻 `total ==` 分布图该柱 `count`（同时间窗、无其他筛选，口径见 §3.11） |

## 六、明确不改什么（非目标）与互补关系

- `fengyunsanguo` 不接入缓存（负责人 2026-09-23 确认）；普通问答（auto / free）、随机一题不缓存；不改 `fengyunsanguo_query` 等题库工具。
- 不做 provider 侧 prompt 缓存（A011/A012 `cached_tokens` 已另立）：**两者互补**——A011/A012 省的是重复前缀的输入 token 计费（命中时 llm_call_logs 的 `cached_tokens` 字段无产生者），本特性省的是**整轮 LLM 调用**（命中 = 0 次调用，连计费都没有）；层级不同、互不替代。
- 不做缓存持久化（重启清空，MVP 可接受；Redis / SQLite 化另立）、动态调阈值（命中线为启动配置）、query 改写、命中后答案合并 / 再生成、缓存预热、多实例共享缓存、自动判定命中答案对错（无真值来源，误判靠人工标记）。
- 不改 `/api/chat` 请求 / 响应形状与 `status` / `responseCode` 筛选口径；不改 A004 检索工具契约与 citations 形状；`request_logs` 不加物理列（cacheHit 派生自 cache_logs）。
- mcp-server 本期仅新增 `sango_query_embed` 一个内部工具；Transport 层现有工具契约、A009 诊断契约、A010 白名单机制零改动（`callInternal` 为新方法，不改现有 `callTool` 签名）。

## 风险 & 开放问题

1. **错误答案固化**：命中跳过检索与生成，首答错误将持续输出 → 缓解均本期落地：命中解释可见 + 开关一键停用 + 全量清除 / 单条删除；残余靠人工巡检（需求口径，无新增）。
2. **误命中残余**（bug-00022 同族）：两层防御收窄非根除；若数据证明误命中率高，另立课题根治（同 bug-00022 召回大改）。命中线 0.92 为保守默认，灰色区数据即校准机制。
3. **embedding 冷启动**：首个 sango-novel 请求的 embed 调用触发权重加载（约秒级），与 A004 首次检索同源；后续稳定毫秒级。命中链路延迟以实测定稿（目标远低于 2~10 s）。
4. **降级期间无缓存**：权重缺失 / 推理失败 → 旁路（等同关闭），原句重复也走 LLM；数据断档在图表上表现为区间缺失，可接受（与开关关闭口径一致）。
5. **歧义 / 焦点拒判行落高置信区**：三色为区间着色，图表高置信区柱含这些未命中行；明细靠 `reason` 区分，灰色区清单严格按 [0.80, hitLine) 排除歧义。
6. **上限与命中线未实测校准**：默认 500 条 + 0.92 是起步值；概览接口（avgAnswerBytes）+ 分布图表上线后按 §1.5 公式与三色数据拍板调整（env + 重启）。
7. **误判率依赖人工标记**：不标记则失真偏低；用灰色区 query 对清单 + 命中解释引导巡检（需求口径）。
8. **多实例部署内存缓存各自独立**：当前单实例，记风险不阻塞。

- 2026-09-23 story-A013-02 契约补充：§3.10 `data.cache` 增 `cacheLogId`（误判标记 / 取消按 records/:id 定位；Coco 批准，前端已按缺失降级实现）。

## 维护记录

- 2026-09-23 story-A013-02 首版定稿：缓存契约 / 新表 DDL / 后台 API / 命中解释与图表展示契约 / 命中 trace 形态；语义判定落点裁决 = mcp-server 轻量工具（mcp-server 本期新增 `sango_query_embed`，不改现有契约）。
- 2026-09-24 bug-00027 新增 §3.11 相似度分布桶明细（similarity-rows）柱形下钻接口；§4.2 补柱形点击下钻展示契约；验收表增第 18 行图表下钻对账（Coco 拍板）。
- 2026-09-24 验收反馈 grayzone 增可选 similarityMin/Max 区间过滤（Coco 拍板）。
- 2026-09-24 验收反馈 新增 §3.12 entries/:id/hits 命中记录接口（Coco 拍板）。
- 2026-09-24 验收反馈 修复 cache_entries 镜像 id 与内存分叉导致 hits 404（Coco 拍板）。
- 2026-09-24 验收反馈 misjudge 口径改为区间内 marked=1 行数（含未命中灰色区标记）（Coco 拍板）。
- 2026-09-24 验收反馈 命中线改为后台可配置（PUT hit-line）；判定链路增加人名字号归一化（云长→关羽 等换说法命中）（Coco 拍板）。
- 2026-09-24 验收反馈 命中线改为后台可配置（负责人拍板）。
- 2026-09-24 负责人验收反馈：命中线修改留记录（新增 `cache_hit_line_changes` 表 §2.5，PUT hit-line 每次调整落一条，overview 返回 `lastHitLineChange`）。
- 2026-09-24 负责人验收反馈：检索分阶段耗时（sango 诊断新增 `diagnostics.timing` §3.13，orchestrator 全量透传）。
- 2026-09-24 负责人验收反馈：条目跳转需 traceId 关联（§3.5 增 `traceId`，取最近一条同 userQuery 的 `cache_logs.traceId`，无则 null）。
- 2026-09-24 负责人验收反馈：耗时归因，缓存判定耗时落库拆分展示（cache_logs 增 `lookup_ms` → 列表 `durations.cacheLookupMs` / 明细 `data.cache.lookupMs`，tooltip 拆「缓存判定」段；采集侧随后接入）。
- 2026-09-24 验收问题「缓存概览 4」：§3.5 条目列表 `hitCount` 改为累计命中次数（同 §3.12 弹框口径，`cache_logs` 中 `hit=1` 且 `nearest_query` = 条目 `query_text`；含历史池，重启不归零），`sortBy=hitCount` 同步按累计值排序（Coco 拍板）。
