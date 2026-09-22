# feat-A010: 原文查看（A4 阅读器）+ 日志页筛选增强 —— 接口文档

> 作者：老陈
> 对应特性号：feat-A010
> 故事号：story-A010-02
> 涉及项目：mcp-orchestrator（总台）、mcp-server（器坊）、mcp-web（小叶对接）
> 日期：2026-09-22
> 前置：feat-A004（sango RAG / chunk schema v2 / chunkId / 回目来源）、feat-A007（日志查询接口 / 分页约定 / 主表 `domain` 列）、feat-A009（候选分数表 `chunkId` 列 / `transport.callTool` 直调路径）、feat-A006（citations 形状 `{text, chapter, title}`）

## 概述

给「原文查看」提供两条数据通路，并补齐日志页「项目」筛选：

- **总台 `GET /api/v1/logs` 增 `domain` 过滤参数**：与既有过滤条件同层叠加；`domain` 为空的历史记录只在「全部」出现。
- **总台新增 `GET /api/v1/sango/chapters/:chapter`**：整回原文 + 相邻回标题一次返回（25~38KB，不分页），供 A4 阅读器渲染与上下回跳转按钮。
- **器坊新增 MCP 工具 `sango_novel_chapter`**：按回取 chunks，复用现有语料加载路径，不新建索引；**该工具对模型不可见**（总台白名单过滤，后台 HTTP 直调不受影响）。
- **组件入参契约对齐**：`chapter` / `chapterTitle` / `chunkId` 三项入参与接口返回的对应关系、打开即定位的数据时序、聊天侧 `citation.text` 精确匹配定位（`citations[]` 零契约变更）。

数据链路：前厅 → 总台 HTTP → 器坊 MCP 工具（feat-A004 约定「orchestrator 不读器坊语料目录」本特性沿用）。

## 一、`GET /api/v1/logs` 增 `domain` 过滤参数（总台）

### 1.1 参数与行为

列表接口新增查询参数 `domain`，与既有参数（`logType` / `startAt` / `endAt` / `traceId` / `keyword` / `status` / `responseCode`）**同层叠加**（AND），不改变列表项结构。

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `domain` | string | 否 | 项目过滤。枚举：`weather` / `fengyunsanguo` / `sango-novel` |

**空值行为**：未传 / 空字符串 / 纯空白 → 视同未传（不过滤，等价「全部」），与既有 `parseQueryString` 口径一致（trim 后为空 → undefined）。

**非法值行为**：非枚举值 → `400`，`message` 原文固定为 `domain 只支持 weather/fengyunsanguo/sango-novel`。

**`domain` 为空的记录**（主表 `domain IS NULL`，历史记录）：只在「全部」出现。选中任一具体 `domain` 时这类记录不返回；不单列「未知」选项（需求非目标）。

**存储层**：`ListQuery` 增 `domain?: string`，`queryList` 拼条件时选中值追加 `AND domain = ?`；不选中则不追加。列表项 `domain` 字段维持现状（空显示 `—`）。

### 1.2 请求 / 响应示例

```http
GET /api/v1/logs?domain=sango-novel&logType=chat&pageNo=1&pageSize=20
```

```json
{
  "code": 200,
  "data": {
    "list": [
      {
        "traceId": "dc1b7b5b-2db8-4288-ba06-f4711e0b7a30",
        "logType": "chat",
        "userInput": "关羽千里走单骑的经过",
        "domain": "sango-novel",
        "status": "success",
        "responseCode": 200
      }
    ],
    "total": 1,
    "pageNo": 1,
    "pageSize": 20
  },
  "message": ""
}
```

### 1.3 错误

| code | 场景 | message 原文 |
|------|------|-------------|
| 400 | `domain` 非枚举值 | `domain 只支持 weather/fengyunsanguo/sango-novel` |
## 二、`GET /api/v1/sango/chapters/:chapter`（总台新增）

### 2.1 请求

| 部分 | 说明 |
|------|------|
| 方法 / 路径 | `GET /api/v1/sango/chapters/:chapter` |
| 路径参数 | `chapter`：回号，1~120 的整数 |
| Query / Body | 无 |

