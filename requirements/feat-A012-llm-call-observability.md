# feat-A012：调用链路可观测增强（`reasoning_tokens` + 重试标识 + 路由来源 + Token 明细 / 图表缓存维度 + 状态列简化）

> 特性号：feat-A012
> 状态：已提测（2026-09-23 提测：Coco 审查通过，负责人在需求分支验收）
> 作者：Coco
> 涉及项目：mcp-orchestrator（主要）、mcp-web
> 日期：2026-09-22
> 关联：bug-00018（起因之一：思考 token 吃满 `max_tokens`）、feat-A003 / feat-A011（路由分层：L1 标签 / L2 关键词 / L3 向量 / L4 轻量分类）、feat-A007 / feat-A008（日志采集与页面）、feat-A011（`cached_tokens` 同法扩展）

## 背景

起因两组：bug-00018 暴露的观测盲区（第 1–3 条）、日志页展示问题（第 4 条）。

1. 生成轮空答案的根因是「思考 token 吃满 `max_tokens`」，但日志只记 `prompt_tokens` / `completion_tokens` / `cached_tokens`，**`reasoning_tokens` 未采集**，`max_tokens`（调用上限）也未落库 —— 判断「正文为空是否被上限截断」缺对照值；定位只能靠线下探针重放。「重试」动作也与首次调用无法区分（只有 `seq` 递增）。
2. LLM侧输入 token 只有总数，看不出**花在哪**（域提示词 / 检索注入原文 / 用户输入），优化输入 token 缺少依据。
3. `request_logs` 无路由层级字段，只有请求体原样回传的 `domain`（auto 时为空）→ L2 关键词命中与 L3 向量命中在日志里形状完全一致（无 `classify` 行 + 一次 `generation` + 一次工具调用），**「快路径是否生效、命中哪一层」只能靠时间先后硬推**；排查 `sango_novel_search` 这类调用发生在 LLM 前还是后时缺少权威依据。
4. Token 图表只画「输入 / 输出」两根柱子，`cached_tokens` 虽已落库（feat-A011），**图上看不出缓存省了多少**；日志列表状态列对失败行并排给出「失败」与响应码两枚红标签，冗余且响应码比状态更抢眼。

## 目标

- [√] `llm_call_logs` 新增 `reasoning_tokens`（取自 `usage.completion_tokens_details.reasoning_tokens`，provider 不返回为 `null`），全量记录所有调用轮，不限于重试轮
- [√] 新增重试标识字段（如 `attempt`：1 = 首次 / 2 = 重试），由服务端写入，不靠前端按 `seq` / 时间推断 （伪造数据）
- [√] `request_logs` 新增路由来源 `route_source`（枚举 `label` / `keyword` / `vector` / `classify` / `free`），历史行为 `null`
- [√] `llm_call_logs` 新增输入 token 分段估算（JSON 列，如 `input_breakdown`）：`system`（域提示 / 分类提示）、`user`（当前输入）、`injected`（检索注入片段）；`history` / `tools` 保留字段、当前恒 0
- [√] 输出侧拆分为「思考 / 正文」：正文 = `completion_tokens` − `reasoning_tokens`（两项均为 provider 真值）
- [√] `llm_call_logs` 新增 `max_tokens`（该次调用的输出上限，取调用点参数原值），历史行为 `null`
- [√] `GET /api/v1/logs` 明细回传以上字段
- [√] LLM 调用子表：`Token（输入/输出）` 合并列拆为「输入 Token」「输出 Token」两列，各自 hover 展示明细（输入列＝分段估算；输出列＝思考 / 正文 + `max_tokens` 上限）
- [√] 日志列表行 hover 类型标签可见「是否重试」与「路由来源」（不加角标、不占列宽）
- [√] Token 图表：单根堆叠柱（缓存输入 / 未缓存输入 / 输出 三段，柱高 = 该桶输入 + 输出合计），y 轴上方显示区间总 token 数与缓存命中率
- [√] 日志列表（最外层表格）状态列简化：失败行只保留「失败」标签（不展示响应码），hover 展示异常 code + 错误消息

## 非目标

