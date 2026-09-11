# 天气助手页面（UX 交互优化）— 技术方案

> 作者：小叶
> 对应特性号：feat-A001
> 日期：2026-09-11

## 涉及文件（mcp-web，具体路径以仓库实际结构为准）

| 文件 | 操作 | 说明 |
|------|------|------|
| src/views/WeatherView.vue | 修改 | 发送按钮 disabled、300 字符截断提示、spinner 加载态、空状态与底部引导文案、回复一键复制 |
| src/api/client.ts | 修改 | API 客户端按 `{ code, data, message }` 响应格式处理；getErrorMessage 按状态码映射统一 message；GET /api/health 启动检测 |
| src/stores/chat.ts | 修改 | 封装「输入校验 → 请求 → 加载/错误状态」流转，供聊天页调用 |

## 核心流程

```
输入(英文城市名) → 校验(非空 / 300字符截断) → POST /api/chat
  → 成功: 渲染助手回复(可一键复制)
  → 失败: getErrorMessage(状态码) 展示统一 message
  → fetch 网络错误或 GET /api/health 失败: 提示「无法连接到后端服务，请确认已启动」
```

## 选型 & 注意

- 发送按钮 disabled：消息为空或请求加载中时禁用，避免重复提交
- 输入超 300 字符：自动截断至 300 并 message.warning 提示（最多输入 300 字符）
- 加载中：spinner + 「正在查询天气工具...」文案，期间禁止重复发送
- 空状态文案：删除「左侧」提法，改为与页面实际布局一致的内容（如「输入英文城市名查询天气」）
- 页面底部：常驻引导「请输入英文城市名，如 new york」
- 回复复制：navigator.clipboard.writeText 成功后 message.success 反馈，失败降级 textarea 兜底
- 错误映射（后端按统一响应格式返回 { code, data, message }，失败时 data 为 null，前端直接展示 message）：
  - 401 → 「模型接口认证失败，请检查 API_KEY 配置」
  - 408 → 「请求超时，请稍后重试」
  - 500 及其他 → 展示后端 message，缺失时用通用兜底文案
  - fetch 网络错误，或请求前 GET /api/health 失败 → 「无法连接到后端服务，请确认已启动」
- 注意：health 检测仅在连接异常时执行，不阻塞正常请求路径；后端返回非预期结构时走兜底分支