本接口**不走分页信封**：`data` 直接为原文对象（需求：单回 25~38KB 整回返回、不分页）。

### 2.2 成功响应

```json
{
  "code": 200,
  "data": {
    "chapter": 73,
    "title": "玄德进位汉中王　云长攻拔襄阳郡",
    "prev": { "chapter": 72, "title": "诸葛亮智取汉中　曹阿瞒兵退斜谷" },
    "next": { "chapter": 74, "title": "庞令明抬榇决死战　关云长放水淹七军" },
    "chunks": [
      {
        "chunkId": "sanguo-yanyi:0073:c0001",
        "text": "却说曹操退兵至斜谷……",
        "type": "narration",
        "segFrom": 1,
        "segTo": 1
      }
    ]
  },
  "message": ""
}
```

**字段口径**：

| 字段 | 类型 | 说明 |
|------|------|------|
| `chapter` | number | 当前回号（= 请求参数） |
| `title` | string | 当前回目 |
| `prev` | object / null | 上一回 `{ chapter, title }`；第 1 回恒为 `null` |
| `next` | object / null | 下一回 `{ chapter, title }`；第 120 回恒为 `null` |
| `chunks[]` | array | 本回全部 chunk，按语料文件内顺序返回 |
| `chunks[].chunkId` | string | `{source}:{回号4位补零}:c{回内序号4位补零}`，与日志页候选分数表 `chunkId` 同口径（示例 `sanguo-yanyi:0073:c0007`） |
| `chunks[].text` | string | chunk 纯原文（schema v2，不含出处 / 回目 / 段号 / 类型） |
| `chunks[].type` | string | `narration` / `verse` / `comment`（叙述 / 诗赞 / 评注） |
| `chunks[].segFrom` | number | 起始段号（1 起） |
| `chunks[].segTo` | number | 结束段号；跨段 chunk 时 `segFrom != segTo` |

> `prev` / `next` 由器坊按回目数据计算（见 §3.2），供前端按钮直接显示相邻回标题，**不必为拿标题再请求一次**（需求「避免为拿标题多拉一次全文」）。

### 2.3 错误码与 message 原文

| code | 场景 | message 原文 |
|------|------|-------------|
| 400 | `chapter` 非 1~120 整数（非数字 / 小数 / 负数 / 0 / 越界 / 空） | `chapter 只支持 1~120 的整数` |
| 404 | 回号合法但该回语料不存在（器坊返回 `第 N 回原文不存在`） | `第 {N} 回原文不存在` |
| 503 | MCP 工具调用失败（`ToolExecutionError`：MCP 未连接 / 子进程退出 / 协议错误 / 器坊启动即失败） | `工具服务暂不可用，请稍后重试` |
| 500 | 其余处理失败（器坊返回内容解析失败等） | `处理请求失败，请稍后重试` |

**判定顺序**（总台路由层）：
1. 入口校验 `chapter`（`/^\d+$/` 且 `1 <= n <= 120`），不过则 `400`，**不调用器坊**。
2. `transport.callTool` 抛 `ToolExecutionError` → `503`。
3. 器坊返回 `isError` 且 `message` 含「不存在」→ `404`，透传器坊 message（`第 {N} 回原文不存在`）。
4. 其余异常 / 内容解析失败 → `500`。

### 2.4 实现路径（HTTP → MCP 直调）

- 总台新增 `src/api/v1/sango.ts`（`createSangoApi(transport)`），`server.ts` 挂载 `app.use('/api/v1/sango', ...)`，与 `/api/v1/logs` 并列。
- 处理器经 `transport.callTool('sango_novel_chapter', { chapter })` **直调器坊**：与 feat-A009 诊断旁路同路径，**不经 agent、不经模型工具装配，因此不受白名单过滤影响**。
- 解析器坊返回 `content[0].text`（JSON 字符串）→ 直接作为 `data` 包 `{ code, data, message }` 信封返回（器坊出参已含 `prev/next`，见 §3.1）。
- 本接口自身不落日志（同 `/api/v1/logs*` 防递归口径）。

