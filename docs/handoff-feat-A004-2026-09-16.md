# 上下文交接：feat-A004 三国演义解读（2026-09-16 第二轮）

**1. 起点文件**
- 本交接（新会话第一件事读它）：`D:\workplace\dev-docs\docs\handoff-feat-A004-2026-09-16.md`
- 团队约定（唯一权威）：`D:\workplace\dev-docs\AGENTS.md`

**2. 范围清单**（一次读全，均实测存在）
- `dev-docs\docs\mcp-server-architecture.md` —— **架构决策已定稿**（单仓多 MCP / weather 迁目录 / sango TS 新增 / 独立构建部署），本会话产出
- `dev-docs\mcp-orchestrator\api\feat-A004-sango-classics-rag.md` —— 接口文档**初稿**（老陈·文档已产出，未提交，待按架构定稿校对）
- `dev-docs\docs\sango-classics-rag-design.md` —— 技术方案定稿（工具名 sango_novel_search、契约、语料工程 §6）
- `dev-docs\requirements\feat-A004-sango-classics-rag.md` —— 需求定稿
- `dev-docs\docs\三国演义.txt` —— 语料源（120 回，含站点杂质待清洗）
- `mcp-server\AGENTS.md` —— 本会话已改写为「单仓多 MCP 子项目」规范
- `mcp-server\src\weather\index.js` —— 天气存量（JS，本次仅迁目录、内容不动）
- `mcp-orchestrator\src\transport.ts` —— orchestrator transport 现状：单 server（`node <path>` 一个子进程）
- `mcp-orchestrator\src\agent.ts`、`sango.ts`、`server.ts` —— 小胡/老陈改造对象
- `mcp-orchestrator\scripts\probe\h2-faithfulness.mjs`、`data\sango-novel\README.md` —— 探针资产（需求分支已含）

**3. 已定决策**（结论自包含，禁止重读来源）
- 负责人拍板（2026-09-16）：**mcp-server 单仓 = 各 MCP 子项目集合，独立构建、独立部署**；天气**仅迁移目录**到 `mcp-server/weather/`（代码/行为零改动）；三国 = `mcp-server/sango/` 新增，**TypeScript 打底**；不新建独立仓库（触发拆仓条件见架构文档 §4）
- 每 MCP = 独立 package.json / build（tsc→dist）/ data / 入口 + 独立 stdio 子进程；改一个只重建/重启那一个，不涉及的不重建不重部署（机制见架构文档 §3）
- 工具名 = **`sango_novel_search`**（非 sanguo-retrieve）：入参 source（enum：sanguo-yanyi 本期 / sanguozhi 预留）/ query / limit（默认 5）；返回按相关度排序的文本块，条目格式【出处】第N回 <回目> · 段X（类型）+ 原文段落；无命中返回「未召回任何原文段落」；非法 source 报错
- 检索 = MCP 工具（D1）、本地 embedding（D2）、独立于 sango_query（D3）、保留 source（D4）、Python 侧车构建期出向量线上只读（D5）；BM25+向量 hybrid 或内存余弦/sqlite-vec；明确不做 query 改写 / rerank / 专用向量库
- 生成约束三件套：prompt 5 条（含「回答前必须先调 sango_novel_search 检索原文」「人名一律以召回原文为准，不得替换或补别名」）+ 引用硬校验（断言答案人物集合 ⊆ 召回人物集合；别名表 ID 优先 关羽→P002、未命中全量 NER、再退化字符串包含；v1 只校验人名）+ 兜底（原文片段+出处+结论句）
- orchestrator：transport 重构为多 server 注册表（weather + sango 两个 stdio 子进程；weather 启动路径随目录迁移同步；GET /api/tools 合并上报；HTTP /api/chat 无新增字段）
- 语料源 = `dev-docs/docs/三国演义.txt`；底本/点校版权**上线前必须确认**
- 探针 A 复测通过（A2 4/4 跟随语料、A3 拒答不变、工具调用率 7/7）；探针 B（H1 召回质量）开发完成后补跑
- 子代理 spawn 经验（本会话踩坑，新会话直接复用）：prompt 必须**参数直传**（PowerShell 管道会把中文打成 `?`）；`--approve-for-me` 与 `-s` 互斥；沙箱 helper 偶发失败改用 `-s danger-full-access`；子代理模型 `deepseek-v4-flash`；子代理只产出文件、不做 git 操作（分支已建好，提交/推送由 Coco 代办）

**4. git 状态**
- dev-docs：分支 `chen/feat-A004_sango-classics-rag`（基于本地 `coco/docs-backlog`，该分支领先 origin/main **6 提交未推送**）；未提交新增：`docs/mcp-server-architecture.md`、`mcp-orchestrator/api/feat-A004-sango-classics-rag.md`
- mcp-server：分支 `chen/feat-A004_sango-classics-rag`（基于 origin/main `27682d5`）；未提交修改：`AGENTS.md`
- mcp-orchestrator：分支 `hu/feat-A004_sango-classics-rag`（基于 `origin/coco/feat-A004_sango-classics-rag` = `b3a4f58`，**已推送**）；干净
- 需求分支 `coco/feat-A004_sango-classics-rag`（mcp-orchestrator）= `b3a4f58` 在远端，成员可 fetch 后拉个人分支
- GitHub 443 间歇性超时，操作前先试连通

**5. 待办任务**（下一步）
- 目标：按架构文档定稿恢复开工——老陈：① `weather/` 目录迁移（git mv，内容零改动，启动路径同步）② `sango/` TS 项目（sango_novel_search + 语料清洗/段切分+类型标注→`sango/data/corpus/` + Python 侧车离线向量 D5→`sango/data/vectors/` + 别名表 `sango/data/alias.json` P001 起关羽→P002）③ orchestrator transport 多 server 注册表 ④ 接口文档按定稿校对；小胡：prompt 5 条 / 引用硬校验 / 兜底落地（可先桩联调，不碰 transport/server/index/cli/types）；小叶：等接口文档后接前端
- 验收：mcp-server 单仓两子项目结构成立；weather 搬迁后启动路径与行为不变；`sango/` tsc build 通过、启动后能 list 并调用 `sango_novel_search`（source=sanguo-yanyi 有结果、非法 source 报错）；orchestrator build + 既有测试全绿（A002/A003 不回归）；接口文档无遗留 TODO
- 产出格式：子代理按 AGENTS.md 交付结构化摘要（产出/关键决策/未解决问题/变更文件清单+每文件行数），不返回文件内容；Coco 代办提交/推送，合入需求分支后由 Coco 发起 main PR

**6. 禁止重读**
- 已定决策 D1–D5、语料准入、环境约束、探针 A 复测过程与数据——只读结论（架构文档 §1/§3 + 本交接 §3）
- 本次会话过程（子代理踩坑 / 暂停 / 重发）无需重读；本交接即完整上下文
