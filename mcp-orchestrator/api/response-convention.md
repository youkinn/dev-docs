# API 响应格式约定

> 作者：Coco（定稿）
> 涉及项目：mcp-orchestrator（老陈实现）, mcp-web（小叶对接）
> 日期：2026-09-11

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

**成功：**
```json
{
  "code": 200,
  "data": {
    "tools": [
      { "name": "get-alerts", "description": "获取某个州的天气预警" },
      { "name": "get-forecast", "description": "获取某个位置的天气预报" }
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

**成功：**
```json
{ "code": 200, "data": { "answer": "今天纽约晴朗，气温..." }, "message": "" }
```

**失败：**

| code | 场景 | message 示例 |
|------|------|-------------|
| 400 | 参数无效 | `message 不能为空` |
| 413 | 消息过长 | `消息不能超过 300 字符` |
| 503 | MCP Server 未连接 | `天气服务暂不可用` |
| 500 | 处理失败 | `处理请求失败，请稍后重试` |

## 老陈实现要点

- 每个接口返回都用 `{ code, data, message }` 包裹，不允许例外
- `data` 失败时设为 `null`，不要省略
- `message` 失败时必须有内容，面向用户可读
- 新增接口自动遵守此约定