## 三、MCP 工具 `sango_novel_chapter`（器坊）

### 3.1 工具定义与出参

| 字段 | 值 |
|------|-----|
| 工具名 | `sango_novel_chapter` |
| 入参 | `{ chapter: number }`，zod schema `z.object({ chapter: z.number().int().min(1).max(120) })` |
| 返回 | `content[0].text` 为 JSON 字符串：`{ chapter, title, prev, next, chunks[] }`（与 `sango_novel_search` 同「JSON 字符串进 content」模式） |

出参字段口径与 §2.2 完全一致（`chunkId` / `text` / `type` / `segFrom` / `segTo`）。注意：语料 schema v2 的字段名为 `id`，**出参按契约名 `chunkId` 输出**（同一值：`{source}:{回号4位补零}:c{回内序号4位补零}`）。

> **相对需求「接口影响」表的一处扩展（Coco 已确认 2026-09-22）**：需求表工具返回记为 `{ chapter, title, chunks[] }`；本契约工具出参**增加 `prev` / `next`**。理由：HTTP 契约需要相邻回标题（§2.2），而相邻回目数据只有器坊持有（总台不读语料目录），由器坊出参携带成本最低（§8.5）。

### 3.2 复用现有语料加载路径

- 不新建索引、不改语料：`SangoIndex.load()` 已按 `data/corpus/sanguo-yanyi/001.json .. 120.json` 全量加载（schema v2 校验同检索路径）；新增 `getChapter(chapter)` 按回取已加载数据（chapter / title / chunks 原样），相邻回标题同样取自已加载回目。
- 工具注册：`registerSangoNovelChapter(server.registerTool.bind(server), index)`，与 `registerSangoNovelSearch` 同模式、独立文件。
- 工具不产出 `_meta.diagnostics`（非检索工具，feat-A009 诊断仅检索链路）。

### 3.3 错误处理

- `chapter` 越界 / 非整数 → zod 入参校验失败（isError，SDK 生成 message）。
- 回号合法但该回语料缺失（文件不存在 / `chunks` 为空）→ `throw new Error(\`第 ${chapter} 回原文不存在\`)`（isError）。
- 语料整体未加载（器坊启动即失败）→ 进程退出，总台侧表现为 `ToolExecutionError` → HTTP `503`。

### 3.4 与既有检索工具的关系

| 工具 | 归属 | 模型可见 | 用途 |
|------|------|----------|------|
| `sango_novel_search` | 器坊（既有） | **是** | 检索召回 |
| `sango_novel_chapter` | 器坊（新增） | **否**（§四） | 按回取整回原文，后台直调 |
## 四、模型可见工具白名单（硬约束）

### 4.1 问题定位

模型可用工具取自 `agent.ts:804`（`this.options.tools ?? (await this.transport.listTools())`），`listTools()`（`agent.ts:419`，供 `/api/tools`）同源。器坊注册 `sango_novel_chapter` 后会被 `transport.listTools()` 自动带进模型上下文，模型会拿它当检索用（拉整回原文、烧 token）。

### 4.2 方案：常量白名单 + 装配处过滤

- 总台新增常量 **`MODEL_VISIBLE_TOOLS: string[]`**（模型可见工具白名单），**登记对象 = 工具定义清单**：MCP 工具（`transport.listTools()` 返回的 `MCPToolDefinition`）+ 由 `options.tools` 注入的本地工具定义——工具定义只来自 `options.tools ?? transport.listTools()`（`agent.ts:804`）。
  **不是 `options.localTools` 的 key**：`localTools`（`agent.ts:240` / `820`）是「工具名 → 处理器」的派发映射，只决定「模型调用某工具时走本地实现还是 MCP 转发」，不产出工具定义，无需登记、也不得作为登记来源。
- 初始值 = 当前模型可见工具定义全集（story-A010-03 按现状 `/api/tools` 实际输出核对登记）：
  - `get-alerts` / `get-forecast`（天气）
  - `fengyunsanguo_query` / `fengyunsanguo_quiz_command` / `fengyunsanguo_quiz_route`（风云三国）
  - `sango_novel_search`（演义检索）
  - **不包含** `sango_novel_chapter`
