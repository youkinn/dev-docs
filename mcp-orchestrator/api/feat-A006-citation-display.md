# 答案展示结构化（结论 + 引用出处卡片）

> 作者：老陈
> 对应特性号：feat-A006
> 故事号：story-A006-02（接口文档；实现见后续故事）
> 涉及项目：mcp-orchestrator（HTTP 层 `data` 统一 `{ answer, citations }`；answer 引文 + 角标拼装、citations 组装属 agent 作答路径，小胡实现）、mcp-server（无改动：`sango_novel_search` 出参不变）、mcp-web（小叶对接：单一渲染路径，角标为 answer 内普通字符、前端零解析）
> 日期：2026-09-20

## 概述

「答案展示结构化（结论 + 引用出处卡片）」把引用与出处从 `answer` 内联文本下沉为结构化 `citations`，前端可据此渲染引用出处卡片区。

- **统一形状**：`POST /api/chat` 与 `POST /api/sango/random` 响应 `data` 统一为 `{ answer, citations }`，**不做 domain 分支**。
- **无引用恒空数组**：无引用时 `citations` 恒为 `[]`，不省略、不缺失；`weather` / `fengyunsanguo` / 随机一题永远 `[]`，行为与现状零变化；以后新增域默认 `[]`。
- **字段只增不减**：无中间态；旧前端忽略 `citations` 照常工作。
- **前端单一渲染路径**：角标是服务端拼入 `answer` 的普通字符，前端零解析；前端沿用 `res.data.answer` 展示结论，按需读取 `res.data.citations` 渲染卡片区。

全部接口沿用 `{ code, data, message }` 信封（见 `mcp-orchestrator/api/response-convention.md`）。

## data 统一形状

| 字段 | 类型 | 说明 |
|------|------|------|
| `answer` | string | 结论正文（字段口径见下） |
| `citations` | array | 引用出处卡片数据；按引用出现顺序的扁平数组；无引用时恒 `[]` |

各场景 `citations` 行为：

| 场景 | citations |
|------|-----------|
| `sango-novel`（含自动路由落入该域） | 按「渲染行为」组装 |
| `weather` | 恒 `[]`（仅补空数组，行为与现状零变化） |
| `fengyunsanguo` | 恒 `[]`（仅补空数组，行为与现状零变化） |
| `POST /api/sango/random`（随机一题） | 恒 `[]` |
| 以后新增域 | 默认 `[]` |

## 字段口径

### answer（结论正文）

- `answer` 是结论正文：服务端把模型输出 `[Qn]` 指针替换为「引文」+ 全局上标角标（¹²³…，按出现顺序从 1 起），**不再内联出处**，`answer` 自洽、可独立成读。
- 上标字符仅 `¹²³⁴⁵⁶⁷⁸⁹⁰`；角标数 >9 时用多字符上标组合（如第 10 条为 `¹⁰`），与 `citations` 下标一一对应。
- `answer` 内不再出现「（出处：第N回 回目）」内联文本；任何展示位不出现段号、不引入 `segFrom` / `segTo`。

### citations（引用出处卡片）

- 按引用出现顺序的扁平数组；元素 `{ text, chapter, title }`；无引用时为 `[]`。

| 字段 | 类型 | 说明 |
|------|------|------|
| `text` | string | 命中片段原文（工具出参 `text`，即注入视图「片段N」，可含引语；无回目 / 段号 / 类型 / 分数） |
| `chapter` | number | 回号 |
| `title` | string | 回目 |

## 渲染行为（服务端，小胡实现）

- **角标与下标一一对应**：第 1 条引用下标 0 → `¹`，第 2 条下标 1 → `²`，依此类推（第 10 条下标 9 → `¹⁰`）。
- **`[片段N]` 叙述段指针只渲染上标角标、不内联原文**：`answer` 只放结论（含角标），片段原文仅进 `citations` 卡片；`[Qn]` 引语指针渲染「引文」+ 角标不变。
- **片段粒度合并**：多引语落同一片段合并为一条 citation；角标数量 = 片段数量；多条按首次出现顺序。
- **只收被引片段**：只引用片段内某引语时，`citations` 只收录被引用到的片段。
- **上标字符**仅 `¹²³⁴⁵⁶⁷⁸⁹⁰`；角标数 >9 用多字符组合（如 `¹⁰`），仍与下标一一对应。
- `answer` 内不再出现「（出处：第N回 回目）」内联文本。
- 任何展示位不出现段号、不引入 `segFrom` / `segTo`。

