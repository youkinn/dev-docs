# 《三国演义》原著检索（sango_novel_search）+ orchestrator 多 server 注册表

> 作者：老陈
> 对应特性号：feat-A004
> 涉及项目：mcp-orchestrator（transport 多 server 注册表 / server.ts / index.ts）、mcp-server（新增独立 server「sango」：sango/src/ TypeScript + 数据构建 sango/data/，构建产物 sango/dist/index.js）、mcp-web（小叶对接：新增「三国演义」标签，请求携带 domain=sango-novel）
> 日期：2026-09-16（2026-09-18 修订：feat-A004 chunk 规范落地，出参结构化 + 服务端渲染引用；2026-09-20 修订：注入策略改「top5 整段保底 + 第 6–10 段预算兜底」，去段内窗口裁剪；2026-09-20 feat-A006 定稿：citations 结构化，A004 相关条款同步修订）

## 概述

新增独立 MCP server「sango」（入口 `mcp-server/sango/dist/index.js`——TypeScript 构建产物，服务名 `sango`），提供《三国演义》原著 RAG 检索工具 `sango_novel_search`。**确定性优先 + LLM 兜底**：`domain=sango-novel` 走快路径（服务端预先检索 → 注入原文片段 → 单次 LLM 生成，见「POST /api/chat」），其余场景保留大模型按语义自主调度工具（LLM 兜底）；先检索原文段落、再基于召回原文归纳作答，禁止编造原文外内容。`sango` 与现有 weather server 完全隔离、互不改。

orchestrator 的 transport 由单 MCP server 重构为**多 server 注册表**：weather 与 sango 各为一个 stdio 子进程，工具名 → 归属 server 显式映射；`GET /api/tools` 合并上报两个 server 的工具与本地工具。HTTP 层 `POST /api/chat` 请求体字段保持不变（沿用既有 `message` / `domain` 白名单，本期为 `domain` 新增取值 `sango-novel`；响应 `data` 统一为 `{ answer, citations }`——字段只增不减（旧前端忽略 `citations` 照常工作），口径见 `api/feat-A006-citation-display.md`），工具调度默认由模型按语义决定（`domain=sango-novel` 时走确定性快路径，见「POST /api/chat」）。

全部接口沿用 `{ code, data, message }` 信封（见 `mcp-orchestrator/api/response-convention.md`）。

**破坏性变更**：orchestrator transport 注册表化（后端内部重构 + 部署配置变化：需在 orchestrator 根 `.env` 注册表配置 `MCP_WEATHER_SCRIPT` / `MCP_SANGO_SCRIPT` 两个 MCP 子进程入口，`npm run dev` 无参启动）；HTTP 前端字段无破坏，但 `domain` 新增取值 `sango-novel`（语义新增，非破坏）；`/api/tools` 返回的工具列表新增 `sango_novel_search`。

## 独立 MCP server「sango」

| 属性 | 值 |
|------|-----|
| 入口文件 | `mcp-server/sango/dist/index.js`（TS 构建产物；sango 目录内 `npm run build` → `dist/`） |
| 服务名（MCP server name） | `sango` |
| 传输方式 | stdio 子进程（与 weather 一致） |
| 工具 | `sango_novel_search`（唯一） |

- 与 weather server **隔离互不改**：`mcp-server/weather/src/index.js`（迁移后目录，内容零改动、行为不变）及现有天气工具不动；sango 是新增独立目录，不 import、不修改 weather 任何代码。
- orchestrator 注册表中 weather 与 sango 是两个独立 stdio 子进程，互不依赖、独立启动、独立失败。
- 各 server 注册各自工具：weather 注册 `get-forecast` / `get-alerts`；sango 注册 `sango_novel_search`。

### 数据位置 mcp-server/sango/data/

```
mcp-server/sango/data/
├── corpus/
│   └── sanguo-yanyi/        # 分回语料（按 source 分子目录）
│       ├── 001.json         # 第 1 回
│       └── ... 120.json     # 第 120 回
├── vectors/
│   └── sanguo-yanyi.bin     # 离线向量（构建期产物，线上只读）
└── alias.json               # 人名别名表：别名 → 人物 ID
```

