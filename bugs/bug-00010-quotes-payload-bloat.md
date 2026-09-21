# bug-00010：演义检索工具出参 quotes[] 重复携带原文子串，响应 / 落库日志体积激增

> Bug 号：bug-00010
> 状态：修复中（2026-09-21 已实现 + Coco 审查通过，已提测；分支仅本地，推送被网络阻断）
> 关联特性：feat-A004（quotes 语料 schema / 引用链路）
> 涉及项目：mcp-server（sango 检索出参）、mcp-orchestrator（编排透传 / 落库）
> 登记：负责人 ／ 报告：负责人 ／ 登记日期：2026-09-21
> 决策（2026-09-21 负责人拍板）：**当 bug 修**，排期在 feat-A008 结束后启动；修复走候选 1（契约瘦身）
> 依赖关系：本 bug 是 feat-A009（检索诊断）的**前置** —— 出参体积回落 8000 预算内，feat-A009 的「出参全貌可查」才成立

## 现象

`sango_novel_search` 出参每条 entry 都携带 `quotes[]`，其中 `quotes[].text` 是 `entry.text`（chunk 原文）里抽出的对话子串。同一段原文在响应里出现两份（原文一份 + 引语副本若干份），叠加 JSON 引号转义 `\"` 开销，**最坏情况（整段都是对话）工具出参 JSON 体积接近翻倍**。

真实样例（日志 工具出参）：

```json
{
  "id": "...",
  "text": "……琪引军出，问曰：“来者何人？”……",
  "quotes": [{ "qid": "Q1", "text": "来者何人？", "offset": 14, "speaker": "琪引军出" }]
}
```

落库侧 `result_summary` 有 8000 截断预算，`quotes` 重复内容挤占预算，多条目时可能把后面的条目原文截掉，日志明细可读性下降。

## 根因

- 语料构建期 `extractQuotes()`（`mcp-server/sango/scripts/build_corpus.py` 同源逻辑 / `mcp-orchestrator/scripts/probe/chunk-sweep.mjs` 步骤 6）按引号配对把 `chunk.text` 内对话抽成引语表（`qid / text / offset / speaker`），检索出参 `toEntry()` 按契约 C4 定稿字段原样携带。
- **运行时编排侧只用 `quotes[].text`**：`buildInjectionView` / `markQuotesInWindow` 通过 `indexOf("“text”")` 定位并标注 `⟨Qn⟩`，`qid` 注入期会重编号，`offset`、`speaker` 均未读取。
- **LLM 上下文不含 `quotes`**：`agent.ts` 对 `sango_novel_search` 工具出参以注入视图（纯原文 + `⟨Qn⟩` 标记）回填，模型看不到原始出参。膨胀只作用于 MCP 传输负载与日志存储，无正确性影响。

## 修复候选（2026-09-21 拍板走候选 1）

1. **契约瘦身（推荐，需 Coco 定契约 + 老陈实现）**：`quotes[]` 只回 `{ offset, len }`，`text` 由 `entry.text` 切片还原（原文本来就在条目里，不重复传输）；删 `qid` / `speaker`。体积从「重复整段原文」降到每条约十几个字节。涉及 spec §5、mcp-server 契约测试、接口文档。
2. **去掉 `quotes[]`**：编排侧按语料同款引号配对逻辑在注入期自行重建标注；与构建期抽取存在一致性风险（嵌套引号 / 切分边界），需验证。
3. **治标**：契约不动，落库 `result_summary` 对 sango 出参做精简摘要（去 quotes）再存。

## 结论（2026-09-21 拍板，已启动）

**契约（定稿）**：

| 层 | `quotes[]` 形状 | 说明 |
|---|---|---|
| 语料 JSON（`data/corpus/**`，schema v2） | `{ qid, text, offset, speaker }` | **不动、不重建**；`speaker` 留在语料（bug-00005 备用） |
| 工具出参（`sango_novel_search`） | `{ offset, len }` | `text` 由 `entry.text` 切片还原：`entry.text.slice(offset - 1, offset - 1 + len + 2)` = `“` + 引语 + `”`；**出参删 `qid` / `text` / `speaker`** |

- `qid`：运行期由服务端按出参顺序重编号为全局 `Qn`（`citation.ts` 现行为），出参里的 `qid` 从未被消费 → 删。
- `speaker`：运行期零消费（`RenderedQuote` 只有 `text` / `chapter` / `title`），出参带它是纯浪费字节 → 出参删、**语料保留**；bug-00005 启用时先修抽取规则再按需加回出参（增量字段，向后兼容）。
- **契约分叉已接受**（负责人 2026-09-21）：语料 schema 与出参 schema 从此不同，两处分别记录（`docs/sango-corpus-spec.md` §5、`mcp-orchestrator/api/feat-A004-sango-classics-rag.md`「输出（命中）」）。后续若语料侧也确认该字段无用，再一并删除、重新统一。