## 兜底路径

- **人名校验不过 / 指针非法 / 无召回** → `answer` 放结论句（带角标 `¹`），`citations` 恰一条兜底片段（整段不裁剪、chunk 上限 400 字、禁止多段拼刷）。
- **无原文可引用不得编造**。
- **长引语安全网**：模型输出 >30 字的 `「…」` 视为违规，丢弃改按引语表字段渲染（引文由条目原文按 `quotes[].offset` / `len` 切片还原，角标并入 `citations`；出参形态见 `api/feat-A004-sango-classics-rag.md`「出参 `quotes[]` 与语料不同形」）。

## 示例

### POST /api/chat（domain=sango-novel）成功

请求：

```json
{ "message": "关羽为什么拒绝孙权的联姻？", "domain": "sango-novel" }
```

响应（`answer` 含 `¹²` 两角标，`citations` 两条跨回，各含 `text` / `chapter` / `title`）：

```json
{
  "code": 200,
  "data": {
    "answer": "孙权遣诸葛瑾为子求亲，关羽以「吾虎女安肯嫁犬子乎」怒拒¹；庞德抬榇决死战，扬言「特来取汝首」²。",
    "citations": [
      {
        "text": "云长勃然大怒曰：“吾虎女安肯嫁犬子乎！不看汝弟之面，立斩汝首！再休多言！”遂唤左右逐出。",
        "chapter": 73,
        "title": "玄德进位汉中王　云长攻拔襄阳郡"
      },
      {
        "text": "庞德曰：“吾奉魏王旨，特来取汝首！恐汝不信，备榇在此。”",
        "chapter": 74,
        "title": "庞令明抬榇决死战　关云长放水淹七军"
      }
    ]
  },
  "message": ""
}
```

### POST /api/chat（weather）成功（citations 恒 []）

```json
{
  "code": 200,
  "data": {
    "answer": "今天纽约晴朗，气温 24℃，东南风 3 级。",
    "citations": []
  },
  "message": ""
}
```

### POST /api/sango/random 成功（citations 恒 []）

```json
{
  "code": 200,
  "data": {
    "answer": "题目：夏侯惇的字是什么？\nA. 元让\nB. 妙才\nC. 子龙\nD. 云长",
    "citations": []
  },
  "message": ""
}
```

### 兜底成功（answer 结论句带角标 ¹、citations 恰一条兜底片段）

```json
{
  "code": 200,
  "data": {
    "answer": "关于孙刘联姻，演义中关羽以强硬态度拒绝了孙权。¹",
    "citations": [
      {
        "text": "云长勃然大怒曰：“吾虎女安肯嫁犬子乎！不看汝弟之面，立斩汝首！再休多言！”遂唤左右逐出。",
        "chapter": 73,
        "title": "玄德进位汉中王　云长攻拔襄阳郡"
      }
    ]
  },
  "message": ""
}
```

## 错误语义

- 沿用 `mcp-orchestrator/api/response-convention.md` 信封 `{ code, data, message }`；失败时 `data` 为 `null`。
- **本特性不新增错误码**：400 / 413 / 503 / 500 的触发条件与 `message` 语义不变。

## 兼容性与影响面

- 仅 `sango-novel`（含自动路由落入该域）渲染逻辑变化（`answer` 拼引文 + 角标、`citations` 组装）。
- `weather` / `fengyunsanguo` 仅补空数组，行为与现状零变化。
- mcp-server 工具契约 `sango_novel_search` 出参**不改**（`text` / `chapter` / `title` 等字段照旧，见 `api/feat-A004-sango-classics-rag.md`「输出（命中）」）。
- **不修 bug-00005**。
- **不做流式、不做片段折叠**。

## 修订记录

| 日期 | 修订 |
|------|------|
| 2026-09-20 | 初稿（story-A006-02 接口文档） |