- 过滤点收敛到一处：agent 新增私有方法统一取模型可见工具，`agent.ts:804` 与 `agent.ts:419` 两处均改调它：

  ```ts
  private async resolveModelTools(): Promise<MCPToolDefinition[]> {
    const tools = this.options.tools ?? (await this.transport.listTools());
    return tools.filter((t) => MODEL_VISIBLE_TOOLS.includes(t.name));
  }
  ```

- `options.tools` 非空（测试 / 装配注入）时同样过白名单，保证「模型可见 = 白名单」恒成立。
- 白名单外的工具名直接过滤，不报错（防误配影响可用性）。

**不动 `/api/chat` 业务逻辑**：过滤只发生在工具解析处（804 / 419），agent 循环内快路径、`localTools` 分支（`agent.ts:820`）零改动。

**不引入新抽象层**：一个常量数组 + 一个 `filter`，不建 wrapper / proxy / 独立调用通道。

**后台 HTTP 通道直调不受影响**：§2.4 的路由直接 `transport.callTool('sango_novel_chapter', ...)`，不经 `resolveModelTools()`。

### 4.3 为什么选白名单（而非黑名单）

- 黑名单漏配即泄露：新增工具默认可见，靠「记得拉黑」不可靠。
- 白名单默认安全：新增工具默认不可见，需显式登记才暴露给模型；工具总量个位数，登记成本低。
- 最小可扩展：新增**后台专用**工具 → 器坊注册即可，白名单零改动；新增**模型可见**工具 → 白名单加一行。
- `/api/tools` 与模型可见性天然同源：`listTools()` 改走 `resolveModelTools()` 后，上报的即模型实际可见清单，`sango_novel_chapter` 不会出现在 `/api/tools`。

## 五、组件入参契约对齐（前厅）

### 5.1 入参与接口返回对应

| 组件入参 | 必填 | 来源 / 对应接口字段 | 说明 |
|----------|------|---------------------|------|
| `chapter` | 是 | `GET /api/v1/sango/chapters/:chapter` 路径参数 | 回号 1~120 |
| `chapterTitle` | 否 | `data.title` | 接口必然返回 `title`；入参仅用于接口返回前的占位显示（避免标题闪烁），拿不到就不传 |
| `chunkId` | 否 | `data.chunks[].chunkId` | 传入则滚动定位并高亮该片段；不传则停正文顶部 |
| `showFooter` | 否 | 无对应接口字段 | 纯前端展示开关：默认 `true`；传 `false` 不渲染底部区域（「上一回/下一回」+ 回号跳转）。聊天页「查看原文」入口传 `false`，日志页入口不传 |

### 5.2 打开即定位的数据时序

1. 调用方以入参打开组件（`chapter` / `chapterTitle` / `chunkId` / `showFooter`；打开方式 / 关闭回调由小叶自定，`v-model:open` 或 `open()` 均可）。
2. 组件渲染：有 `chapterTitle` 先占位显示标题，正文区 loading。
3. 组件经**共享按回缓存**取数据：缓存命中 → 直接用；未命中 → `GET /api/v1/sango/chapters/:chapter` 请求，成功后写入缓存（key = `chapter`）。
4. 数据就绪 → 渲染标题 + 正文 chunks（片段号列显示 chunkId 尾段短号，如 `c0021`；整串 chunkId 与段号不进正文）。
5. 定位：传入 `chunkId` 且在 `chunks[]` 中命中 → `scrollIntoView` + 高亮该片段；传入但未命中（不属于该回）→ 停正文顶部，不报错；未传 → 停正文顶部。

### 5.3 聊天侧定位（`citation.text` 精确匹配）

- 入口：三国演义模式引用卡片原文末尾「查看原文」按钮（引用卡片本体不做点击入口）。
- 定位口径：用 `citation.text` 与整回原文**精确匹配** —— `chunks[].text.includes(citation.text)` 命中该 chunk，取其 `chunkId` 传入组件。
  - 同回内两 chunk 文本完全相同（重叠 0，概率极低）→ 落到第一处。
  - 匹配不到 → 不传 `chunkId`，停在正文顶部，不报错。
