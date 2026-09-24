# 四项目架构与调用关系

> 日期：2026-09-15　维护：Coco
> 需要了解项目关系时先看本文，避免每次重新检索各项目文件。

## 项目总览

| 项目 | 别名 | 本地路径 | 负责人 | 技术栈 | 职责 |
|---|---|---|---|---|
| dev-docs | 兰台 | `D:\workplace\dev-docs` | Coco + 负责人 | Markdown | 需求 / 接口 / 设计文档唯一仓库（契约中心） |
| mcp-web | 前厅 | `D:\workplace\mcp-web` | 小叶 | Vue 3 + Ant Design Vue + Less + Pinia + Vite | 前端 UI（API 客户端、Pinia store、页面组件） |
| mcp-orchestrator | 总台 | `D:\workplace\mcp-orchestrator` | 小胡 + 老陈 | TypeScript + Express | LLM 编排（agent.ts）+ MCP 传输（transport.ts）+ HTTP 层（server.ts） |
| mcp-server | 器坊 | `D:\workplace\mcp-server` | 老陈 | Node + @modelcontextprotocol/sdk | MCP 服务端（Stdio），工具 get-alerts / get-forecast（数据源 weather.gov NWS） |

## 调用链路

```
浏览器 / 前端（mcp-web，Vue 3）
      │  HTTP /api（Vite 代理 → http://localhost:8001）
      ▼
mcp-orchestrator（Express Web 服务，端口 3000）
  server.ts     路由、校验、队列
      │
  agent.ts      LLM 编排、tool-use 循环（小胡）
      │
  transport.ts  MCP 协议层：connect / listTools / callTool / close（老陈）
      │  MCP 协议（stdio）
      ▼
mcp-server（@modelcontextprotocol/sdk，Stdio 传输）
  get-alerts / get-forecast
      │  HTTPS
      ▼
weather.gov NWS API（外部数据源）
```

依赖方向（orchestrator 内部，无循环）：`index/cli → server → agent → transport`

## 契约与开发顺序

- dev-docs 是唯一契约中心：`requirements/`（需求）、`mcp-orchestrator/api/`（接口）、`design/`（技术方案）。
- 顺序：老陈接口文档先出 → 小叶前端才开工（小叶依赖老陈）。
- 强制统一响应信封：`{ code, data, message }`（详见 `mcp-orchestrator/api/response-convention.md`）。

## Git 协作边界（2026-09-16）

- 多人同项目：Coco 拉需求分支 → 成员基于它拉个人分支 → 成员自合入需求分支 → Coco 发起往 main 的 PR → 负责人验收并合并。
- 端到端验收由负责人在需求分支上执行：先验收、通过后才由 Coco 发起 PR。Coco 不再跑集成测试（2026-09-16 决策，控 token）。