- **不做输入分段的精确对账**：provider 不提供按段 token，分段为本地估算，**不要求各段之和等于 `prompt_tokens`**，只呈现各段各自的值
- 不引入 tokenizer 依赖（本地字符启发式估算；后续需要更准再议）
- 不改 `/api/chat` 请求与响应形状
- 不改重试策略本身（口径见 bug-00018）
- 不做思考预算调优 / 提示词调优
- 不做路由来源的查询过滤（列表标记 + 明细字段够用）
- `input_breakdown` 分段不按 `cached_tokens` 拆分（分段只记提示词构成，缓存命中不重复计入；缓存在 Token 图表中单独体现，见目标）
- Token 图表不按输入 / 输出分柱、不为缓存单独加柱、不加缓存命中率趋势线、不按域 / 模型拆分，只保留单根堆叠柱与总 token 数、命中率两个读数
- 不改状态列的筛选口径（`status` / `responseCode` 查询条件不变），只改展示
- 不改明细子表（LLM 调用 / 工具调用）的状态列
- 不改最外层表格的 `Token（输入/输出）` 合并列（保持原样，不加 hover 明细）

## 验收标准

1. [√] 库表迁移（旧库 ALTER）后历史行 `reasoning_tokens` / `max_tokens` / `route_source` / `input_breakdown` 为 `null`，新行按实际落值
2. [ ] 一次发生重试的请求：两轮调用分别落库，重试轮标识可区分
3. [√] `GET /api/v1/logs` 明细含 `reasoningTokens`、`maxTokens`、重试标识、`routeSource`、输入分段
4. [√] LLM 调用子表：「输入 Token」「输出 Token」两列分开展示；输入列 hover 见各段估算值（中文段名：系统提示 / 用户输入 / 检索注入，标注「估算」），输出列 hover 给出「输出 Token = 思考 + 正文」算式与代入过程（正文 = 输出合计 − 思考）及 `max_tokens` 上限；关闭思考的轮次不显示「思考 0」；最外层表格 Token 列保持原样
5. [√] 五条路径各走一次（L1 标签 / L2 关键词 / L3 向量 / L4 分类编号 1 或 2 / L4 编号 99），`routeSource` 与实测路径一致
6. [√] 最外层表格「类型」列不加角标：hover 类型标签可见「路由来源：标签路由（label）」与「重试：存在变参重试（attempt=2）」（有哪项列哪项，两项都无则不弹）；LLM 子表 hover 可见中文 `finish_reason`
7. [√] Token 图表：区间内同时存在缓存命中与未命中的调用时，单根柱子呈三段堆叠（缓存输入 + 未缓存输入 + 输出），段读数之和 = 该桶输入 + 输出合计；`GET /api/v1/logs/token-stats` 每桶返回的缓存值与页面读数一致
8. [√] y 轴上方显示区间总 token 数（输入 + 输出合计）与缓存命中率（= 缓存合计 / 输入合计），读数与接口返回一致；区间输入合计为 0 时命中率显示 `—`
9. [√] 历史区间（`cached_tokens` 全为 `null`）按 0 计入未缓存：整段为「未缓存」，无负值段 / 空白段
10. [√] 日志列表状态列：失败行只有一枚「失败」标签（页面不出现响应码文本），hover 同时可见异常 code 与错误消息；成功行仍为单枚「成功」标签
11. [√] `npm run build` 通过、既有测试全绿
12. [√] token 数值展示（最外层 Token 列、LLM 子表输入 / 输出 Token 列与 hover 明细、区间总 Token、图表 y 轴）为精确整数 + 千分位，无 `k` / `m` 缩写；null 仍显示 `—`

## 接口影响