- `corpus/`：清洗后 chunk 级切分 + 类型标注的语料 JSON，按回分文件。每回 JSON 结构（schema v2，字段定义见 `docs/sango-corpus-spec.md` §5；`segments[]` 仅存于构建期中间产物，最终交付目录只放 `chunks[]`）：

  ```json
  {
    "source": "sanguo-yanyi",
    "chapter": 5,
    "title": "发矫诏诸镇应曹公 破关兵三英战吕布",
    "chunks": [
      {
        "id": "sanguo-yanyi:0005:c0007",
        "text": "操教酾热酒一杯，与关公饮了上马。",
        "type": "narration",
        "segFrom": 12,
        "segTo": 12,
        "quoteBalanced": true,
        "quotes": []
      }
    ]
  }
  ```

- `type` 枚举：`narration`（叙述）/ `verse`（诗赞）/ `comment`（评注）。
- `segments[].index` 为该回内段落序号，从 1 起；chunk 的 `segFrom` / `segTo` 即对应此序号（出处展示不带段号，见「输出（命中）」）。
- `vectors/`：与 `corpus` 的 `chunks[]` 顺序对齐的离线向量（同一顺序），构建期产出，**线上只读加载**（D5：Python 侧仅构建期出向量，线上运行不依赖 Python）。
- `alias.json`：人名 → 人物 ID。ID 规则：规范名去重后自 `P001` 起编号，关羽的规范名 ID 为 `P002`；同一人物全部别名（字、号、称号）映射到同一 ID（例：`关羽 / 云长 / 关云长 / 美髯公 → P002`）。

### 语料与向量构建管线

- 语料源：`dev-docs/docs/三国演义.txt`（120 回，含站点杂质）。**只清洗不改内容**；底本 / 点校版权在正式上线前确认（上线阻塞项，不影响本期开发与验收）。
- 管线：清洗（去除站点杂质）→ chunk 级切分（六步算法：250 字目标 / 400 字硬上限 / 零重叠 / 只在句末切）+ 类型标注（narration/verse/comment）+ 引语表抽取（`quotes[]`）→ 输出 `corpus/` JSON（schema v2）→ 生成 `vectors/` 离线向量。
- 向量：D2 本地 embedding，BGE-M3；下载先设 `HF_ENDPOINT=https://hf-mirror.com`；**BGE-M3 已落地**（下载需设 `HF_ENDPOINT=https://hf-mirror.com`）；离线产物 `sanguo-yanyi.bin` 头 `scheme=1`、2344 chunk × dim=1024，与 `chunks[]` 同序。
- 检索：BM25 + **真向量** hybrid（内存余弦，`VEC_WEIGHT=1`）；词法无命中时走向量兜底（`MIN_COSINE=0.3`，Step 4 待按真向量分布重定）。数据规模为千级 chunk；**明确不做** query 改写 / rerank / 专用向量库。
  - **运行期 query 编码**：Node 侧 `onnxruntime-node` 内嵌同一份 BGE-M3 权重（`sango/data/models/bge-m3/`，**不入库，部署须整目录下发**，含 `tokenizer_config.json`；可用 `SANGO_BGE_M3_DIR` 覆盖）。懒加载单例：首次检索约 2.4s，之后约 42ms，常驻内存约 1.4GB。
  - **降级（注意是静默的）**：权重缺失或推理失败 → stderr 告警并退化为纯 BM25，不阻断启动、不抛异常；运维漏拷权重会导致检索质量无声下降，部署验收需核对启动日志的 `vectors 已加载：... scheme=model`。

## 工具契约 sango_novel_search

### 工具定义

| 属性 | 值 |
|------|-----|
| 工具名 | `sango_novel_search` |
| 归属 server | `sango` |
| 用途 | 《三国演义》原著段落检索（RAG 取原文），供模型作答引用 |

**描述（description，模型调度依据）**：检索《三国演义》原著原文段落。仅当用户询问《三国演义》原著情节、人物、事件等需要原文依据的问题时调用；回答前必须先调用本工具取得原文，禁止凭记忆作答。与题库工具 `sango_query`（风云三国游戏武将招募题）不同，本工具只检索原著文本。每次调用返回结构化条目数组（字段见「输出（命中）」），**不返回拼接文本块、不含出处头**。

