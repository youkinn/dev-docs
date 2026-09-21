# bug-00010：演义检索工具出参 quotes[] 重复携带原文子串，响应 / 落库日志体积激增

> Bug 号：bug-00010
> 状态：待修复（已排期：feat-A008 结束后启动，走修复候选 1）
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

## 结论

2026-09-21 负责人拍板：当 bug 修，**排期在 feat-A008 结束后启动**，修复走候选 1（`quotes[]` 由 `{qid, text, offset, speaker}` 瘦身为 `{offset, len}`，`text` 由 `entry.text` 切片还原）。

**待定项（修复启动前需负责人拍板）**：`qid` / `speaker` 去留。候选 1 原稿建议连 `qid` / `speaker` 一起删；但 `speaker` 有明确后续用途（引用卡片展示说话人，正对 bug-00005），删掉后该用途需重建语料。Coco 建议：**保留 `speaker` 并修抽取质量**（现抽取值为脏值，见下），只把 `text` 换成 `offset` / `len`。

**关联质量缺陷（本 bug 内一并处理，不另立 bug 号）**：`speaker` 抽取规则 `([\u4e00-\u9fa5]{1,4})(曰|云|问|答|喝|叱|骂)：“$` 会把动词短语当人名 —— 实测值 `咬牙大叱`、`回叱飞`、`颜喝`、`低头便拜`、`大`。运行期未读取该字段，故无用户可见影响；但若要启用 `speaker`，必须先修抽取规则（改为词表 / 别名表匹配，而非任意 1–4 汉字）。

**前置校验**：候选 1 依赖 `offset` 精度。运行期现用 `indexOf` 定位而非 `offset`，两者口径需在全量语料上验证一致（切片口径：`text.slice(offset - 1, offset - 1 + len + 2)`）。
