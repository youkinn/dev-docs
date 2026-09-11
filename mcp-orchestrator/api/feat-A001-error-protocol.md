# POST /api/chat 错误响应协议（feat-A001 扩展）

> 作者：老陈
> 对应特性号：feat-A001
> 涉及项目：mcp-orchestrator（实现）、mcp-web（小叶对接）
> 日期：2026-09-11

## 概述

在既有统一响应约定（`mcp-orchestrator/api/response-convention.md`）基础上扩展错误细分，目标是让前端能够区分「服务挂了 / key 无效 / 请求超时」三类问题，并给出可操作的提示。

## 已有约定（引用，不重复定义）

- 所有失败响应保持 `{ code, data: null, message }` 统一结构，`data` 为 `null`，`message` 面向用户可读
- 400 参数无效、413 消息超 300 字符、503 MCP Server 未连接、500 兜底，语义与 message 均沿用 response-convention.md，不做变更

## 新增错误码（POST /api/chat）

| code | 场景 | message（前端直接展示） |
|------|------|------------------------|
| 401 | API key 无效 | `模型接口认证失败，请检查 API_KEY 配置` |
| 408 | 请求超时 | `请求超时，请稍后重试` |
| 503 | 模型服务不可用 | `模型服务暂不可用`（weather.gov 不可用沿用既有 `天气服务暂不可用`） |

## 前端判断 orchestrator 未启动

以下任一情况视为后端服务未启动，前端不依赖 HTTP 响应体，直接展示固定文案「无法连接到后端服务，请确认已启动」：

- `fetch` 抛出网络错误（连接被拒绝 / DNS 失败等）
- `GET /api/health` 请求失败或非 200

## 技术要点

- 401 在 LLM 调用层捕获（LLM 返回认证错误即映射 401）；408 从 LLM 调用或工具调用超时捕获
- 错误响应只输出 code、data、message，禁止泄漏堆栈、内部错误详情或模型原始报错体

## 前端处理顺序

先判断网络错误 / health 失败（未启动），再按 401 / 408 / 其余 code 展示对应 message。