### 输入

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| source | string (enum) | 是 | 会话上下文来源，定检索语料库。本期仅 `sanguo-yanyi`；`sanguozhi` 预留（D4：保留 source 以便后续扩展多来源）。非法值 → 报错 |
| query | string | 是 | 白话问句（用户问题的白话表述），trim 后非空；为空 → 报错 |
| limit | integer | 否 | 返回条数上限，默认 5，最大 20（超出按 20 截断，不报错） |

### 输出（命中）

返回**结构化条目数组**（按相关度降序，最多 `limit` 条；MCP 文本内容为 JSON 序列化结果）。**不再返回拼接文本块、不含【出处】头**：条目文本内一律不含出处、回目、段号、类型、分数——出处与引用原文全部由字段承载，由服务端渲染（见「注入视图」）。

字段定义与 `docs/sango-corpus-spec.md` §5 一致，**唯一例外是 `quotes[]`**（出参形态更瘦，见下「出参 `quotes[]` 与语料不同形」）。`chapter` / `title` 为回级字段，语料文件存于文档层、**工具出参时随每条条目展开**，理由见下：

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | string | chunk 唯一 ID，规则 `{source}:{回号4位补零}:c{回内序号4位补零}`（例 `sanguo-yanyi:0073:c0007`） |
| `text` | string | chunk 纯原文（250 字目标 / 400 字硬上限，可跨段） |
| `chapter` | integer | **回号**（回级元数据随条目携带，见下） |
| `title` | string | **回目**；服务端据此渲染出处，只到回目 |
| `type` | string (enum) | `narration`（叙述）/ `verse`（诗赞）/ `comment`（评注） |
| `segFrom` | integer | 起始段号（对应构建期 `segments[].index`，从 1 起） |
| `segTo` | integer | 结束段号；跨段 chunk 时 `segFrom != segTo` |
| `quoteBalanced` | boolean | 该 chunk 内引号是否配平（构建期自检产物） |
| `quotes` | array | 引语表；chunk 内无成对引语时为 `[]` |
| `quotes[].offset` | integer | 该引语在条目 `text` 中的起始偏移（开引号位置 + 1，1 基） |
| `quotes[].len` | integer | 引语本体长度（字数） |

**出参 `quotes[]` 与语料不同形（bug-00010，2026-09-21 拍板）**：出参只回 `{ offset, len }`——引语文本由条目原文切片还原：

```js
const quote = entry.quotes[0];
const quoted = entry.text.slice(quote.offset - 1, quote.offset - 1 + quote.len + 2);
// 即 `“` + 引语本体 + `”`，例：「“吾虎女安肯嫁犬子乎！……”」
```

- 语料 JSON（`data/corpus/**`）仍是 `{ qid, text, offset, speaker }`，**本次不动、语料与向量不重建**；出参删 `qid`（注入期服务端按出参顺序重编号为全局 `Qn`，出参 `qid` 从未被消费）与 `speaker`（运行期零消费；留库供 bug-00005 备用）。
- 理由：`quotes[].text` 与 `entry.text` 重复传输，最坏情况（整段对话）出参体积接近翻倍，挤占落库 `result_summary` 的 8000 字预算。实测全量语料 `quotes` 体积 **-82.7%**。详见 `bugs/bug-00010-quotes-payload-bloat.md`。
- **两份 schema 从此分叉**：改 `quotes` 契约须对账两处（本表 + `docs/sango-corpus-spec.md` §5）。

示例：

```json
[
  {
    "id": "sanguo-yanyi:0073:c0007",
    "text": "瑾曰：“特来求结两家之好……请君侯思之。”云长勃然大怒曰：“吾虎女安肯嫁犬子乎！……”",
    "chapter": 73,
    "title": "玄德进位汉中王　云长攻拔襄阳郡",
    "type": "narration",
    "segFrom": 5,
    "segTo": 5,
    "quoteBalanced": true,
    "quotes": [
      { "offset": 4, "len": 14 },
      { "offset": 30, "len": 12 }
    ]
  }
]
```

- **`chapter` / `title` 必须在条目级携带**：检索跨全库，单次召回的多条条目可来自**不同回**（top5 跨回是常态），出处只能逐条对应渲染，不能用文档级字段代替。语料文件本身仍按回分文件、`chapter` / `title` 存于**文档层**（见「数据位置」每回 JSON 结构），工具出参时把回级字段**随每条条目展开**。`source` 不在条目级重复（调用方入参已知）。
- 召回 chunk **自足**（本身可独立支撑作答，不依赖上下文）。
- 模型对召回片段**只归纳、不补全**：不得补充片段外的情节 / 细节 / 人名。

