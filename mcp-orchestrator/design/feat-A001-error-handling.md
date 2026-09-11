# orchestrator 错误细分落地 — 技术方案

> 作者：小胡
> 对应特性号：feat-A001
> 日期：2026-09-11

## 涉及文件

| 文件 | 操作 | 说明 |
|------|------|------|
| mcp-orchestrator/src/agent.ts | 修改 | 错误分类捕获、LLM/工具调用超时控制 |
| mcp-orchestrator/src/server.ts | 修改 | 按错误类型映射状态码与 message，兜底 500 |

## 错误分类映射（Coco 已定契约，直接采用）

| 异常类型 | HTTP 状态码 | message |
|----------|-------------|---------|
| API key 无效 / 认证失败 | 401 | `模型接口认证失败，请检查 API_KEY 配置` |
| LLM 或工具调用超时 | 408 | `请求超时，请稍后重试` |
| 上游不可用（模型服务 / weather.gov） | 503 | `模型服务暂不可用`；weather.gov 沿用既有 `天气服务暂不可用` |
| 未知异常 | 500 | `处理请求失败，请稍后重试` |

统一返回 `{ code, data: null, message }`，遵守 `api/response-convention.md`。

## 捕获位置与超时配置

- **认证失败（401）**：在 agent.ts 的 LLM 调用层捕获 key 类错误（401 / 403 / Invalid API Key），按类型抛出
- **超时（408）**：agent.ts 分别对 LLM 调用与工具调用用 `Promise.race` 设超时；server.ts 再做请求级超时兜底
  - 阈值走环境变量：`LLM_TIMEOUT_MS` 默认 `30000`，`TOOL_TIMEOUT_MS` 默认 `10000`
- **上游不可用（503）**：agent.ts 捕获模型服务与工具上游错误；server.ts 映射 503，message 只给用户可读文案，**不得泄漏内部堆栈**
- **兜底（500）**：server.ts 全局 catch 未知异常

## 核心流程

```
前端 POST /api/chat → server.ts → agent.ts tool-use 循环
  ├─ LLM key 错误    → 401
  ├─ LLM/工具超时    → 408
  ├─ 上游不可用      → 503
  └─ 未知异常        → 500
统一 { code, data: null, message } 返回前端
```

## 选型 & 注意

- DeepSeek 偶发非标准 tool-call 格式：agent.ts 已有兼容处理，本次只记载为既有约束，不展开
- message 一律面向用户，禁止拼接内部堆栈或错误对象
- 超时阈值必须有默认值，新环境无需配置即可运行
