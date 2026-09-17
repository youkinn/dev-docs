# 上下文交接：feat-A004 三国演义解读（2026-09-16 第十轮，已压缩，新会话从本文件起步）

**1. 起点文件**
- 本交接（新会话第一件事读它）：`D:\workplace\dev-docs\docs\handoff-feat-A004-2026-09-16.md`
- 团队约定（唯一权威）：`D:\workplace\dev-docs\AGENTS.md`

**2. 范围清单**（一次读全，读不到=路径写错回查不猜）
- `dev-docs\docs\mcp-server-architecture.md` —— 架构定稿（单仓多 MCP、独立构建部署、注册表 env）
- `dev-docs\mcp-orchestrator\api\feat-A004-sango-classics-rag.md` —— 接口文档定稿（注册表 env：MCP_WEATHER_SCRIPT / MCP_SANGO_SCRIPT）
- `dev-docs\docs\sango-classics-rag-design.md` —— 技术方案定稿
- `dev-docs\docs\sango-mcp-routing-design.md` —— 路由方案（确定性优先 + LLM 兜底；风云三国=本地 sango_query）
- `dev-docs\bugs\feat-A0004-bugs.md` —— bug 票（2 条均已修复：响应慢→快路径+注入收窄+命中只出最符合一段；固定格式→prompt 第 6 条+服务端强制；bug1 剩余耗时依赖火山缓存）
- `dev-docs\requirements\feat-A004-sango-classics-rag.md` —— 需求定稿
- `dev-docs\docs\三国演义.txt` —— 语料源（120 回）
- `mcp-server\sango\` —— TS 子项目：src/index.ts、src/types.ts、src/search/sango-index.ts、src/tools/sango-novel-search.ts、src/utils/；data/corpus/sanguo-yanyi/（001~120.json）、data/alias.json、data/vectors/sanguo-yanyi.bin；dist/index.js（构建产物）
- `mcp-server\weather\src\index.js` —— weather 入口（迁移后目录，零改动）
- `mcp-orchestrator\README.md` —— 含「新增一个 MCP server（通用流程）」（第八轮新增）
- `mcp-web\src\views\WeatherView.vue` + `src\stores\chat.ts` + `src\api\client.ts` —— 第七轮「三国演义」标签 + domain=sango-novel

**3. 已定决策**（结论自包含，禁止重读来源）
- 架构：单仓多 MCP 独立构建部署；weather 迁目录零改动；sango TS 打底；不新建独立仓库
- 工具契约：sango_novel_search（source sanguo-yanyi/sanguozhi、query、limit 默认 5 max 20）；输出【出处】第N回 <回目> · 段X（类型）+ 原文；无命中「未召回任何原文段落」；非法 source → 工具报错 → 503
- 检索：MCP 工具（D1）、本地 embedding（D2）、独立 sango_query（D3）、source 保留（D4）、Python 侧车构建期向量线上只读（D5）；BM25+向量 hybrid（内存余弦）；不做 query 改写 / rerank / 专用向量库
- 生成约束三件套（第九轮已改造）：prompt 能力三 5 条→6 条（第 6 条固定格式：结论 + 「引用的原文」（出处：第X回 回目））；引用硬校验改本地别名表扫描（0 次 LLM，删 LLM 抽人名 + NER）；兜底不变（原文片段+出处+结论句）
- **Bug1 快路径（第九轮，已落地推送 6105cc3 + 9da8f0a）**：`domain=sango-novel` 预调 sango_novel_search（limit 5）→ 按【出处】拆分为独立片段 → **只取最符合前 3 段、每段截为「出处头 + 检索词附近窗口」**注入 user 消息（注入 2500→~500 字）→ 单次 LLM 生成，可用工具移除检索工具防重复调；**命中回答只输出最符合一段，禁止长篇大论（9da8f0a）**；响应 7~17s → 目标 1~2s（实测仍 7~17s，受火山无缓存影响，待火山缓存开通）
- **Bug2 固定格式（第九轮，已落地推送 6105cc3）**：prompt 能力三第 6 条 + applyNovelCitationGuard 强制（格式不符 → 兜底 buildFallback 本身即固定格式）；出处只到回目
- **注册表与启动（第八轮负责人决策 2026-09-16，已落地）**：注册表只认 .env 的 `MCP_WEATHER_SCRIPT`（必填）+ `MCP_SANGO_SCRIPT`（可选，缺配→503）；已移除旧 `MCP_SERVER_SCRIPT` / `argv[2]` 兼容（测试锁定）；orchestrator 用 `npm run dev` 无参启动（先 build 后 node build/index.js，删除 web script）；`MCPTransport` 构造器保留单字符串重载（测试/单 server 用）；新增 MCP 通用流程见 orchestrator README
- **启动路径（orchestrator .env 已配，本地 git 忽略）**：`MCP_WEATHER_SCRIPT=D:\workplace\mcp-server\weather\src\index.js`、`MCP_SANGO_SCRIPT=D:\workplace\mcp-server\sango\dist\index.js`
- 前端显式入口（第七轮）：聊天页「三国演义」标签（风云三国旁）→ `/api/chat` 带 `domain=sango-novel`；agent 软性域提示（问候/天气不硬锁）；`sango` 语义不变（风云三国题库，硬锁）
- 向量：BGE-M3 未下载 → 确定性哈希降级（FNV-1a 32 位，Python/TS 两侧一致），TODO 恢复
- 底本/点校版权 = 上线前阻塞项，开发不阻塞
- 流程：验收通过前不发起 main PR；提测不附检查清单（已沉淀 AGENTS.md 第 7 条）；合并后 Coco 更新需求文档「合并记录」表

**4. git 状态**（本地=origin，均已推送，无未推送提交）
- mcp-orchestrator：`coco/feat-A004_sango-classics-rag`=`9da8f0a`（第九轮：Bug1 快路径 + Bug2 固定格式 + 引用校验本地化去 NER + 命中只输出最符合一段，**已推送**；前序 `6105cc3`）
- mcp-web：`ye/feat-A004_sango-classics-rag`=`165b4dd`（第七轮：三国演义标签 + domain=sango-novel，**已推送**）
- dev-docs：`chen/feat-A004_sango-classics-rag`=以 origin 实际 HEAD 为准（本交接提交后不回填 hash，避免循环；最近已推送 `0a8f334`，含 `8888da2`）
- mcp-server：`chen/feat-A004_sango-classics-rag`=`815cd42`（本轮未改动）
- 测试：orchestrator 全量 102/102 绿（`node --test "build/test/*/*.test.js"`；删 3 个孤儿 NER 测试后 99，补命中收窄 3 测试后 102）

**5. 待办任务**（下一步）
- **负责人端到端验收（进行中）**：按 §3 验收路径 5 条在需求分支验收；发现问题 → 打回 → 成员修正 → Coco 复审 → 重新提测
- **orchestrator 运行中**：`npm run dev`（session 82520，端口 3000，已加载 9da8f0a 新代码；需重启时：停 PID → `npm run dev`）
- 验收通过 → Coco 发起 main PR（mcp-server / mcp-orchestrator / dev-docs）→ 负责人合并 → Coco 更新需求文档「合并记录」表
- 上线前阻塞项：底本/点校版权确认；BGE-M3 恢复（可选优化）
- 探针 B（H1 召回质量）补跑
- 火山方舟缓存显式开通（用户处理中，挂起不动代码）
- **上下文收窄（已落地 9da8f0a，原小胡工作单）**：`agent.ts` 快路径注入只取最符合前 3 段 + 检索词附近窗口（LLM 输入 2500→~500 字）；命中回答只输出最符合一段；测试已补（102/102）；预期火山缓存开通后 7~17s → 1.8~3.2s（实测）

**6. 禁止重读**
- 已定决策只读结论（架构文档、接口文档、本交接 §3）；子代理产出文件即最终依据
- 各轮过程无需重读；本交接即完整上下文