### 注入视图（服务端拼接，非工具出参）

`domain=sango-novel` 快路径下，服务端把召回 chunk 拼成**注入视图**放进 user 消息；工具出参字段（`id` / `segFrom` / `segTo` / `type` / `quoteBalanced` / 分数）不进模型上下文。

- **片段编号** `[片段N]`：N 从 1 起，为本次注入内序号；按相关度降序排列。
- **注入策略（2026-09-20 定稿）**：前 5 段**整段保底注入、不裁剪**（实测答案段约 78% 位于 top5，杜绝窗口裁剪把段尾答案句切掉）；第 6–10 段仅作**检索精度不足时的兜底**，按相关度降序、在总预算内依次整段纳入；**超预算丢整段、绝不在段内裁剪**（如第 6 段放不下则整体丢弃，不以半段形式注入）。
- **总预算**：注入视图全问约 **2000 字**封顶（前 5 段保底可软超；第 6+ 段吃剩余预算），控制输入 token 成本。
- **开关**（编排侧代码常量，不读配置文件）：`INJECT_TAIL_FALLBACK_ENABLED`，默认 **true**（前 5 段整段保底 + 第 6–10 段预算兜底）；置 **false** 时**固定只注入前 5 段整段**（关闭尾部兜底，用于让检索侧精度/排序问题显性化）。
- **引语标记** `⟨Qn⟩`：片段内每对引语前插入该标记（约 4~5 字）；`n` 为该引语**本次注入内的全局序号**，由服务端按出参 `quotes[]` 顺序重编号而来（出参不带 `qid`，见上「出参 `quotes[]` 与语料不同形」）。
- **不回目、不带段号、不带分数**（回目会污染人名断言扫描，如「三英战吕布」→ 吕布）：条目里的 `chapter` / `title` 只供**服务端组装 `citations`**（feat-A006），注入前剥离，不进模型上下文。

注入示意：

```
【已检索到的《三国演义》原文片段】
[片段1] 瑾曰：⟨Q1⟩“特来求结两家之好……请君侯思之。”云长勃然大怒曰：⟨Q2⟩“吾虎女安肯嫁犬子乎！……”
```

模型只输出「结论 + 指针」（约 20~30 字）：

```
关羽拒绝了孙权的联姻，回以[Q2]。
```

服务端按指针查本次注入的引语表（A006 渲染；引语文本由出参 `quotes[].offset` / `len` 从条目原文切片还原）：把模型输出的 `[Qn]` 指针替换为「引文」+ 全局上标角标（¹²³…，按出现顺序从 1 起），并把对应片段原文与回级 `chapter` / `title` 组装进 `data.citations`（第 1 条引用下标 0 → ¹）；`answer` 内不再内联出处。展示给用户：

```
关羽拒绝了孙权的联姻，回以「吾虎女安肯嫁犬子乎」¹。

对应 `data.citations` 含一条：`text` = 该片段原文（`云长勃然大怒曰：“吾虎女安肯嫁犬子乎！……”`）、`chapter` = 73、`title` = `玄德进位汉中王　云长攻拔襄阳郡`；完整形状与角标-下标对应规则见 `api/feat-A006-citation-display.md`。
```

### 无命中

工具正常返回（非异常）：

```
未召回任何原文段落
```

模型按「兜底」规则作答（见引用硬校验）：结论句 + 恰一条兜底片段，输出形状为 A006 结构化（`answer` 结论句带角标 ¹、`citations` 一条），由服务端从条目原文与 `chapter` / `title` 字段渲染。无原文可引用时不得编造。

### 非法 source 报错

| 层 | 行为 |
|----|------|
| 工具层 | `source` 非 `sanguo-yanyi` / `sanguozhi` → 工具抛错，错误信息「不支持的 source：{value}，本期仅支持 sanguo-yanyi」 |
| orchestrator 层 | 该错误经 MCP 工具调用失败路径 → agent 包装为 `ToolExecutionError` → `/api/chat` 返回 503「工具服务暂不可用，请稍后重试」（错误细节不外泄，沿用 feat-A001 约定） |

`sanguozhi` 虽在枚举中预留，本期**不可用于检索**：调用即按未支持处理（同上报错路径）；待后续特性实现后再开放。