- **零契约变更**：`citations[]` 维持 `{ text, chapter, title }`（feat-A006 形状），**不加 `chunkId`**。
- 数据时序：点击「查看原文」→ 读共享按回缓存（未命中则请求）→ 匹配 `chunkId` → 以 `{ chapter, chapterTitle: citation.title, chunkId? }` 打开组件 → 组件读缓存渲染（**不重复请求**）→ 定位。

### 5.4 日志页入口

- 入口：日志详情「候选分数表」`chunkId` 列点击（feat-A009 `diagnostics.candidates[].chunkId`）。
- 入参：`chapter` 直接取该行 `candidates[].chapter`（A009 诊断已含回号，**不依赖 chunkId 字符串解析**）；`chapterTitle` 取 `candidates[].title`（有则传，无则不传）；`chunkId` 取该行 `chunkId`。
- 5a：候选分数表末尾新增「操作」列「复制」按钮，复制该行完整 chunkId（有成功反馈），**不打开阅读器**（前端行为，无接口变更）。

### 5.5 同回缓存

- 按回缓存：`Map<chapter, Promise<data>>`（模块级共享，聊天页匹配与组件渲染共用），同回重复打开不重复请求；不同回各自请求；不预取相邻回。
- 缓存失败结果不写入；请求失败展示错误，不缓存。
- 本期无主动失效（语料只读、服务端数据稳定）；如需失效另开票。
## 六、前端对接章节（小叶）

- 组件：`src/components/SangoChapterReader.vue`，两处入口复用同一组件、入参一致（§5.1；聊天页入口 `showFooter: false`，纯前端展示开关，与接口无关）。
- 无路由变更；打开方式 / 关闭回调按 §5.2 自行决定。
- A4 观感（210mm 纸宽 + 纸面阴影 + 衬线正文 + 长纸滚动）、底部上一回 / 下一回 / 按回号跳转（1~120，越界提示不跳转）、片段号短号列等为前端实现细节，见前端 design 文档。
- 底部「上一回 {标题}」/「下一回 {标题}」直接使用 `data.prev` / `data.next`；第 1 回 / 第 120 回对应按钮禁用（接口侧 `prev` / `next` 为 `null`）。
- 日志页：项目筛选下拉（全部 / 天气 / 风云三国 / 三国演义 → 不传 / `weather` / `fengyunsanguo` / `sango-novel`），重置按钮一并清空 `domain`；「操作」列复制 traceId 与复制 chunkId 均为前端行为。

## 七、接口侧验收清单（覆盖需求「验收标准」14 条）

