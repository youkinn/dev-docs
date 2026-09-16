# mcp-server 架构决策：单仓多 MCP、独立构建与部署、TypeScript 打底

> 作者：Coco ｜ 关联：feat-A004 三国演义解读 ｜ 日期：2026-09-16
> 状态：**已定稿**（负责人 2026-09-16 拍板）

## 1. 决策

1. **保持 `mcp-server` 一个项目（仓库）**，其下放各个 MCP 子项目，**单独构建、单独部署**。
2. 目录结构：`weather/`（天气，本次**仅迁移目录、内容零改动**）、`sango/`（三国，feat-A004 新增，TypeScript）。
3. 每个 MCP = 独立子项目：独立 package.json / 构建产物（dist）/ 数据 / 入口；独立 stdio 子进程；**只改动被改的那个 MCP，不涉及的不重建、不重部署**。
4. 技术栈：**新增 MCP 一律 TypeScript 打底**；weather 存量 JS 本次不动（仅搬目录），待其首次真实改动时再迁 TS。
5. 备选方案「新建独立仓库」不采纳（对比见 §4），触发条件满足时再拆。

## 2. 目录结构（定稿）

```
mcp-server/                    # 仓库 = MCP servers 集合
├── package.json               # 容器根：聚合脚本 / 说明（weather 原 manifest 随项目迁入 weather/）
├── weather/                   # 天气 MCP：本次仅迁移目录，代码/依赖/行为零改动
│   ├── package.json           # ← 原根 package.json（name=weather）迁入
│   ├── src/index.js           # ← 原 src/weather/index.js（内容不动，启动路径随迁）
│   └── node_modules/          # 随迁（或根统一安装，实现时二选一并登记）
└── sango/                     # 三国 MCP（feat-A004，TypeScript 打底）
    ├── package.json           # name=mcp-sango；build: tsc → dist/
    ├── tsconfig.json
    ├── src/index.ts           # 入口 → dist/index.js
    ├── data/                  # corpus/（分回语料）、vectors/（离线向量）、alias.json（线上只读）
    └── scripts/               # 语料清洗 / 离线向量（Python 侧车，D5）
```

## 3. 关键机制：单改单编译、单改单部署

- **构建**：每 MCP 项目目录内独立 `npm run build`（sango = tsc → `sango/dist/`）；weather 无构建（纯 JS）。改 sango 只编 sango。
- **部署（粒度 = stdio 子进程）**：orchestrator 多 server 注册表分别拉起 `node weather/src/index.js` 与 `node sango/dist/index.js`；改 sango → 只替换 `sango/dist/` 并重启 sango 子进程；weather 产物与进程不被触碰、不重新部署。注册表入口来自 orchestrator 根 `.env`（`MCP_WEATHER_SCRIPT` / `MCP_SANGO_SCRIPT`），orchestrator 用 `npm run dev` 无参启动；新增 MCP 通用流程见 orchestrator README「新增一个 MCP server」。
- **依赖**：每项目自包含（own node_modules）优先，保证独立部署；根仅聚合脚本。
- **边界**：orchestrator 整体重启时 weather 子进程以相同代码重启（属进程重启、非重新部署）；如需连进程重启都隔离，transport 加「按 server reload」（默认不做，见开放问题）。

## 4. 与备选方案对比（新建独立仓库，不采纳）

| 维度 | 单仓多 MCP（采纳） | 新建独立仓库（备选） |
|---|---|---|
| 隔离 | 包+进程级（MCP 层面足够） | 仓库级最强 |
| 单改单编译/部署 | ✅ 独立目录 + 独立构建 + 独立子进程 | ✅ 天然 |
| 公共设施/依赖 | 共享约定、各自安装 | 每仓重复维护 |
| 小团队维护成本 | 低 | 高（每新增一 MCP 多一仓库） |

**触发拆仓条件**：某 MCP 需要独立版本号 / 独立发布节奏 / 独立 CI 门禁，或单仓包数 >3~4 个。到点再拆，不预支复杂度。

## 5. 技术栈

- 新增 MCP：**TypeScript**（tsc → dist），与 mcp-orchestrator 统一。
- weather：存量 JS，本次仅搬目录不改代码；迁移 TS 触发条件 = weather 首次真实改动时。
- 统一 `@modelcontextprotocol/sdk`；工具输入 Zod 校验；日志只写 stderr（stdout 走 MCP 协议）。

## 6. 落地清单（老陈，feat-A004 范围内）

1. 目录重组：weather 整体迁入 `weather/`（代码/依赖/行为零改动，git mv）；根 package.json 改为容器。
2. `sango/` 新建 TS 项目：工具 `sango_novel_search`（入参 source/query/limit，Zod 校验；返回按相关度排序的文本块【出处】第N回 <回目> · 段X（类型）+ 原文段落；无命中「未召回任何原文段落」）；语料清洗→段级切分+类型标注（narration/verse/comment）→ `sango/data/corpus/`；离线向量（D5：Python 侧车构建期出、线上只读；BGE-M3 先设 `HF_ENDPOINT=https://hf-mirror.com`，下载不可行则确定性哈希降级并登记）→ `sango/data/vectors/`；别名表 `sango/data/alias.json`（P001 起按规范名去重，关羽→P002）。
3. mcp-orchestrator：`MCPTransport` 重构为多 server 注册表（weather + sango 两个 stdio 子进程，入口由 orchestrator 根 `.env` 注册表 `MCP_WEATHER_SCRIPT` / `MCP_SANGO_SCRIPT` 配置，启动用 `npm run dev` 无参；合并工具；按工具名路由；GET /api/tools 合并上报）。
4. 接口文档 `mcp-orchestrator/api/feat-A004-sango-classics-rag.md` 按本文定稿校对（sango 入口路径、data 路径、weather 搬迁、TS 构建说明）。
5. 明确不做：query 改写 / rerank / 专用向量库 / 《三国志》（二期待定）。

## 7. 开放问题

- 底本 / 点校版权口径（**上线前必须确认**，语料源 `dev-docs/docs/三国演义.txt` 已就位）。
- weather 的 node_modules 随迁 or 根统一安装（实现时定并登记）。
- orchestrator「按 server reload」是否本期做（默认不做）。
- 触发拆仓条件满足时，新仓库命名（如 `sango-mcp-server`）届时再定。