## 引用硬校验（v1：只校验人名）

模型作答后校验「答案人物集合 ⊆ 召回人物集合」，不满足则按兜底重答。识别链**本地化（0 次 LLM）**：

1. **本地别名表 ID 扫描**：答案与召回中的名字先经 `alias.json` 归一到人物 ID，按 ID 比对（例：用户问「关羽」、答案写「云长」、召回含「关羽」→ 同 ID `P002`，视为命中）。扫描对象是模型输出的结论正文；引语与出处由服务端渲染、不进模型输出，故断言来源更干净（不再混入引语里的人名与回目名）。
2. **未命中 ID → 退化字符串包含**：别名表未收录的名字退化为字符串包含比对（名字出现在召回原文即通过）。
3. **指针校验**（与引用校验同层）：答案须含**合法指针**，指针 ∈ 本次注入的 qid 集合；非法（缺失 / 越界 / 不在本次注入集合内）即走兜底。
4. **长引语安全网**（与引用校验同层）：模型输出中出现超 **30 字**的 `「…」` 视为违规抄写，**丢弃该引语、改按引语表字段渲染**（引文由条目原文切片还原，角标并入 `data.citations`，见 `api/feat-A006-citation-display.md`「兜底路径」；把「省输出 token」从依赖 prompt 变为确定性回收）。

- v1 **人名校验只覆盖人名**：地名、事件名不校验，留待后续版本；第 3、4 条（指针校验 / 长引语安全网）属引用形式校验，与「只校验人名」的范围界定不冲突。
- **兜底输出格式**（校验不过或无召回时）——A006 结构化：`answer` 放结论句（带角标 ¹）、`citations` 恰一条兜底片段（整段、不裁剪；chunk 上限 400 字，天然防刷屏，禁止多段拼刷）；兜底片段 `text` 为该片段原文、`chapter` / `title` 引自回级字段，完整形状见 `api/feat-A006-citation-display.md`「兜底路径」。
- 数据依赖：校验读取 `mcp-server/sango/data/alias.json`（老陈构建期产出）；校验执行在 agent 作答路径（小胡落位，见「与小胡的接口边界」）。

## prompt 限定 6 条

sango RAG 域统一提示词（`UNIFIED_SYSTEM_PROMPT` 内，小胡编排措辞）限定以下 6 条不变量，不得增减、不得弱化：

1. **回答前必须先调 `sango_novel_search` 检索原文**（domain=sango-novel 快路径下系统已预先检索并注入片段，模型直接依据片段作答、不再调工具）。
2. **只依据工具返回的原文作答**：人物、情节、数字都必须能在原文里找到。
3. **人名一律以召回原文为准，不得替换或补别名**（不得凭空写出召回中不存在的人名）。
4. **原文无相关内容 → 答「演义中未涉及」**，禁止先验补全。
5. 不评价、不纠正、不对比：不提正史 / 影视 / 游戏，不得出现「实际是…」转折。
6. **回答格式固定**：先一句结论，后跟引语指针（如 `[Q2]`）；**不输出引语原文、不输出出处**（引用原文与出处由服务端渲染）。

第 1–3、6 条为硬性契约原文；第 4–5 条为本契约其他条款的直接转述，与小胡实现的硬校验一致。sango RAG 规则只影响《演义》原著域；天气 / 题库 / 自由作答域的既有规则（A003 已验证）不变。

## orchestrator transport 重构（多 server 注册表）

### 结构

- 由单 MCP server 改为**注册表**：`Map<serverName, Transport>`（或等价结构），weather 与 sango 各一条 stdio 子进程。
- 每个注册项独立管理连接生命周期：启动时拉起子进程、失败互不影响（weather 挂了不影响 sango，反之亦然）。
- 工具 → server 归属表（显式映射，或由各 server 上报工具名后按名称反查）：

  | 工具 | 归属 server |
  |------|-------------|
  | `get-forecast` / `get-alerts` | weather |
  | `sango_novel_search` | sango |

- 现有 weather 单 server 逻辑收敛为注册表中的一个 entry：天气场景行为不变，需回归验证（feat-A001/A003）。

### GET /api/tools

