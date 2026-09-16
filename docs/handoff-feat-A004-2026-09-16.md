# 上下文交接：feat-A004 三国演义解读（2026-09-16 第六轮）

**1. 起点文件**
- 本交接（新会话第一件事读它）：`D:\workplace\dev-docs\docs\handoff-feat-A004-2026-09-16.md`
- 团队约定（唯一权威）：`D:\workplace\dev-docs\AGENTS.md`

**2. 范围清单**（一次读全）
- `dev-docs\docs\mcp-server-architecture.md` —— 架构定稿；`dev-docs\mcp-orchestrator\api\feat-A004-sango-classics-rag.md` —— 接口文档定稿（注册表 env：MCP_WEATHER_SCRIPT / MCP_SANGO_SCRIPT）
- `dev-docs\docs\sango-classics-rag-design.md` —— 技术方案定稿；`dev-docs\requirements\feat-A004-sango-classics-rag.md` —— 需求定稿；`dev-docs\docs\三国演义.txt` —— 语料源
- `mcp-server\sango\` —— TS 子项目：src/index.ts（装配层 35 行）、src/types.ts（Chapter 字段注释）、src/search/sango-index.ts（异常分级）、src/tools/sango-novel-search.ts（registerTool 拆分）、src/utils/hash.ts + text.ts；data/（corpus 120 回 1377 段、alias.json 398 别名、vectors 1377×256 哈希向量）
- `mcp-server\AGENTS.md` —— 已追加「数据加载异常处理」规范（与 registerTool / 代码分层 / JSDoc / version 读 package.json / main().catch 并列）
- `mcp-server\weather\` —— 已迁目录零改动；`mcp-orchestrator\` —— 需求分支已合入（transport 注册表 + 三件套 + A004 测试 5 份，全量 102/102 绿）
- `mcp-web\` —— 小叶确认无需改动（ye/feat-A004 分支无提交）

**3. 已定决策**（结论自包含，禁止重读来源）
- 架构：单仓多 MCP 独立构建部署；weather 迁目录零改动；sango TS 打底；不新建独立仓库
- 工具契约：sango_novel_search（source sanguo-yanyi/sanguozhi、query、limit 默认 5 max 20）；输出【出处】第N回 <回目> · 段X（类型）+ 原文；无命中「未召回任何原文段落」；非法 source → 工具报错 → 503
- 检索：MCP 工具（D1）、本地 embedding（D2）、独立 sango_query（D3）、source 保留（D4）、Python 侧车构建期向量线上只读（D5）；BM25+向量 hybrid（内存余弦）；不做 query 改写/rerank/专用向量库
- 生成约束三件套：prompt 5 条 + 引用硬校验（别名表 ID 优先 关羽→P002、未命中 NER、退化字符串包含；v1 只校验人名）+ 兜底（原文片段+出处+结论句）
- 注册表：MCP_WEATHER_SCRIPT（必填，兼容旧 MCP_SERVER_SCRIPT/argv[2]）+ MCP_SANGO_SCRIPT（可选，缺配→503）；构造器保留单字符串重载
- 向量：BGE-M3 未下载 → 确定性哈希降级（FNV-1a 32 位，Python/TS 两侧一致），TODO 恢复；依赖 = 根 npm workspaces
- **负责人代码审查意见（2026-09-16 全部落实并沉淀 AGENTS.md）**：① 代码组织拆分 ② registerTool ③ JSDoc 业务注释 ④ version 读 package.json ⑤ 入口 main().catch ⑥ **数据加载异常捕获（corpus 致命/向量降级 BM25）⑦ Chapter 字段注释 ⑧ registerTool 处理函数拆独立文件、registerTool 作入参传入**
- **底本/点校版权** = 语料版本来源（毛本/嘉靖本等）与现代点校整理者著作权确认；上线前阻塞项，开发不阻塞
- 流程（负责人确认）：等小叶结束（已结束）→ 一起提测（负责人端到端验收）→ 验收通过 → Coco 发起 main PR → 负责人合并；**验收通过前不发起 PR**
- 子代理 spawn：prompt 参数直传、`-s danger-full-access`、模型 `deepseek-v4-flash`、子代理只产出文件不做 git、阻塞式长超时

**4. git 状态**
- dev-docs：`chen/feat-A004_sango-classics-rag`，HEAD=`d61959c`（第六轮交接+HEAD 同步，待推送，ahead 4）；origin=`8d54139`（**git 状态一律以新会话 `git status -sb` / `git rev-parse HEAD` 实测为准**）
- mcp-server：`chen/feat-A004_sango-classics-rag`，HEAD=`815cd42`（异常捕获+registerTool 拆分+Chapter 注释+AGENTS 规范，**已提交未推送**）；origin=`13bc08d`
- mcp-orchestrator：需求分支 `coco/feat-A004_sango-classics-rag`=`6aac258`（已推）
- mcp-web：`ye/feat-A004_sango-classics-rag`（基于 origin/main，无提交未推送；小叶确认无需改动）
- **⚠️ 443 网络问题**：mcp-server `815cd42` 与 dev-docs `d61959c`（含 22fecbe/4152d1e/b4d6cb7）均因 github.com:443 连接超时未推送；本地提交已就位，网络恢复后重试 push（一次成功即可，勿反复打）

**5. 待办任务**（下一步）
- **重试推送**：mcp-server `815cd42` → origin；dev-docs 第六轮交接 → origin（443 恢复后）
- **提测（等小叶结束，已结束）**：Coco 准备提测摘要——三仓变更文件清单 / 每文件改动点 / 建议验证关键路径（端到端：配 env 拉起 weather+sango → 真实 LLM 跑「温酒斩华雄」→ 检索/归纳/校验/兜底全链路；/api/tools 合并 4 工具；非法 source 503；题库/天气不回归）→ 负责人在需求分支验收
- 验收通过 → Coco 发起 main PR（mcp-server / mcp-orchestrator / dev-docs 三个，或按负责人要求合并）→ 负责人合并
- 上线前阻塞项：底本/点校版权确认；BGE-M3 恢复（可选优化）
- 探针 B（H1 召回质量）补跑

**6. 禁止重读**
- 已定决策只读结论（架构文档、接口文档、本交接 §3）；子代理产出文件即最终依据
- 各轮过程无需重读；本交接即完整上下文