| 变更 | 归属 | 说明 |
|------|------|------|
| `llm_call_logs` 新增 `reasoning_tokens` / `max_tokens` / 重试标识列（含旧库迁移） | 老陈（总台） | 出参形状不变，仅新增字段；`max_tokens` 由调用点写入 |
| `llm_call_logs` 新增 `input_breakdown`（JSON：各段估算值） | 老陈（总台） | 分段在调用点计算后落库；估算值，不做对账 |
| `request_logs` 新增 `route_source`（含旧库迁移） | 老陈（总台） | 枚举 `label`/`keyword`/`vector`/`classify`/`free`；由编排侧判定、随响应回传落库，不改 `/api/chat` 响应形状 |
| `GET /api/v1/logs` 明细增 `reasoningTokens` / `maxTokens` / 重试标识 / `routeSource` / 输入分段 | 老陈（总台） | 缺省 `null` |
| 日志页（LLM 调用子表）：Token 拆「输入 / 输出」两列 + 各列 hover 明细（中文段名 / 算式代入 / `max_tokens`）；列表行 hover 类型标签展示「是否重试」「路由来源」 | 小叶（前厅） | 标记语义＝该请求内发生过重试 / 本次命中哪一层；hover 中文表达；最外层表格 Token 列不动 |
| `GET /api/v1/logs/token-stats` 每桶新增 `cachedTokens`（`cached_tokens` 按桶聚合，历史行 `null` 计 0） | 老陈（总台） | 查询参数与降级逻辑不变，响应信封不变 |
| Token 图表：单根柱子三段堆叠（缓存输入 / 未缓存输入 / 输出）+ 区间总 token 数与缓存命中率读数 | 小叶（前厅） | 堆叠口径＝缓存 / 未缓存（未缓存 = 输入 − 缓存）；读数标注「区间合计」 |
| 日志列表状态列：失败行单标签 + hover（异常 code + 错误消息） | 小叶（前厅） | 只改最外层表格；明细子表状态列不动 |

## 技术要点

- 输出侧：`正文 = completion_tokens − reasoning_tokens`，两项都是 provider 真值，**精确**；provider 不返回 `reasoning_tokens`（或关闭思考）时为 `null`，此时只显示正文，不显示「思考 0」
- 输入侧：分段在 `src/agent.ts` 的 `callModel` 调用点计算（messages 已结构化：域提示 / 分类提示、用户输入、注入片段），**不从 `request_summary` 反推**（该字段 8000 字符截断）
- 输入分段为**估算**：本地字符启发式，各段之和与 `prompt_tokens` 不要求相等；页面标注「估算」
- `route_source` 判定点：`resolveRoute` 命中专用域（`label` / `keyword`）、L3 向量命中（`vector`）、分类轮编号 1 / 2（`classify`）与 99（`free`）；`resolveRoute` 现只返回域，需新增 L1 与 L2 来源的区分
- 与 feat-A011 的 `cached_tokens` 同法：`src/agent.ts` 落库处 + `src/storage/logs.ts` 列与旧库迁移 + `src/api/v1/logs.ts` 字段
- 缓存口径：`cached_tokens` ⊂ `prompt_tokens`（provider 语义），故「未缓存 = 输入 − 缓存」，两段之和恒等于该桶输入（不加第三根柱）；历史行 `null` 按 0 计入未缓存
- 图表聚合点在 `src/storage/logs.ts` 的 `queryTokenStats`（现只累加 `prompt_tokens` / `completion_tokens`），需加一路 `cached_tokens` 累加；`TokenBucket` 加 `cachedTokens`，前端 `src/api/client.ts` 的 `TokenBucket` 同步
- 图表读数：总 token 数 = 区间输入 + 输出合计，命中率 = 缓存合计 / 输入合计，两者均为**区间合计**（不随桶变化）；输入合计为 0 时命中率显示 `—`
- 防御：单桶若出现 `cached_tokens > prompt_tokens`（异常数据），未缓存段按 0 兜底，不出现负值柱
- 明细子表已有「缓存命中」列（`llmColumns`），重试 / 路由来源标记建议用角标或图标而非新增整列，避免列表过宽
- Token 展示落点：输入分段是**调用级**数据（`llm_call_logs`），故拆列与 hover 明细落在 LLM 调用子表；最外层表格是**请求级**汇总（`input/output`），保持合并列不动
- `max_tokens` 现状是调用点常量（`src/agent.ts` 的 `callModel`，`max_tokens: 1000`），无调用级记录；本特性随调用落库（调用点写入该次生效值），避免将来各调用点分叉后前端硬编码失真
- `max_tokens` 与「思考 + 正文」同量纲（思考计入 `completion_tokens`、上限同时限制两者）：并排展示即可判断本次是否触顶（bug-00018 的正文为空场景）

## 风险 & 开放问题