- 合并上报：weather 工具 + sango 工具 + 本地工具（`sango_query`）。返回结构不变（`data.tools`，元素 `name` / `description` / `inputSchema`）。
- 缺配 / 启动失败的 server 不进入注册表 → 该 server 的工具不可见（`listTools()` 正常返回其余 server 工具）；全部 server 均不可用时 `Agent.listTools()` 抛错 → 503「MCP Server 未连接」（沿用 A003）。

```json
{
  "code": 200,
  "data": {
    "tools": [
      { "name": "get-forecast", "description": "获取美国境内某个经纬度位置的天气预报……", "inputSchema": { "type": "object" } },
      { "name": "get-alerts", "description": "获取美国某个州的当前天气预警……", "inputSchema": { "type": "object" } },
      { "name": "sango_novel_search", "description": "检索《三国演义》原著原文段落……", "inputSchema": { "type": "object", "properties": { "source": { "type": "string", "enum": ["sanguo-yanyi", "sanguozhi"] }, "query": { "type": "string" }, "limit": { "type": "integer" } } } },
      { "name": "sango_query", "description": "风云三国题库检索……", "inputSchema": { "type": "object" } }
    ]
  },
  "message": ""
}
```

### POST /api/chat

- 请求体沿用既有白名单 `{ message, domain }`（字段集保持不变）；`domain` 取值扩展为 `sango`（风云三国题库，硬锁题库域）/ `sango-novel`（三国演义原著解读，软性域提示）/ 缺省（模型语义自主路由），其余值 400。
- 响应 `data` 统一为 `{ answer, citations }`（`citations` 为 feat-A006 新增，字段只增不减、无引用时恒 `[]`；口径见 `api/feat-A006-citation-display.md`）。
- 工具调度由模型按语义决定：sango 域命中 → 调 `sango_novel_search`；天气 → 天气工具；题库 → `sango_query` / `/api/sango/random`。`domain=sango-novel` 时追加「三国演义原著解读」域提示（软性：问候 / 天气等非原著问句仍按自由对话处理，不硬锁）。
- **快路径（`domain=sango-novel`，确定性优先）**：服务端先调 `sango_novel_search(source=sanguo-yanyi, query=白话问句, limit=10)` → 取结构化条目 → 按「注入视图」策略拼接（**top5 整段保底不裁剪 + 第 6–10 段预算兜底**；片段编号 `[片段N]` + 引语标记 `⟨Qn⟩`，**不回目、不带段号、不带分数**）注入 user 消息（【已检索到的《三国演义》原文片段】）→ 从可用工具中移除 `sango_novel_search` → 单次 LLM 生成（避免多轮 tool-use 的 2+ 次串行调用；注入全问约 2000 字封顶）→ 本地引用校验 + 指针校验（+ 长引语安全网）→ 服务端按指针把引文 + 角标拼入 `answer`、组装 `citations`（A006）→ 兜底。LLM 调用次数由 2+ 次降为 1 次。
- 错误语义同 A003：`ToolExecutionError` → 503；其余 → 500；本地工具失败不包装 → 500。
### 注册表配置（环境变量）

| 环境变量 | 必填 | 说明 |
|----------|------|------|
| `MCP_WEATHER_SCRIPT` | 是 | weather server 入口脚本绝对路径（子进程命令 `node <script>`）；唯一来源，不再支持 `MCP_SERVER_SCRIPT` / CLI 参数 |
| `MCP_SANGO_SCRIPT` | 否 | sango server 入口脚本绝对路径；缺配 → sango 不可用 |

- orchestrator 启动：根目录 `npm run dev`（先 build 后起 Web 服务，监听 3000），无参数；CLI 交互用 `npm start`。
- weather 与 sango 各为一个独立 stdio 子进程（`node <script>`），各自独立 MCP Client、独立启动、独立失败；weather 必需（未配置 → 启动报错退出），sango 可缺配。
- 缺配 `MCP_SANGO_SCRIPT`（或 sango 启动失败）→ 该 server 不可用：`GET /api/tools` 不含 `sango_novel_search`；模型调用 `sango_novel_search` → transport 按工具名查不到归属 → 报错 → agent 包装为 `ToolExecutionError` → `/api/chat` 503（错误语义不变，不按工具名分支、不解析 error.message）。

