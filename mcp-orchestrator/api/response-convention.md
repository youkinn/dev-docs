# API 响应格式约定

> 作者：Coco（定稿）
> 涉及项目：mcp-orchestrator（老陈实现）, mcp-web（小叶对接）
> 日期：2026-09-11
> 修订：2026-09-15 同步 feat-A003（503 改为按错误类型判定、新增 `POST /api/sango/random`、`/api/tools` 含本地工具）
> 修订：2026-09-20 同步 feat-A007（新增「分页约定」小节：`pageNo` 从 1 起 / `pageSize`，响应元数据放 `data` 内 `{ list, total, pageNo, pageSize }`，所有列表页通用）
>
> 本文件只定「信封 + 通用错误语义」。字段级契约（请求体白名单、每个 code 的触发条件与 message 原文）以各特性接口文档为准：`api/feat-A00X-*.md`。

## 统一响应结构

所有接口使用相同的顶层格式：

```json
{
  "code": 200,
  "data": { ... },
  "message": ""
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `code` | number | HTTP 状态码。`200` 表示成功，其他表示失败 |
| `data` | object / array / null | 成功时的业务数据；失败时为 `null` |
| `message` | string | 失败时必填，描述错误原因；成功时可为空字符串 |

## 分页约定

所有列表页接口通用（feat-A007 起）：请求参数 `pageNo`（从 1 起，默认 1）/ `pageSize`（默认 20，范围 1–100，越界裁剪）；响应元数据放 `data` 内：

```json
{
  "code": 200,
  "data": {
    "list": [],
    "total": 0,
    "pageNo": 1,
    "pageSize": 20
  },
  "message": ""
}
```

- `list`：当前页数据数组；`total`：满足过滤条件的总条数（供分页器使用）
- 过滤参数与列表项结构以各特性接口文档为准

## 小叶前端统一处理

```ts
const res = await api.post('/chat', { message })

if (res.code === 200) {
  // 用 res.data
} else {
  // 展示 res.message
}
```

## 各接口映射

### `GET /health`

**成功：**
```json
{ "code": 200, "data": { "status": "ok", "service": "mcp-orchestrator" }, "message": "" }
```

### `GET /api/tools`

上报**模型实际可见的全部工具**（MCP 工具 + 本地工具，如 `sango_query`），不是只报 MCP 工具。

**成功：**
```json
{
  "code": 200,
  "data": {
    "tools": [
      { "name": "get-alerts", "description": "获取美国某个州的当前天气预警（数据源：美国国家气象局 NWS）……" },
      { "name": "get-forecast", "description": "获取美国境内某个经纬度位置的天气预报（数据源：美国国家气象局 NWS）……" },
      { "name": "sango_query", "description": "风云三国题库检索：仅当用户询问风云三国游戏内招募武将问答题时调用……" }
    ]
  },
  "message": ""
}
```

**失败：**
```json
{ "code": 503, "data": null, "message": "MCP Server 未连接" }
```

### `POST /api/chat`

请求体只接受 `message`（feat-A003 起旧字段 `scenario` / `service` 一律 400），路由由模型自主决定。

**成功：**
```json
{ "code": 200, "data": { "answer": "今天纽约晴朗，气温..." }, "message": "" }
```

**失败：**

| code | 场景 | message 示例 |
|------|------|-------------|
| 400 | 参数无效（空 message / 出现白名单外的键） | `message 不能为空`、`请求体只支持 message 字段，收到无效字段：scenario` |
| 413 | 消息过长 | `消息不能超过 300 字符` |
| 503 | 工具调用失败（`ToolExecutionError`：MCP 未连接 / 子进程退出 / 协议错误） | `工具服务暂不可用，请稍后重试` |
| 500 | 其余处理失败（LLM 调用失败、本地工具异常） | `处理请求失败，请稍后重试` |

503 **按错误类型判定**，不由请求字段（旧实现的 `scenario === 'weather'`）反推。

### `POST /api/sango/random`

确定性命令「随机一题」独立端点：本地规则出题 / 判题 / 查答案，不经 LLM、不依赖 MCP。请求体 `{ message, sessionId? }`。

**成功：**
```json
{ "code": 200, "data": { "answer": "题目：夏侯惇的字是什么？\nA. 元让\nB. 妙才\nC. 子龙\nD. 云长" }, "message": "" }
```

**失败：**

| code | 场景 | message 示例 |
|------|------|-------------|
| 400 | 参数无效（空 message / 白名单 `{ message, sessionId }` 外的键） | `message 不能为空` |
| 413 | 消息过长 | `消息不能超过 300 字符` |
| 500 | 本地规则执行异常（本端点无 503） | `处理请求失败，请稍后重试` |
## 老陈实现要点

- 每个接口返回都用 `{ code, data, message }` 包裹，不允许例外
- `data` 失败时设为 `null`，不要省略
- `message` 失败时必须有内容，面向用户可读
- 新增接口自动遵守此约定
