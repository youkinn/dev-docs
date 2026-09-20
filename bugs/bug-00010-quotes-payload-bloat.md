# bug-00010：演义检索工具出参 quotes[] 重复携带原文子串，响应 / 落库日志体积激增

> Bug 号：bug-00010
> 状态：待修复（登记未分配）
> 关联特性：feat-A004（quotes 语料 schema / 引用链路）
> 涉及项目：mcp-server（sango 检索出参）、mcp-orchestrator（编排透传 / 落库）
> 登记：负责人 ／ 报告：负责人 ／ 登记日期：2026-09-21
> 决策：登记观察，暂不修，后续拍板

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

## 修复候选（未定）

1. **契约瘦身（推荐，需 Coco 定契约 + 老陈实现）**：`quotes[]` 只回 `{ offset, len }`，`text` 由 `entry.text` 切片还原（原文本来就在条目里，不重复传输）；删 `qid` / `speaker`。体积从「重复整段原文」降到每条约十几个字节。涉及 spec §5、mcp-server 契约测试、接口文档。
2. **去掉 `quotes[]`**：编排侧按语料同款引号配对逻辑在注入期自行重建标注；与构建期抽取存在一致性风险（嵌套引号 / 切分边界），需验证。
3. **治标**：契约不动，落库 `result_summary` 对 sango 出参做精简摘要（去 quotes）再存。

## 结论

登记观察，本期不修。若后续日志 / 传输体量成为问题，按候选 1 立项。
