# POST /api/chat（扩展：普通 / 天气 / 风云三国知识问答 / 随机一题）

> 作者：老陈
> 对应特性号：feat-A002
> 涉及项目：mcp-orchestrator, mcp-web
> 日期：2026-09-14

## 概述

在既有聊天接口上扩展：general（普通问答，缺省）、weather（现状）、sango（风云三国，含两个子服务）：service=knowledge 知识问答（LLM 理解问法，答案从题库精确取）、service=random 随机一题（本地规则出题判题，不经 LLM）。统一返回信封 `{ code, data, message }`。

## 请求

| 属性 | 值 |
|------|-----|
| 方法 | POST |
| 路径 | /api/chat |
| Content-Type | application/json |

### 请求参数

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| message | string | 是 | 用户输入，≤300 字符 |
| scenario | "general" \| "weather" \| "sango" | 否 | 缺省 general（普通问答） |
| service | "knowledge" \| "random" | 条件必填 | scenario=sango 时必填，指定子服务 |
| sessionId | string | 否 | 随机一题判题会话标识，前端用 UUID 生成 |

### 场景说明

| scenario + service | 处理方式 |
|----------|----------|
| general | Agent 通用 LLM 对话，不传 tools |
| weather | Agent 连接天气 MCP 工具（现状）；MCP 未连接返回 503 |
| sango + knowledge | Agent + sango 查询工具：LLM 理解问法 → 题库精确取答案；不经 MCP |
| sango + random | 本地 SangoService 规则（出题 / 判题 / 查答案）；不经 LLM |

### 指令表（scenario=sango, service=knowledge）

| 输入 | 行为 |
|------|------|
| 自由问法（如“夏侯惇的字是什么？”） | LLM 理解并调用查询工具 → 返回题库中的精确答案 |
| 未收录问法 | 返回“题库未收录该题，请换个问法”提示 |

### 指令表（scenario=sango, service=random）

| 输入 | 行为 |
|------|------|
| “随机一题” / “来一题” | 随机返回一题 + A-D 选项（不含答案），记为当前题 |
| 选项字母（A/a/ａ）或选项文本 | 判定对错，答错附正确答案 |
| “答案” / “这题选什么” | 返回当前题正确答案 |
| 无有效会话时作答 | 返回“请先发送‘随机一题’开始”提示 |

### 请求示例

```json
{ "message": "夏侯惇的字是什么？", "scenario": "sango", "service": "knowledge", "sessionId": "8f4b0e2a-..." }
{ "message": "随机一题", "scenario": "sango", "service": "random", "sessionId": "8f4b0e2a-..." }
```

## 响应

### 成功响应 (200)

data 结构不变（前端 ChatData 可复用）：

| 字段 | 类型 | 说明 |
|------|------|------|
| answer | string | 纯文本回复，选项分行展示 |

知识问答（答案来自题库）：

```json
{ "code": 200, "data": { "answer": "夏侯惇的字是：元让" }, "message": "" }
```

知识问答未收录：

```json
{ "code": 200, "data": { "answer": "题库未收录该题，请换个问法" }, "message": "" }
```

随机一题出题：

```json
{ "code": 200, "data": { "answer": "题目：夏侯惇的字是什么？\nA. 元让\nB. 妙才\nC. 子龙\nD. 云长" }, "message": "" }
```

随机一题判题 / 查答案：

```json
{ "code": 200, "data": { "answer": "答对了！正确答案：元让（A）" }, "message": "" }
{ "code": 200, "data": { "answer": "答错了，正确答案：元让（A）" }, "message": "" }
{ "code": 200, "data": { "answer": "正确答案：元让（A）" }, "message": "" }
```

随机一题无会话：

```json
{ "code": 200, "data": { "answer": "请先发送“随机一题”开始" }, "message": "" }
```

### 错误响应

| 状态码 | 场景 | message |
|--------|------|---------|
| 400 | message 为空 | message 不能为空 |
| 400 | scenario 非法 | scenario 不合法 |
| 400 | sango 时 service 缺失或非法 | service 不合法 |
| 413 | 消息过长 | 消息不能超过 300 字符 |
| 503 | weather 且 MCP 未连接 | 天气服务暂不可用 |
| 500 | 处理失败 | 处理请求失败，请稍后重试 |

## 校验规则

- message 必填、≤300 字符（沿用现有约束）
- scenario 仅允许 general / weather / sango（缺省 general）
- scenario=sango 时 service 必填，且仅允许 knowledge / random
- weather 依赖 MCP 连接，未连接返回 503；sango 不依赖 MCP（知识问答依赖 LLM 配置，与 general 相同）

## 技术要点（老陈技术方案合并在此）

- server.ts：createServer(agent, sangoService, options)，/api/chat 按 scenario + service 分发
- Agent 支持空工具列表：general 场景不传 tools、使用通用 system prompt
- 知识问答复用 Agent：新增 sango 查询工具（sangoService.search → 命中题目 + 答案），LLM 只理解问法并组织回复，答案内容由题库提供、不生成；未命中返回未收录
- 新增 src/sango.ts（SangoService）：
  - load()：读 SANGO_QUESTION_FILE（默认 data/sango-questions.json），启动校验（question 非空、options A-D 齐全、answer ∈ options），坏行跳过 + 告警
  - normalize()：全角→半角、去空白与标点、小写
  - search(text)：归一化后精确优先、包含兜底，返回命中题目 + 答案（供知识问答）
  - judge(text)：先按字母（A-D）匹配，再按选项文本归一化匹配
  - randomQuestion() / answerOf(question)
- 会话：Map<sessionId, { question, createdAt }>，TTL 30 分钟，仅随机一题使用，重启清空
- 指令识别顺序（random）：随机一题 → 查答案 → 判题 → 无会话提示
- 题库字段统一为 answer（选项文本），数据位于 data/sango-questions.json（88 题，结构校验通过）
- v1 不做离线 embedding / 向量检索 / Top3 候选兜底（知识问答由 LLM 理解 + 题库规则取答案）