**前置校验（已完成，2026-09-21 实测全量语料）**：120 回 / 2344 chunk / 8937 条引语

- 切片口径 `entry.text.slice(offset - 1, offset - 1 + len + 2) === "“" + quote.text + "”"`：**8937/8937 全部成立，0 失配** → `text` 由 `offset` 还原精确。
- 非 BMP 字符 chunk **0 个** → 构建期 Python 码点下标与运行期 JS UTF-16 下标口径一致，无代理对偏移隐患。
- 现状运行期用 `indexOf("“" + text + "”")` 定位，与 `offset` 有 **7 处不一致**（同一 chunk 内引语文本重复，`indexOf` 全部指向第一处 → 现状 marker 本就插错位置）。改走 `offset` 属**修正**，但属可见行为变化（注入文本 marker 位置变动），需在回归基线中确认。

**体积收益（同一份语料实测）**：`quotes` 序列化 1.15MB → 0.20MB（**-82.7%**）；「原文 + quotes」总量 **-32.5%**。

**用户可见影响：无（设计上等价替换）**。编排侧只消费 `quotes[].text`（`mcp-orchestrator/src/citation.ts:306` 定位、`citation.ts:459` 渲染内联引文），`citations` 卡片正文取 `entry.text`（`citation.ts:452`），模型输入本就是纯原文 + `⟨Qn⟩`（不含 quotes）。故答案结论、内联引文、卡片、角标编号预期逐字不变。

**回归断言（审查打回条件）**：候选 1 落地后，同一批问题的注入视图 `⟨Qn⟩` 数量与 `citations` 内容须与现状逐题相等 —— 最大风险是 `toRecallFragments`（`citation.ts:292`）过滤条件漏改（现按 `quote.text` 过滤），导致 quotes 被静默丢空 → 无 `⟨Qn⟩` → 指针校验失败 → 全量走兜底、引用丢失（bug-00009 同类）。

**改动清单**：`mcp-server/sango/src/search/sango-index.ts:481`（`toEntry()`）、`mcp-server/sango/src/types.ts:9`、`mcp-orchestrator/src/citation.ts:83` / `:292` / `:306`；测试 `mcp-server/sango/src/test/feat-A004/sango-index.test.ts:99`、`mcp-orchestrator/src/test/feat-A004/citation.test.ts`、`agent-novel.test.ts`；文档 spec §5、接口文档「输出（命中）」+ 验收 ②、两处 README。**语料 JSON / 向量不重建**（`build_corpus.py` 不改）。

## 进展（2026-09-21）

| 项 | 结果 |
|---|---|
| 实现 | 老陈（mcp-server 出参 + 契约测试 ⑤⑧）/ 小胡（编排侧类型、过滤、按 offset 定位 + 切片还原 + 测试 ⑲/⑲.1/⑲.2） |
| 分支（仅本地，推送被网络阻断） | `chen/bug-00010_quotes-payload-slim`（提交 `0620771`）、`hu/bug-00010_quotes-payload-slim`（提交 `0b829fc`）、dev-docs `coco/bug-00010_quotes-payload-bloat` |
| 审查读数 | mcp-server sango 16/16、mcp-orchestrator 167/167，两侧 `tsc` 干净 |
| 跨仓冒烟（Coco 实跑：老陈真实 `toEntry` 出参 → 小胡解析/注入） | 2344 chunk / 8937 条引语**零丢失**；出参键集合恰为 `{offset,len}`；切片边界 8937/8937 正确；注入视图 `⟨Qn⟩` 21/21 精确贴合开引号；真检索两题（关羽拒婚 / 张飞长坂桥）出参引语数 == marker 数 |
| 回归修正（顺带） | 同一 chunk 内引语文本重复的 7 处，定位由 `indexOf`（全指第一处，错位）改为按 `offset` 各就各位 |
| 误报澄清 | `mcp-orchestrator/scripts/probe/chunk-sweep.mjs` **不消费工具出参**（自建语料引语表），无需加 `len` |
| 遗留 | ① 推送待网络恢复；② `speaker` 抽取规则仍为脏值（bug-00005 启用前须先修）；③ `markQuotesInWindow` 已注释声明「`text` 须与 `offset` 同基准」，将来若恢复窗口裁剪须先做基准换算 |

**关联质量缺陷（本 bug 内一并处理，不另立 bug 号）**：`speaker` 抽取规则 `([\u4e00-\u9fa5]{1,4})(曰|云|问|答|喝|叱|骂)：“$` 会把动词短语当人名 —— 实测值 `咬牙大叱`、`回叱飞`、`颜喝`、`低头便拜`、`大`。运行期未读取该字段，故无用户可见影响；但若要启用 `speaker`，必须先修抽取规则（改为词表 / 别名表匹配，而非任意 1–4 汉字）。

**前置校验（2026-09-21 已完成，结论见上）**：候选 1 依赖 `offset` 精度；全量语料切片口径 0 失配，校验通过。
