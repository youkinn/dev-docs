# feat-A003: 模型自主工具路由（统一对话入口）

> 特性号：feat-A003
> 状态：定稿
> 作者：Coco
> 涉及项目：mcp-orchestrator, mcp-server, mcp-web
> 日期：2026-09-15

## 背景

feat-A002 用 `POST /api/chat` 的 `scenario` / `service` 字段做场景分发，`src/server.ts` 用 if 链把参数翻译成三个 Agent（general / weather / sangoKnowledge）之一。当前痛点：

- 路由决策在前端，模型看不到全部能力，没有机会自主选择用哪个工具
- HTTP 层出现 `weather` / `sango` / `knowledge` / `random` 等业务概念，越过 `server → agent` 分层
- 新增能力要改 4 处：新建 Agent、加枚举、加分支、加错误码分支（`server.ts` 用 `scenario === 'weather'` 反推 503）
- `GET /api/tools` 只上报 MCP 工具，`sango_query` 作为 localTool 不可见，对外声明能力与真实能力不一致

另外，天气 MCP 工具（`get-forecast` / `get-alerts`）实际只覆盖美国（NWS API），但描述里没写。非美国坐标会拿到一段英文的「only US locations are supported」，且它是**作为正常工具结果返回的，不是异常**。模型不知道边界就会无谓调用，输出中英混杂、质量不可控。

本需求翻转 feat-A002 明确写下的非目标「不做按内容自动路由，模式 / 子模块由用户显式选择」。负责人已确认。

## 目标

- [ ] 对话只保留一个 Agent：tools = MCP 工具 + 本地题库工具，由模型按语义自主决定调用哪个、或都不调用
- [ ] `POST /api/chat` 不再接受路由字段，路由完全由模型决定
- [ ] 确定性命令（随机一题）拆到独立端点，不经过模型
- [ ] `GET /api/tools` 返回模型实际可见的全部工具（含本地工具）
- [ ] 天气工具描述声明覆盖范围（美国境内），消除非美国地区的无谓调用
- [ ] 前端「天气」「风云三国」标签降级为纯前端 UX，不参与路由

## 非目标

- 不修改 MCP 协议层（`transport.ts`）与 stdio 交互方式
- 不修改题库文件格式与召回算法（召回问题归 bug-00001 及其后续）
- 不引入多轮对话记忆
- 不接入 MCP Server 之外的新数据源
- 本期不做模板 / 快捷问法；标签保留为其挂靠点
- 不新增请求字段（含 `hint` / `domain` 这类「限定域」字段，评审已否决，理由见决策记录）

**边界声明（后续特性的判断依据）**：只有**单轮、无状态、只读的自由文本**问答可走自动路由；**有副作用 / 有会话状态 / 有固定参数形状（模板、表单）**的能力必须保留显式入口。原因是这类能力在用户那一轮输入里没有语义可供路由（如「A」「元让」「138xxxx」）。

## 验收标准

1. [ ] 语义指向美国天气 → 调用 `get-forecast` / `get-alerts`，回答符合「结论优先、不超过 50 字、以『出门必备：』结尾」
2. [ ] 语义指向题库内三国题目（问法与题干不同、含义相同）→ 调用 `sango_query`，回答与题库答案原文一致
3. [ ] 语义指向三国但题库未收录 → 固定回复「题库未收录该题，请换个问法」，不使用题库外知识作答
4. [ ] 涉及天气但非美国地区（如「北京今天天气」）→ 不调用天气工具，明确告知仅支持美国天气，不编造天气数据
5. [ ] 其余问题（含「你好」这类）→ 不调用任何工具，自由作答，不套天气 / 题库模板
6. [ ] 以上 1–5 在**不传任何路由字段**时全部成立（默认路径即自动路由）
7. [ ] 请求体携带旧字段 `scenario` / `service` → 400
8. [ ] `GET /api/tools` 返回值包含 MCP 工具与本地工具（`sango_query`）
9. [ ] `POST /api/sango/random`：出题 / 判题 / 查答案 / 无会话提示 / 会话过期行为与 feat-A002 一致
10. [ ] 所有接口返回 `{ code, data, message }` 信封

## 接口影响

| 接口 | 变更 |
|------|------|
| `POST /api/chat` | 请求体只保留 `message`；`scenario` / `service` 删除，携带即 400；路由由模型决定 |
| `POST /api/sango/random`（新增） | `{ message, sessionId? }`；随机一题状态机，行为与 A002 的 sango+random 等价 |
| `GET /api/tools` | 返回值加入本地工具（`sango_query`），来源从单一 Agent 改为统一 Agent |
| `get-forecast`（mcp-server） | 描述改为声明「美国境内」；`inputSchema` 与实现不变 |
| `get-alerts`（mcp-server） | 描述补明覆盖范围（美国）；`inputSchema` 与实现不变 |
| 前端（mcp-web） | 标签保留但不再传后端；默认不选标签；去掉 `scenario` / `service` 传参 |
| 错误码 | 不再由 scenario 反推（原 `scenario === 'weather'` → 503），改为按错误类型判定 |
| 响应 data | 结构不变（仍为 `{ answer }`），不新增字段 |

## 技术要点