### 技术要点（老陈实现侧）
- transport 侧 `callTool(toolName, args)` 改为按归属表先定位 server 再转发；`listTools()` 合并各 server 结果。
- 保持 A003 的 `Agent.listTools()` 同源约束（上报的能力 = 模型可见的能力）。
- 错误判定不变：MCP 工具失败（含 `sango_novel_search` 非法 source）→ `ToolExecutionError` → 503；不按工具名分支、不解析 error.message。

### 与小胡的接口边界（agent.ts / prompt）

| 契约 | 写在哪里 | 谁写 | 老陈的依赖方式 |
|------|----------|------|----------------|
| prompt 限定 6 条（sango RAG 域，第 6 条为「结论 + 引语指针」） | `UNIFIED_SYSTEM_PROMPT` 内 | 小胡编排措辞，本文档「prompt 限定 6 条」为不变量 | 老陈不复制提示词文本，只读不变量 |
| 引用硬校验（答案人物 ⊆ 召回人物，本地别名表扫描 + 指针校验 + 长引语安全网） | agent 作答路径 | 小胡 | 校验读取老陈产出的 `alias.json` |
| `answer` 引文 + 角标拼装、`citations` 组装（A006） | agent 作答路径 | 小胡（编排）/ 老陈（`quotes[]` + `chapter` / `title` 字段产出） | 字段口径见「输出（命中）」、`docs/sango-corpus-spec.md` §5 与 `api/feat-A006-citation-display.md` |
| `alias.json`（人名 → ID，P001 起按规范名去重，关羽 → P002） | `mcp-server/sango/data/alias.json` | 老陈（构建期产出） | 小胡按「数据位置」格式读取 |

## 路由归属（模型自主决定，不由请求字段决定）

| 用户输入语义 | 期望行为 | 验收 |
|--------------|----------|------|
| 《三国演义》原著情节 / 人物 / 事件问句（如「温酒斩华雄的原文」） | `domain=sango-novel` 快路径：服务端预先调 `sango_novel_search(source=sanguo-yanyi, query=白话问句)` 并按「注入视图」注入片段 → 单次 LLM 生成；基于召回原文归纳作答、输出引语指针，引用与出处由服务端渲染 | ① |
| 风云三国题库 / 「随机一题」（游戏招募武将题） | 不调 `sango_novel_search`，走 `sango_query` 或 `/api/sango/random`（D3：两工具隔离，互不混用） | ② |
| 美国天气 / 地铁出行 | 不调 `sango_novel_search`，调天气工具 | ③ |
| 三国史实 / 《三国志》内容 | 不调（`sanguozhi` 本期预留），明确告知本期仅支持《三国演义》原著检索，不编造 | ④ |
| 其余问题（含「你好」） | 不调任何工具，自由作答 | ⑤ |

`source` 是 `sango_novel_search` 的入参（大模型调度时给定），不是 HTTP 路由字段；`/api/chat` 请求体无路由字段可传。

## mcp-web 对接说明（小叶）

- **本期前端需改动**：聊天页模式标签「天气 / 风云三国」旁新增「三国演义」；选中后请求 `POST /api/chat` 携带 `domain: "sango-novel"`，输入区显示「三国演义」标识（`res.code === 200` 用 `res.data.answer`，否则展示 `res.message`，信封处理不变）。
- 「风云三国」标签行为不变：问题查询 → `domain: "sango"`；随机一题 → `/api/sango/random`。
- `/api/tools` 返回的工具列表新增 `sango_novel_search`；如前端展示工具列表，按 `name` 自行过滤或原样展示（顺序不保证）。
- **展示位拆分已由 A006 结构化**（见 `api/feat-A006-citation-display.md`）：引用原文入 `data.answer` 内联（服务端拼「引文」+ 全局上标角标 ¹²³…，前端零解析），出处下沉 `data.citations`（前端据此渲染引用出处卡片区）；前端单一渲染路径，沿用 `res.data.answer` 纯文本展示、按需读取 `res.data.citations` 画卡片，不解析角标。
- 无新增端点。
- 上线顺序：orchestrator transport 重构属后端部署变更，需确认 weather + sango 两进程均已配置后发布；HTTP 前端改动可与后端同时或先后发布。
## 破坏性变更说明

