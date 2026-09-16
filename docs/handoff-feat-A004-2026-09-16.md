# 上下文交接：feat-A004 三国演义解读（2026-09-16 第三轮）

**1. 起点文件**
- 本交接（新会话第一件事读它）：`D:\workplace\dev-docs\docs\handoff-feat-A004-2026-09-16.md`
- 团队约定（唯一权威）：`D:\workplace\dev-docs\AGENTS.md`

**2. 范围清单**（一次读全，均实测存在/已提交）
- `dev-docs\docs\mcp-server-architecture.md` —— 架构定稿（单仓多 MCP / weather 迁目录 / sango TS 新增 / 独立构建部署）
- `dev-docs\mcp-orchestrator\api\feat-A004-sango-classics-rag.md` —— 接口文档**已按定稿校对**（sango 入口 `mcp-server/sango/dist/index.js`、数据 `sango/data/`、weather 迁移路径、注册表 env 配置 MCP_WEATHER_SCRIPT/MCP_SANGO_SCRIPT）
- `dev-docs\docs\sango-classics-rag-design.md` —— 技术方案定稿（prompt 5 条 / 引用硬校验 / 兜底契约）
- `dev-docs\requirements\feat-A004-sango-classics-rag.md` —— 需求定稿
- `dev-docs\docs\三国演义.txt` —— 语料源（120 回，含站点杂质，只清洗不改内容）
- `mcp-server\AGENTS.md` —— 单仓多 MCP 子项目规范（本会话已提交）
- `mcp-server\weather\src\index.js` —— weather 已迁目录（内容零改动，git 识别 100% rename）
- `mcp-server\sango\` —— 新增 TS 子项目：src/index.ts（sango_novel_search）、data/corpus/sanguo-yanyi/001-120.json（1377 段）、data/alias.json（398 别名→148 人物）、data/vectors/sanguo-yanyi.bin（1377×256 哈希向量）、scripts/（build_corpus/build_vectors/build_alias/verify_mcp）
- `mcp-orchestrator\src\transport.ts` —— 多 server 注册表（weather+sango 双 stdio 子进程）；`index.ts`/`cli.ts` 已接线
- `mcp-orchestrator\src\agent.ts`、`src\citation.ts` —— 生成约束三件套落地（小胡）；`src\test\feat-A004\` 共 5 份测试（小胡 3 + 老陈 2）

**3. 已定决策**（结论自包含，禁止重读来源）
- 负责人拍板（2026-09-16）：mcp-server 单仓 = 各 MCP 子项目集合，独立构建、独立部署；weather 仅迁移目录到 `mcp-server/weather/`（代码/行为零改动）；三国 = `mcp-server/sango/` 新增，TypeScript 打底；不新建独立仓库（拆仓条件见架构文档 §4）
- 工具名 = `sango_novel_search`：入参 source（enum：sanguo-yanyi 本期 / sanguozhi 预留）/ query / limit（默认 5，max 20）；返回【出处】第N回 <回目> · 段X（类型）+ 原文段落；无命中「未召回任何原文段落」；非法 source 工具报错 → orchestrator 503
- 检索 = MCP 工具（D1）、本地 embedding（D2）、独立于 sango_query（D3）、保留 source（D4）、Python 侧车构建期出向量线上只读（D5）；BM25+向量 hybrid（内存余弦）；明确不做 query 改写 / rerank / 专用向量库
- 生成约束三件套：prompt 5 条（回答前必先调 sango_novel_search / 人名以召回原文为准等）+ 引用硬校验（答案人物集合 ⊆ 召回人物集合；别名表 ID 优先 关羽→P002、未命中全量 NER、再退化字符串包含；v1 只校验人名）+ 兜底（原文片段+出处+结论句）
- **本会话落地决策**：orchestrator 注册表 env 配置 = `MCP_WEATHER_SCRIPT`（必填，兼容旧 MCP_SERVER_SCRIPT / argv[2]）+ `MCP_SANGO_SCRIPT`（可选，缺配→sango 不可用→503）；transport 构造器保留单字符串重载（A002/A003 mock 兼容）；BGE-M3 未下载（环境无 torch）→ 确定性哈希向量降级（FNV-1a 32 位 unigram+bigram 256 维，Python/TS 两侧一致），build_vectors.py 留 TODO 恢复；依赖 = 根 npm workspaces（weather+sango 共享根 node_modules）；GET /api/tools 合并 weather+sango+sango_query；/api/chat 无字段变更
- 语料源 = `dev-docs/docs/三国演义.txt`；底本/点校版权**上线前必须确认**（上线阻塞项，不阻塞开发）
- 探针 A 复测通过（A2 4/4、A3 拒答不变、工具调用率 7/7）；探针 B（H1 召回质量）开发完成后补跑
- 子代理 spawn 经验：prompt 参数直传（PowerShell 管道打乱中文为 ?）；`--approve-for-me` 与 `-s` 互斥，用 `-s danger-full-access`；子代理模型 `deepseek-v4-flash`；子代理只产出文件、不做 git（提交/推送/合入由 Coco 代办）；spawn 后阻塞式长超时等待

**4. git 状态**（本会话已全部提交并推送，2026-09-16 14:04 确认远端一致）
- dev-docs：分支 `chen/feat-A004_sango-classics-rag`（origin 同），HEAD=`2347b23`（交接第三轮待提交）；远端已含 7b1651d（交接+架构+接口初稿）+ 2347b23（接口文档校对）
- mcp-server：分支 `chen/feat-A004_sango-classics-rag`（origin 同，跟踪已设），HEAD=`9911910`（135 文件：weather 迁移+sango 子项目+AGENTS.md）
- mcp-orchestrator：
  - 需求分支 `coco/feat-A004_sango-classics-rag` = `6aac258`（已推，含两个合入 merge：ce8ebb5 小胡 + 6aac258 老陈）
  - `hu/feat-A004_sango-classics-rag` = `3658a2d`（已推）
  - `chen/feat-A004_sango-classics-rag` = `aaa1575`（已推）
- 需求分支全量验证：build exit 0，102/102 测试全绿（A002 18 + A003 49 + A004 35）

**5. 待办任务**（下一步）
- **端到端联调/提测前**：mcp-orchestrator 需求分支需配 env 启动验证（MCP_WEATHER_SCRIPT=`D:\workplace\mcp-server\weather\src\index.js`、MCP_SANGO_SCRIPT=`D:\workplace\mcp-server\sango\dist\index.js`；sango 需先 `npm --prefix sango run build`，dist 为 gitignored 构建物）；用真实 LLM 跑「温酒斩华雄」等路由归属用例验证三件套端到端（检索→归纳→校验→兜底），确认 alias.json 真实 ID 与小胡 stub 一致
- 小叶：接口文档已定稿 → 可开工；本期无 HTTP 字段变更（/api/chat 不变、/api/tools 工具列表新增 sango_novel_search），前端默认无需改动
- 上线前阻塞项：底本/点校版权确认；BGE-M3 恢复（可选优化，scheme=1 时 TS 侧退化为 BM25-only 并告警）
- 提测流程（Coco 发起）：需求分支验收 → 通过后发起 main PR（mcp-server、mcp-orchestrator、dev-docs 各一个，或按负责人要求合并）
- 探针 B（H1 召回质量）补跑；weather 迁移的 node_modules 选择已定（根共享+workspaces），如后续独立部署需登记

**6. 禁止重读**
- 已定决策（架构文档 §1/§3/§6、接口文档契约、本交接 §3）只读结论；子代理产出文件即最终依据，无需重读子代理过程
- 本会话过程（三次 spawn 的踩坑/等待）无需重读；本交接即完整上下文