1. 输入分段是估算值：可能与 `prompt_tokens` 明显不符（中文分词差异），页面必须标注「估算」，否则会被当成账目使用
2. `resolveRoute` 区分 L1 / L2 属新增分支，若触碰既有路由行为须回归 A003 / A011 路由用例
3. 本特性分支须基于 **A011 合并后的 `origin/main`** 拉取
4. 图表与状态列均为 UI 表现，验收须真浏览器 + 真实数据（含至少一次缓存命中的调用）；缺环境时只能读码审查，不得凭推理判定通过（第 11 条）

## 任务与负责人

| 任务 | 负责人 | 依赖 |
|------|--------|------|
| 需求定稿 + INDEX 登记 | Coco | — |
| 接口文档（新字段 + 重试标识 + 路由来源 + 分段口径 + `token-stats` 缓存字段 + 状态列展示契约） | 老陈 | 需求定稿 |
| 总台：库表迁移 / 接口字段 / 重试标识与路由来源写入 / 分段估算与 `max_tokens` 落库 | 老陈 | 接口文档 |
| 编排：调用点分段标记、`max_tokens` 写入与路由来源判定回传（`src/agent.ts`） | 小胡 | 接口文档 |
| 前厅：LLM 调用子表 Token 拆列与 hover 明细 + 重试标记 + 路由来源标记 | 小叶 | 接口文档 |
| 总台：`token-stats` 按桶聚合 `cached_tokens` + 接口字段 | 老陈 | 接口文档 |
| 前厅：Token 图表缓存堆叠与读数 + 状态列简化 | 小叶 | 接口文档 |

## 分支计划

- dev-docs：`coco/feat-A999_a012-*`（文档 / 仓库维护类提交，走 feat-A999；按批次新建，接口文档落 `coco/feat-A999_a012-interface-doc`）
- mcp-orchestrator：需求分支 `coco/feat-A012_llm-call-observability`；成员分支 `chen/feat-A012_llm-call-observability`、`hu/feat-A012_llm-call-observability`
- mcp-web：`ye/feat-A012_log-observability`

## 故事号（Coco 生产）

| 故事号 | 内容 | 负责人 | 状态 |
|--------|------|--------|------|
| story-A012-01 | 实现·总台 / 编排 / 前厅：`reasoning_tokens` / `max_tokens` 与迁移、重试标识、`route_source`、输入分段估算、接口字段、日志页标记、LLM 调用子表 Token 拆列与 hover 明细、Token 图表缓存堆叠与命中率、状态列简化 | 老陈 / 小胡 / 小叶 | 待开工 |

## 变更记录（定稿后）

- 2026-09-23 负责人拍板：明确 Token 明细的落点为 **LLM 调用子表** —— 该表 `Token（输入/输出）` 合并列拆为「输入 Token」「输出 Token」两列、各列 hover 出明细；最外层表格 Token 列不动。
- 2026-09-23 负责人拍板：输出列 hover 明细增加 `max_tokens`（本次调用上限）；该值当前无调用级记录，故随调用落库（`llm_call_logs` 新增列）。
- 2026-09-23 Coco：分支计划补记 dev-docs 文档分支口径（`coco/feat-A999_a012-*`，按批次新建）。
- 2026-09-23 负责人验收打回（`test/feat-A012/test.md`）后的口径变更：①「类型」列不加角标，路由来源 / 重试改为 hover 类型标签展示；②状态列失败行不再展示响应码（原「降为文本」作废）；③Token 图表由「输入堆叠 + 输出」双柱合并为单根三段堆叠柱（缓存输入 / 未缓存输入 / 输出，柱高 = 输入 + 输出合计）；④token 数值不用 `k` / `m` 缩写，改精确整数 + 千分位（负责人原话「由 k 改为 m」，Coco 判断 `m` 会让千级数值显示成 `0.00xm`，改用千分位并已在汇报中提请确认）；⑤耗时 tooltip 重排：`总 = 前端 + 队列等待 + 总台`，`LLM` / `工具` 缩进为 `总台` 子项并给出合计行（总台为服务端墙钟，与 LLM + 工具 不保证相等）；⑥输入 Token hover 段名改中文，输出 Token hover 补算式代入；⑦候选分数表 chunkId 只改展示（去 `sanguo-yanyi:` 前缀），标签命中 tooltip 移至来源列「标签」tag。