| # | 需求条目 | 是否涉及接口 | 验证方法 |
|---|----------|--------------|----------|
| 1 | 项目筛选（全部 / 天气 / 风云三国 / 三国演义） | 是 | 分别请求 `GET /api/v1/logs?domain=weather` / `fengyunsanguo` / `sango-novel`，断言 `list` 与 `total` 只含对应 `domain` 记录；抽查响应每行 `domain` 字段与筛选值一致（与「域」列自洽）；不传 `domain` 返回全量 |
| 2 | 与既有条件叠加、重置清空 | 是 | 组合 `domain` + `logType` / `startAt` / `endAt` / `traceId` / `keyword` / `status` / `responseCode` 各组合请求，断言过滤条件 AND 生效；重置 = 前端不传 `domain`（接口侧验证缺省返回全量） |
| 3 | 复制 traceId 后精确命中 | 部分 | 前端剪贴板行为；接口侧复用既有 `traceId` 精确查询（`GET /api/v1/logs?traceId={id}` 命中该条） |
| 4 | 「操作」列不破坏列宽 / 横向滚动 | 否 | 前端（`scroll.x` 调整），接口列表项结构不变，无需接口验证 |
| 5 | 日志页候选分数表 `chunkId` 可点击，打开阅读器定位高亮 | 是 | 抽样真实 trace：`GET /api/v1/sango/chapters/{chapter}` 返回 `chunks[].chunkId` 与候选分数表 `chunkId` 一致（同口径），`text` 完整；前端滚动定位 + 高亮 |
| 5a | 候选分数表「操作」列复制完整 chunkId | 否 | 前端（复制按钮 + 成功反馈），接口不变 |
| 6 | 聊天页「查看原文」用 `citation.text` 定位 | 是 | 抽样真实 trace：`citations[].text` 能被对应回 `chunks[].text` 包含（`includes` 命中）；构造匹配不到用例 → 不传 `chunkId` 停顶部不报错 |
| 7 | A4 观感 | 否 | 前端视觉验收 |
| 8 | 片段号短号（`c0021`）与候选分数表一一对应 | 是 | 抽样：接口 `chunks[].chunkId` 尾段（`c\d{4}`）与候选分数表短号一致；前端正文只渲染短号 |
| 9 | 上一回 / 下一回按钮标题、第 1 / 120 回禁用 | 是 | `GET /api/v1/sango/chapters/1` → `prev=null`、`next={2,title}`；`/120` → `next=null`、`prev={119,title}`；中间回 `prev/next` 标题与语料回目一致 |
| 10 | 按回号跳转 1~120、越界提示 | 是 | `chapter=1`、`120` → 200；`0` / `-1` / `121` / `abc` / `1.5` → 400 且 `message` 为 `chapter 只支持 1~120 的整数`；前端越界提示不跳转 |
| 11 | 传 `chunkId` 打开即定位；未传停顶部 | 是 | 接口数据完整（`chunks[]` 按序、`chunkId` 可命中）；前端时序见 §5.2；传入不存在 `chunkId` → 停顶部不报错 |
| 12 | 两处入口同一组件、入参一致 | 部分 | 前端代码审查（同一组件、同一套入参，仅 `showFooter` 取值不同）；接口侧保证两入口所需字段同一契约（§5.3 / §5.4） |
| 13 | 同回重复打开不重复请求；本地首次打开 < 1s | 是 | 前端按回缓存（§5.5）；接口侧验证单回响应体 25~38KB、整回返回不分页（`data` 非分页信封） |
| 14 | 旧「chunkId 纯文本」渲染路径清理，文档同步 | 否 | 代码审查（无孤儿代码）+ 本文档与需求 / 前端 design 同步 |

## 八、风险 & 开放问题落实

1. **模型可见工具白名单落地方式** → **结论**：总台常量白名单 + 装配处过滤（§4.2），后台 HTTP 直调不受影响（§2.4）；不采用独立调用通道（多一套链路、无收益）。
2. **`citation.text` 匹配定位** → `includes` 精确匹配，同回两 chunk 文本完全相同落到第一处；匹配不到停正文顶部（需求已定口径）。
3. **数据量（25~38KB / 回）** → 整回一次返回、不分页；前端按回缓存兜住并发打开。
4. **卡片角标未入契约（已知约束）** → 记明：回答正文 `¹` 由总台渲染（`citation.ts:482 renderAnswerWithCitations`），引用卡片左上角 `¹` 由前厅复算（`WeatherView.vue:52 buildCitationGroups` 按 `toSuperscript(index+1)`），总台不下发该字段、`citations[]` 契约无角标字段，两边靠复算对齐；阅读器弹框内不渲染引用角标。如需修另开票。
5. **工具出参相对需求表扩展 `prev/next`** → **Coco 已确认（2026-09-22）**，契约以 §3.1 为准；需求文档「接口影响」表由 Coco 同步。

## 待落实细节

- [x] 白名单机制（§4 定稿：常量白名单 + `resolveModelTools()` 单点过滤）。
- [x] `domain` 过滤与存储层增量（`ListQuery.domain` + `AND domain = ?`）。
- [x] **工具出参含 `prev/next`（§3.1）**：Coco 已确认（2026-09-22）；需求文档「接口影响」表由 Coco 同步。
- [x] 白名单初始值已按当前 `/api/tools` 实际输出核对登记（§4.2，story-A010-03 回填）。