- `AgentOptions`（`systemPrompt` / `tools` / `localTools` / `modelCaller`）已能表达统一配置，无需新增机制；`agent.ts` 的 tool-use 循环不动
- 提示词把规则写成**优先级次序**（先判断是否命中专用能力 → 命中则调用 → 否则按域兜底）。这是 prompt 措辞，`server.ts` 不得出现对应的 if-else
- 兜底分域，不存在统一的「否则自由回答」：美国天气 → 工具；三国未收录 → 固定话术；非美国天气 → 明确告知不支持；其余 → 自由回答
- `sango_query` 描述需限定适用域（「仅当用户询问风云三国游戏内招募武将问答题时调用」）
- 规则块沿用 feat-A002 已验证的原文，避免格式回归
- 验证方式（不新增响应字段的前提下）：
  - 小胡：用 `AgentOptions.modelCaller` 注入伪造的 `tool_use` 返回，覆盖「调了某工具该走什么格式」的确定性用例
  - 老陈：用 mock transport 记录实际调用的工具名，断言路由结果
  - 真实 LLM 的判断准确率用固定问题集跑多次统计，只测比例、测不出确定性

## 决策记录

| 议题 | 结论 | 理由 |
|------|------|------|
| 前端标签存废 | 保留，降级为纯前端 UX，不参与路由 | 语义可分的域不需要前端指路；标签用于能力可发现性与模板挂靠 |
| 是否新增 `hint` / `domain` 字段 | 不加 | 与 `scenario` 同义，只是把必填换成可选；限定工具可见性无正向价值（模型本来就判断对），强制走该域在「介绍风云三国这游戏」上反而更差 |
| 旧字段 `scenario` / `service` | 400 拒绝 | 无灰度需求，前后端同时上线即可；静默忽略会留下「传了但没用」的字段误导人 |
| 随机一题的路由位置 | 独立端点 | 与问答语义冲突（「A」在两种语义下含义不同），同 URL 会让请求体含义依赖额外字段才能确定 |
| 格式约束保障方式 | 先按 prompt 约定 | 不动 agent 接口与前端契约；不达标时再评估由代码兜底 |

## 风险 & 开放问题

- 路由误判：模型该调 `sango_query` 却直接作答 → 题库外幻觉。缓解：收紧工具描述 + 提示词强约束 + 回归用例
- token 成本：每轮携带全部工具 schema；当前工具数量少可接受，工具变多时再考虑分组
- 破坏性变更：旧字段 400 意味着前后端必须同时上线，不能分段发版
- 天气描述改动会同时影响 feat-A001 的天气场景（描述只影响模型选择、不影响调用结果，预期无回归，仍需回归验证）
- 后续：模板 / 快捷问法尚未立号，本期只保证标签挂靠点存在

## 合并记录（Coco 维护）

| 成员 | 分支名 | 审查结果 | 合并日期 |
|------|--------|----------|----------|
| 小叶 | ye/feat-A003_model-tool-routing | ✅ | — |
| 老陈 | chen/feat-A003_model-tool-routing | ✅ | — |
| 小胡 | hu/feat-A003_model-tool-routing | ✅ | — |

## 交付说明（Coco）

- 2026-09-15 集成：mcp-orchestrator 集成分支 `coco/feat-A003_model-tool-routing` = 老陈（`server.ts` 严格白名单 + `ToolExecutionError` 判 503、`index.ts` 单 Agent 装配、`types.ts`）+ 小胡（`agent.ts` 统一路由提示词与工具同源上报、`sango.ts` 清理孤儿提示词、接线）+ Coco 端到端集成用例。`npm run build` 通过；`node --test "build/test/feat-A002/*.test.js" "build/test/feat-A003/*.test.js"` 66/66 通过（A002 回归 18 + A003 server 19 + A003 agent 16 + 集成 13）。
- 集成用例（`src/test/feat-A003/integration.test.ts`）用真实 `server.ts` + 真实 `Agent` + 真实 `SangoService` 起 HTTP 服务，只把 MCP transport 与 LLM 换成替身，按验收 ①–⑩ 断言实际调用的工具名与信封；与老陈的 StubAgent 契约用例、小胡的 Agent 直调用例互补，不重复。
- mcp-web：`ye/feat-A003_model-tool-routing` 的 `npm run build` 与 `npm run lint` 全绿（该项目无测试设施，沿用 A002 的待决策项）。mcp-server：只改 `get-forecast` / `get-alerts` 两处 description（声明数据源 NWS、仅覆盖美国境内、非美国地区不要调用），`inputSchema` 与实现未动。
- 发布硬约束：mcp-orchestrator 与 mcp-web 必须同一次发布上线（旧字段 `scenario` / `service` 一律 400，无灰度）；mcp-server 的描述改动可独立发布，但建议同批，避免模型看不到覆盖范围声明。
- 例外记录：mcp-web `origin/main` 仍带 A002 遗留的编译失败（WeatherView.vue TS2345），`ye/feat-A002_build-fix`(4a62ab6) 未合入 main；A003 前端改动（标签关闭改 `setMode(null)`、UX 类型迁到 store）已顺带消除该错误，A003 PR 合入后 main 恢复可编译，build-fix 分支可作废。
- 遗留（不阻塞本期，建议单独立号）：① CLI（`cli.ts`）不注入 tools，工具集只有 MCP 天气工具，而默认提示词已含题库域与 `sango_query` 规则——接口文档已明确 CLI 走默认提示词且非验收路径，但 CLI 下模型可能按题库话术作答或试图调用不存在的工具；② mcp-web `WeatherView.vue` 输入区标签文案「随便一题」与后端指令词「随机一题 / 来一题」不一致（纯展示，不影响功能）；③ 请求体非法 JSON 或超过 32kb 时由 express 默认错误处理返回 HTML，不走 `{ code, data, message }` 信封（A001/A002 起即如此，非本期引入）；④ 分域路由的真实模型命中率只能靠固定问题集实测，本期用例全 mock，只验「调了某工具走什么格式」，建议发布前按需求文档「验证方式」跑一轮真实 LLM 统计。