| 层 | 变更 | 影响 |
|----|------|------|
| mcp-orchestrator（transport） | 单 server → 多 server 注册表 | 后端内部重构；部署需同时配置 weather + sango 两个 MCP 子进程（.env 注册表 MCP_WEATHER_SCRIPT / MCP_SANGO_SCRIPT），orchestrator 以 `npm run dev` 无参启动 |
| mcp-server | 新增独立 server「sango」 | weather 不动，无破坏 |
| mcp-server | `sango_novel_search` 出参由「单条拼接文本块（含【出处】头）」改为「结构化条目数组（`id` / `text` / `type` / `segFrom` / `segTo` / `quoteBalanced` / `quotes[]`）」 | MCP 工具层契约变更；消费方为 orchestrator（小胡编排路径），HTTP 层不受影响 |
| mcp-server | `quotes[]` 出参由 `{qid,text,offset,speaker}` 瘦身为 `{offset,len}`（bug-00010，2026-09-21） | MCP 工具层契约变更（引语文本由条目原文切片还原，用户可见引用不变）；消费方仅 orchestrator，HTTP / 前端不受影响 |
| HTTP /api/chat | 请求体字段不变；响应 `data` 统一 `{ answer, citations }`（`citations` 由 A006 新增） | 无破坏（字段只增不减，旧前端忽略 `citations` 照常工作） |
| HTTP /api/tools | 工具列表新增 `sango_novel_search` | 语义新增，非破坏；前端按需适配展示 |
| mcp-web | 新增「三国演义」标签；`/api/chat` 请求携带 `domain=sango-novel` | 语义新增，非破坏；需前端发版 |

## 验收标准对照

| # | 验收标准 | 契约落点 |
|---|----------|----------|
| ① | 《演义》原著问句 → `domain=sango-novel` 快路径：服务端预先调 `sango_novel_search(source=sanguo-yanyi)` 并注入片段，单次 LLM 生成（agentic 路径先检索后作答） | 「POST /api/chat」快路径 + prompt 第 1 条 |
| ② | 工具输出 = 结构化条目数组（`id` / `text` / `chapter` / `title` / `type` / `segFrom` / `segTo` / `quoteBalanced` / `quotes[]{offset,len}`），文本内无出处头、无回目 / 段号 / 类型 / 分数；按相关度排序、limit 生效 | 「输出（命中）」+ `docs/sango-corpus-spec.md` §5 |
| ③ | 无命中 → 「未召回任何原文段落」，模型走兜底（A006 结构化：结论句 + 恰一条兜底片段） | 「无命中」+ 「引用硬校验」兜底 |
| ④ | 非法 source → 工具报错 → /api/chat 503 | 「非法 source 报错」+ 错误语义 |
| ⑤ | /api/tools 合并 weather + sango + 本地工具 | 「GET /api/tools」示例 |
| ⑥ | /api/chat 请求体字段不变、响应 data 统一 { answer, citations }（字段只增不减，无引用 citations 恒 []）；`domain` 支持 sango / sango-novel | 「POST /api/chat」+ `api/feat-A006-citation-display.md` |
| ⑦ | 答案人物集合 ⊆ 召回人物集合（v1 人名，本地别名表扫描；扫描对象为模型结论正文） | 「引用硬校验」+ alias.json 规则 |
| ⑧ | prompt 限定 6 条（第 6 条：结论 + 引语指针，不输出引语原文与出处） | 「prompt 限定 6 条」 |
| ⑨ | 统一信封 | 全部成功 / 错误示例均为 `{ code, data, message }`，失败 `data` 为 `null` |
| ⑩ | 数据管线可跑：corpus / vectors / alias.json 齐全，线上只读 | 「数据位置」+「语料与向量构建管线」 |
| ⑪ | 小叶可仅据此文档开发前端 | 全部 HTTP 契约集中于本文档；`domain` 取值与「三国演义」标签行为见「mcp-web 对接说明」 |
| ⑫ | 指针校验：答案须含合法指针且 ∈ 本次注入的 qid 集合，非法即走兜底 | 「引用硬校验」第 3 条 |
| ⑬ | 长引语安全网：模型输出中超 30 字的 `「…」` 视为违规抄写，丢弃并替换为字段渲染结果 | 「引用硬校验」第 4 条 |
| ⑭ | 服务端渲染（A006）：`[Qn]` 指针替换为引文 + 全局上标角标拼入 `answer`，对应片段原文 + `chapter` / `title` 组装 `data.citations`，不展示段号 | 「注入视图」+ `api/feat-A006-citation-display.md` |
