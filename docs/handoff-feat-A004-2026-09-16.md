# 上下文交接：feat-A004 三国演义解读（2026-09-16 第四轮）

**1. 起点文件**
- 本交接（新会话第一件事读它）：`D:\workplace\dev-docs\docs\handoff-feat-A004-2026-09-16.md`
- 团队约定（唯一权威）：`D:\workplace\dev-docs\AGENTS.md`

**2. 范围清单**（一次读全）
- `dev-docs\docs\mcp-server-architecture.md` —— 架构定稿（单仓多 MCP / weather 迁目录 / sango TS 新增 / 独立构建部署）
- `dev-docs\mcp-orchestrator\api\feat-A004-sango-classics-rag.md` —— 接口文档定稿（已校对，含注册表 env 配置 MCP_WEATHER_SCRIPT/MCP_SANGO_SCRIPT）
- `dev-docs\docs\sango-classics-rag-design.md` —— 技术方案定稿；`dev-docs\requirements\feat-A004-sango-classics-rag.md` —— 需求定稿
- `dev-docs\docs\三国演义.txt` —— 语料源（120 回，只清洗不改内容；底本/点校版权上线前确认）
- `mcp-server\sango\` —— TS 子项目，**已按负责人意见重构**（第四轮）：src/index.ts 37 行装配层（registerTool）、src/types.ts（公共类型）、src/search/sango-index.ts（SangoIndex 类）、src/utils/hash.ts + text.ts；data/（corpus 120 回 1377 段、alias.json 398 别名、vectors 1377×256 哈希向量）
- `mcp-server\weather\` —— 已迁目录（内容零改动）
- `mcp-orchestrator\` —— 需求分支已合入：transport 多 server 注册表（transport.ts）+ 生成约束三件套（agent.ts/citation.ts）+ A004 测试 5 份（35 例）；全量 102/102 测试绿
- `mcp-web\` —— 小叶已核对：**确认无需改动**（前端与定稿契约逐项一致；「已接入功能」为静态卡片不消费 /api/tools，不纳入 sango_novel_search），分支 ye/feat-A004_sango-classics-rag 无提交

**3. 已定决策**（结论自包含，禁止重读来源）
- mcp-server 单仓 = 各 MCP 子项目集合，独立构建、独立部署；weather 仅迁移目录零改动；sango TypeScript 打底；不新建独立仓库
- 工具 = `sango_novel_search`：source（sanguo-yanyi 本期/sanguozhi 预留）/ query / limit（默认 5，max 20）；输出【出处】第N回 <回目> · 段X（类型）+ 原文；无命中「未召回任何原文段落」；非法 source → 工具报错 → 503
- 检索 = MCP 工具（D1）、本地 embedding（D2）、独立于 sango_query（D3）、Python 侧车构建期出向量线上只读（D5）；BM25+向量 hybrid（内存余弦）；不做 query 改写/rerank/专用向量库
- 生成约束三件套：prompt 5 条 + 引用硬校验（别名表 ID 优先 关羽→P002、未命中全量 NER、退化字符串包含；v1 只校验人名）+ 兜底（原文片段+出处+结论句）
- orchestrator 注册表：MCP_WEATHER_SCRIPT（必填，兼容旧 MCP_SERVER_SCRIPT/argv[2]）+ MCP_SANGO_SCRIPT（可选，缺配→sango 不可用→503）；构造器保留单字符串重载
- 向量：BGE-M3 未下载 → 确定性哈希降级（FNV-1a 32 位 unigram+bigram 256 维，Python/TS 两侧一致），build_vectors.py 留 TODO 恢复；依赖 = 根 npm workspaces
- **第四轮负责人意见落实**：① 代码组织按最佳实践拆分（类独立文件/utils 目录/公共类型独立文件，不过度塞入）② server.tool→server.registerTool（SDK 1.30.0 deprecated）③ JSDoc 从业务角度适量注释、难懂技术点（哈希与 Python 对齐等）允许技术解释；**底本/点校版权 = 语料来源版本（《三国演义》底本如毛本/嘉靖本）与现代点校整理者著作权确认，上线前阻塞项，开发不阻塞**
- 流程（负责人确认）：等小叶结束 → 一起提测（负责人端到端验收）→ 验收通过 → Coco 发起 main PR → 负责人合并。**验收通过前不发起 PR**
- 子代理 spawn 经验：prompt 参数直传（PowerShell 管道打乱中文）；`-s danger-full-access`（不与 --approve-for-me 同用）；模型 `deepseek-v4-flash`；子代理只产出文件不做 git；阻塞式长超时等待

**4. git 状态**
- dev-docs：`chen/feat-A004_sango-classics-rag`，HEAD=`99d7b20`（交接第四轮待提交），已推送
- mcp-server：`chen/feat-A004_sango-classics-rag`，HEAD=`568d414`（第四轮重构，**推送待重试**——443 间歇超时，origin 仍 9911910）
- mcp-orchestrator：需求分支 `coco/feat-A004_sango-classics-rag`=`6aac258`（已推，含小胡 3658a2d + 老陈 aaa1575）；全量 102/102 测试绿
- mcp-web：`ye/feat-A004_sango-classics-rag`（基于 origin/main 9a48b35，无提交、未推送；小叶确认无需改动）

**5. 待办任务**（下一步）
- **推送 mcp-server 568d414**（443 恢复后执行）
- **提测（等小叶结束，已结束）**：Coco 准备提测摘要——变更文件清单（三仓）、每文件改动点、建议验证关键路径（端到端：配 env 拉起 weather+sango → 真实 LLM 跑「温酒斩华雄」→ 检索/归纳/校验/兜底全链路；/api/tools 合并 4 工具；非法 source 503；题库/天气不回归）→ 负责人在需求分支验收
- 验收通过 → Coco 发起 main PR（mcp-server、mcp-orchestrator、dev-docs 三个，或按负责人要求合并）→ 负责人合并
- 上线前阻塞项：底本/点校版权确认；BGE-M3 恢复（可选优化）
- 探针 B（H1 召回质量）补跑

**6. 禁止重读**
- 已定决策只读结论（架构文档、接口文档、本交接 §3）；子代理产出文件即最终依据
- 本会话各轮过程无需重读；本交接即完整上下文

