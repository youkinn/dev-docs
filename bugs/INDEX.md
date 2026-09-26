# Bug 索引

编号规则：5 位数字自增，不可重用。

> **本文件只做索引，不记录过程**（2026-09-23 负责人决定）：一行 = 编号 + 现象标题 + 涉及项目 + 关联特性 + 状态 + 修复日期。
> 根因、机制读数、修复口径、验证方式等过程内容**一律写在各票自己的文件**（`bugs/bug-XXXXX-*.md`），此处不复述；无独立文件的票，本行即其唯一记录。

| Bug 号 | 标题 | 涉及项目 | 关联特性 | 状态 | 修复日期 |
|--------|------|----------|----------|------|----------|
| bug-00001 | 知识问答省略/冗余问法未命中题库（「夏侯惇字什么」提示未收录） | mcp-orchestrator | feat-A002 | 已修复 | 2026-09-14 |
| bug-00002 | 选中"风云三国"标签后模型未路由到题库工具 | mcp-orchestrator | feat-A003 | 待修复 | — |
| bug-00003 | 演义检索召回质量不达标（原文有答案却答「演义中未涉及」）。检索侧别名双侧归一化 / 真向量 / 多路重排 / 注入策略四项已随 feat-A004 落地 main；剩余 MIN_COSINE Step4 重定与评测口径；现状以 docs/llm-answer-accuracy-current-state.md 为准 | mcp-server, mcp-orchestrator | feat-A004 | 待修复 | — |
| bug-00004 | 问「第几回」类问句无法作答（提问要的回号被注入与 prompt 两端剥离） | mcp-orchestrator | feat-A004 | 待修复 | — |
| bug-00005 | 「引用原文」与结论不相关 / 无信息量（指针通道对叙述型答案结构性失效） | mcp-server, mcp-orchestrator | feat-A004 | 待修复 | — |
| bug-00006 | 答案已召回但注入视图不可见（注入层 top3 截断 / 窗口裁切） | mcp-orchestrator | feat-A004 | 待修复 | — |
| bug-00007 | 评测集质量缺陷（2400 问：重复 376 / 负样本错标 4 / 超纲 44+） | dev-docs | feat-A004 | 待修复 | — |
| bug-00008 | 召回评测口径缺陷（字面匹配对「概括型答案」失效，A 类读数虚高） | dev-docs | feat-A004 | 待修复 | — |
| bug-00009 | 注入指针 qid 空洞（窗口裁掉引语 → 模型输出无效 [Qn] → Guard 兜底）+ 兜底盲取 fragments[0] 答非所问（华雄题 672 行答案被替换） | mcp-orchestrator | feat-A004 | 已修复 | 2026-09-20 |
| bug-00010 | 演义检索工具出参 quotes[] 重复携带原文子串，响应 / 落库日志体积激增 | mcp-server, mcp-orchestrator | feat-A004 | 已修复 | 2026-09-21 |
| bug-00011 | 首页 / weather / logs 互相切换时页面抖动（顶部宽度不一致），logs 两个标签间切换同样抖动。修复＝预留滚动条槽位（滚动条出现/消失不造成横向位移）；2026-09-22 feat-A010 起实现由 `html { overflow-y: scroll }`（强制常驻滚动条）改为 `html { scrollbar-gutter: stable }`，槽位照旧预留、不常驻绘制滚动条，不抖动效果不变 | mcp-web | feat-A007 | 已修复 | 2026-09-21 |
| bug-00012 | A003 测试 harness 未注入独立日志库 → 测试写入开发库 data/logs.db，日志页出现测试噪声（「随机一题」既有「对话」又有「答题」；负责人核对：该条无耗时、无域，确认为测试数据）。根因（2026-09-26 定位）= `src/test/feat-A003/server.test.ts` 与 `integration.test.ts` 的 createServer 未传 logStore → 默认开开发库，全量测试每次跑都灌入你好/随机一题/答案/A/第一问等（今天 09:39/09:48 两波即两次全量测试）。修复＝两处注入 `createLogStore({ dbPath: ':memory:' })`（chen/bug-00012_harness-in-memory，b061ccd）；存量清理 2026-09-26：特征噪声 6326→2146 → 风云三国/天气域 2146→1568 → 对话类无 LLM 明细测试批 1568→406 | mcp-orchestrator | feat-A007 / feat-A008 | 修复中 | — |
| bug-00013 | 检索诊断 finalScore 无法由接口数据复算（接口回传原始 bm25/cosine，缺 BM25 归一化；cosine 对非向量 top-50 置 null 藏掉向量加分项）。修复＝candidates 增全精度 bm25Norm + cosine 全量回传 | mcp-server, mcp-orchestrator, mcp-web | feat-A009 | 已修复 | 2026-09-22 |
| bug-00014 | 第 81 回回目分隔符多余空格（`急兄仇张飞遇害　　雪弟恨先主兴兵` 双空格），影响出参 / 日志 / 面板回目展示。修复＝081.json 与 _segments/081.json 归一为全角单空格并补文件尾换行（feat-A004 导入语料时带入） | mcp-server | feat-A004 | 已修复 | 2026-09-22 |
| bug-00015 | 原文阅读器弹框点「上一回 / 下一回」抖动（首跳最明显：chunkId 入口自动定位到正文深位置，塌缩把滚动位置打回顶部，视觉跳得最远）。根因＝`goTo()` 置 `data = null` 后正文区塌缩，且高度链被 antd 焦点哨兵吃掉 —— antd-vue 4.2.6 在 `.ant-modal` 下渲染两个无 class 子 div（第 1 个 sentinelStart 包 `.ant-modal-content`，第 2 个 sentinelEnd 焦点哨兵带内联 `width:0;height:0;overflow:hidden`），原规则 `.ant-modal > * { flex: 1 1 auto }` 把哨兵一并撑开，loading 态（内容比弹框矮）富余高度归哨兵（实测包裹层 615 / 哨兵 115）→ `.reader-scroll` 601→486、纸面 5756→426、底部导航上跳 665→550。修复口径＝只撑开内容包裹层（`.ant-modal > div:first-child`）+ 哨兵钉死 0（`.ant-modal > div:last-child { flex: 0 0 0; height: 0 }`）+ `.reader-scroll` 槽位常驻（scrollbar-gutter: stable）；真浏览器实测（慢网 1200ms 拉长 loading 态、逐帧采样）loading ↔ loaded 读数恒定 730 / 730 / 601 / 541 / 665，翻回不抖（feat-A010 验收打回，待负责人复验） | mcp-web | feat-A010 | 已修复 | 2026-09-22 |
| bug-00016 | 原文阅读器打开后未滚动到指定片段（日志页候选分数表 chunkId 入口；二次验收仍未通过）。根因＝定位时机早于弹框正文挂载，`scrollRef` 为 null 即静默 return。根因＝弹框高度链断裂致 .reader-scroll 不可滚（scrollTop 恒 0）+ 定位早于正文挂载。修复口径＝补齐高度链 + 等「容器已挂载 + 目标行存在」再测量（声明式 watch(flush: post)；antd-vue 4.2.6 无 afterOpenChange，只有 afterClose） | mcp-web | feat-A010 | 已修复 | 2026-09-22 |
| bug-00017 | 日志页候选分数表点 chunkId 开 / 关阅读器弹框，页面抖一次且关闭后滚动位置被重置到顶部（验收 7a 相关）。根因＝antd 滚动锁改写 `document.body` 的 overflow + width，与 `scrollbar-gutter: stable` 槽位叠加。修复口径＝开 / 关不得改变页面宽度与滚动位置：antd 滚动锁开关条件恒真（传 :get-container 绕不开，实测仍注入 html body{overflow-y:hidden;width:calc(100% - 15px)}，致 body 宽 -15 且页面滚动被重置为 0），改用 html body{overflow-y:visible !important;width:auto !important} 中和；页面不滚动靠 wrap 的 overscroll-behavior: contain | mcp-web | feat-A010 | 已修复 | 2026-09-22 |
| bug-00018 | 域锁定生成轮返回空答案（`/api/chat` 200 但 `answer=""`）。根因＝思考模型 `max_tokens` 与思考预算共享 + 该输入下推理不收敛（放大预算到 3000 仍 `length`、content 仍空）+ 空答案走 Guard 软性域直通当 success 返回。修复口径＝生成轮关闭思考（实测 1000→150 token 且答案正常）+ 空答案/`finish_reason=length` 不得 200 直通。补充（2026-09-22）＝日志页「LLM 调用」表失败错误信息改 hover「失败」标签展示（真浏览器实测：失败行行高 74→58px，hover 出 tooltip） | mcp-orchestrator, mcp-web | feat-A011 | 已修复 | 2026-09-22 |
| bug-00019 | 工具调用记录缺「调用方 / 发起阶段」（日志页只看得到「谁被调用」，看不出「谁发起、哪个阶段发起」）→ auto 路径的服务端 L3 题库预检被读成模型乱调工具（trace `2ef3608a`）。修复口径＝`tool_call_logs` 增 `caller`（model / server）+ `stage`（l3 / fastpath / classify / generation），历史 NULL 不回填；日志页「调用方法」后增「调用方」列合成显示 | mcp-orchestrator, mcp-web | feat-A011 | 已修复 | 2026-09-22 |
| bug-00020 | 日志页「耗时」hover tooltip 文案冗余：写「开始 X ～ 结束 Y」，两个标签字多余（LLM 调用表 + 工具调用表同格式；trace `6e59249f` 复现）。修复＝文案只留「X ～ Y」（`mcp-web/src/views/LogsView.vue:199`、`:252`），时间戳与耗时口径本身正确、不改 | mcp-web | feat-A011 | 已修复 | 2026-09-22 |

| bug-00021 | 域锁定题库问句答成模型先验知识（问「玄德是谁的字」→ 200 返回「刘备」、`citations` 空） | mcp-orchestrator, mcp-server | feat-A011 | 已修复 | 2026-09-23 |

| bug-00022 | 题库域并列候选被当对应题作答（问「关于字什么」→ 200 返回「吕布的字是奉先。」） | mcp-orchestrator, mcp-server | feat-A011 | 待修复 | — |
| bug-00023 | 演义域主宾反转 / 错误前提未识别（问「严颜义释张飞」按「张飞义释严颜」作答，未按契约回「演义中未涉及」）。main 已合入生成轮 prompt 事件结构方向校验（5-1~5-3 + 不变量断言，PR #20）；检索侧结构性前提校验未做 | mcp-server, mcp-orchestrator | feat-A004 | 待修复 | — |
| bug-00024 | 同题两次请求答案渲染不一致（「三英战吕布」一条 answer 只有角标 ¹ ² 无引语正文，trace 932d36fc / 5018ace0，citations 相同） | mcp-orchestrator | feat-A006 | 待修复 | — |
| bug-00025 | 演义域答案内联服务端内部编号 ⟨Qn⟩（问「孙尚香后来怎么样了」→ answer 出现 ⟨Q6⟩~⟨Q15⟩，trace 20117022；模型抄写注入片段 + 渲染层未剥离内部标记 + H4 安全网不识别弯引号抄写） | mcp-orchestrator | feat-A006 | 待修复 | — |
| bug-00026 | 缓存概览条目明细表「ID」列全部空白（前端 bodyCell 模板漏 column.key === 'id' 分支、该列又无 dataIndex，antd 兜底取 record[undefined] 为空；接口正常返回 id，数据未丢）+ 同行做负责人优化点：操作列加「复制 ID」按钮。修复口径＝bodyCell 补 id 分支渲染 record.id；操作列「删除」旁并排「复制」按钮（clipboard + 提示） | mcp-web | feat-A013 | 待修复 | — |

| bug-00027 | 相似度分布柱形图 hover 仅「0.8~0.85: X 次请求」，无桶内请求明细（相似度 / 命中·未命中 / 用户输入原文 / 命中条目或最相近条目原文），无法支撑命中线调整与误判识别判断（图表缺参考意义，功能缺陷）。需求依据＝目标「调命中线看灰色区实际数据不拍脑袋」+ 验收 10 图表与 cache_logs 对账 + 验收 14 灰色区列出 query 对。修复口径＝点击柱形下钻展开该桶请求记录列表（交互形式负责人 2026-09-24 定）：列表展示相似度 / 命中·未命中 / 用户输入原文 / 命中条目或最相近条目原文（灰色区明细接口已有，story-A013-03），明细字段以需求「query 对（用户输入原文 / 最相近条目原文 / 相似度）」为准，真浏览器复现后实施 | mcp-web | feat-A013 | 已修复 | 2026-09-24 |

| bug-00028 | 演义域片段不足以支撑结论仍凭先验作答（「马超投靠刘备后」答案对但注入片段无五虎/病逝、「夏侯渊字什么」原文无此信息却答妙才、「刘备死的时候多少岁」同族——提示词含禁用先验约束但模型不服从 + 引用不支撑结论）。修复＝单轮生成 + 结构保险丝：支撑护栏（引用不支撑→拒答/裁剪）+ 句-片段重叠门（阈值 0.5/ngram 2）+ 三条语义指令并入生成轮提示词；已合入 main（PR #22，merge e1c5267）；现状见 docs/llm-answer-accuracy-current-state.md §7/§11 | mcp-orchestrator, mcp-server | feat-A004 | 已修复 | 2026-09-24 |

| bug-00029 | 缓存控制台关闭「缓存开关」后，缓存概览统计与缓存条目列表未清空。负责人 2026-09-25 拍板口径「关=停用+清空」（行为变更：偏离 A013 归档『开关与清除分离』，验收 8『开启后恢复命中』不再成立，重开从空池重新积累）。修复＝mcp-orchestrator `setEnabled(false)` 联动清空缓存池（内存 + cache_entries 镜像，cache_logs 保留）+ mcp-web 开关切换后统一重拉真实数据（不造假清零） | mcp-web, mcp-orchestrator | feat-A013 | 已修复 | 2026-09-25 |

| bug-00030 | 缓存开关状态不持久：后总台关闭缓存开关后重启 mcp-orchestrator，开关自动回 CACHE_ENABLED 初始值（默认开）。修复＝cache_settings 表持久化上次运行时开关值，构造按「显式 options → env CACHE_ENABLED 显式设置 → 持久化值 → 缺省 true」恢复；setEnabled 同步直写 | mcp-orchestrator | feat-A013 | 已修复 | 2026-09-25 |
| bug-00031 | 人名别名同字不同人被单值结构覆盖（子远 = 许攸/吴懿/孙峻、公明 = 徐晃/管辂、子明 = 吕蒙/孙亮、子孝 = 曹仁/孙和）。根因要点 = alias→PID 单值 + 表不全；修复口径待定（多值结构或上下文判定）；A016 并入前冲突组不进表，本期不修 | mcp-server | feat-A004 | 待修复 | — |
| bug-00032 | A016 验收：问「孙权遣人向关羽求亲，关羽是怎么回复使者的」答「演义中未涉及」（trace c549084b）。根因（2026-09-26 排查定案）=模型原始输出正确「关羽怒斥使者，拒绝联姻。[片段5]」（responseSummary 实证，指针=0073:c0008 求亲被拒原文、人物校验过），但 bug-00028 结构门第三条「句-片段重叠门」（0.5 @ 2-gram）对改述结论句整句裁剪→无留存句→拒答；字面 n-gram 无法区分「语义支撑的改述」与「先验断言」（两类重叠都低），测试套件缺「改述正例」漏网。修复=重叠门改「低重叠待裁→边界 LLM 语义支撑复核」+ 域提示第 9 条改述口径（hu/feat-A016_term-normalization a121557，验收通过 2026-09-26） | mcp-orchestrator | feat-A016 | 待修复（打回 09-26） | — |
| bug-00033 | A016 验收：问「孙刘联军大破曹操的战役是哪一场」答「演义中未涉及」（trace ca7d9c6a，现象补录）。根因（2026-09-26 排查定案）=模型原始输出正确「孙刘联军大破曹操的战役是赤壁之战。[片段2]」，指针=0077:c0009（含「破曹操于赤壁」），重叠 0.2 被重叠门裁掉→拒答；次级暴露=ch49 火攻叙述 0049:c0018-20 未进 top20 候选，引用只能落间接提及段，属检索侧后续优化、不阻塞。修复=同 bug-00032 护栏语义复核（hu/feat-A016_term-normalization a121557，验收通过 2026-09-26） | mcp-orchestrator, mcp-server | feat-A016 | 待修复（打回 09-26） | — |
| bug-00034 | A016 验收：同题跨请求答案不稳定——「夏侯惇的眼睛是怎么瞎的」67119582 答「夏侯惇左目为曹性射瞎」vs 275551c3 答「演义中未涉」。根因（2026-09-26 排查定案）=两次检索 / funnel / candidates 完全一致、prompt tokens 均 2238，仅模型措辞不同：左目为…射瞎（重叠 0.556 过线）vs 左眼被…射瞎（重叠 0.3 被裁）→ 重叠门对同义措辞（左目 / 左眼，恰为 A016 归一化范畴）一票否决；两 trace 原始输出均含 [片段1]=0018:c0014 正确段。修复=同 bug-00032 语义复核 + 改述口径提示（hu/feat-A016_term-normalization a121557，验收通过 2026-09-26） | mcp-orchestrator | feat-A016 | 待修复（打回 09-26） | — |
| bug-00035 | A015 基准评测「通过率恒 60.0%」——基准集 v0.1 无 A016 归一化覆盖题，归一化修得再好也测不出来；verify.mjs 为纯薄壳无硬编码（四快照逐题全同 = 真重跑、引擎确定性），23/110 题 query 被改写但双侧同口径扩张不改变通过率 | dev-docs, mcp-server | feat-A015 / feat-A016 | 待修复（打回 09-26） | — |
| bug-00036 | 实体表 34 个 rewriteKeys 是 canonical 真子串，语料归一化批量扩张成垃圾（赤兔马→赤兔马马、木牛流马→木牛流马木牛流马，21 词 ×117 处）；2026-09-25 审查「安全保留」判据反了；修复＝邻接延伸检查 + 逐键裁决 + §8 校验 + 文档纠偏，与 bug-00035 同批 | mcp-server, dev-docs | feat-A016 | 待修复（打回 09-26） | — |
| bug-00037 | A016 验收（test-0825 #5）：答案正确但引用不支撑——问「刘备登基后，张飞被封为什么」答车骑将军/司隶校尉/西乡侯，却引用只有「车骑将军董承」的 0073:c0003（4d7a408a，llm=1 实证结论断言零复核）。根因=双因：0081:c0002（迁张飞为车骑将军段）无「人物之封」标签漏召（rank 55）；结构门只校验带指针句、结论句无指针全逃逸。修复=mcp-server 新增「人物之封」标签类别+0081:c0002 打标（a6574b5，rank 55→4）+ mcp-orchestrator 结构门覆盖无指针叙述句（a2d88d0，348 绿）；详情见 bugs/bug-00037-answer-without-pointer-support.md | mcp-orchestrator, mcp-server | feat-A016 | 待修复（打回 09-26） | — |
| bug-00038 | A016 验收：问「夏侯渊字什么」（trace ba5bb4ec）返回「空正文+引用脚注¹」且调 3 次 LLM。根因（2026-09-26 排查定案）=a2d88d0 把裸引用行「[片段1]」（无正文）也按低重叠叙述句进了边界复核（judge 判 supported 保留），而真结论句「夏侯渊字妙才」超纲判 unsupported 被裁——裁剪后残留指针行使「全部裁剪→拒答」分支不触发，且语料并非无载——0071:c0003 有曹操「欲观卿之妙才，勿辱二字」双关段（可支撑「字=妙才」），但该段检索 top10 未召回，模型只能拿先验知识+错引；终态应为「召回后正确作答」或「未召回时拒答」。修复口径=复核候选豁免「纯指针无正文」句（省调用）+ 裁剪后仅剩指针/正文为空 → 拒答「演义中未涉及」+ citations [] | mcp-orchestrator | feat-A016 | 待修复（打回 09-26） | — |
| bug-00039 | 编排侧边界复核无 LLM 调用次数上限：低重叠句逐句串行复核（judge 单次约 1s，trace ba5bb4ec 实测 1.02s），模型输出多句低重叠结论时用户需等 N 秒。根因=a121557 引入「低重叠→逐句复核」循环未设上限（设计假设「提示词约束一句结论」当作硬约束），a2d88d0 把无指针叙述句纳入候选又放大 N。修复=复核预算 MAX_BOUNDARY_REVIEWS=1（09-26 预算原则：指定域正常 1 次、极限 2 次、3+ 默认打回；原 MAX=3 口径作废）；并立团队约定：新增/增加 LLM 调用必须先报备负责人（AGENTS.md 基本原则 14，预算细则 15） | mcp-orchestrator | feat-A016 | 待修复（打回 09-26） | — |
| bug-00040 | A016 护栏响应时间翻倍：负责人实测 3 trace（bbb110f9=4 次 LLM、4f08d60f/e1bfb360=2 次），server 2.4~6.2s（原快路径 1 次生成 ~1.8s）。根因（2026-09-26 排查定案）=a121557「低重叠→逐句 LLM 复核」每句 1 次 judge（~1s），MAX=3 只封极端不降典型；放大因子=引文行被句切分后成无指针引语片段句，重叠归一化剔除引语 → 必低重叠 → 逐句 judge（bbb110f9 的 2 次引文复核纯浪费，judge 参考片段还配到无关段）。修复口径=引语片段句豁免复核 + 无指针句复核参考修正 + 复核预算=1（总调用 ≤2 次，09-26 预算原则）。详情见 bugs/bug-00040-boundary-review-quote-overcalls.md | mcp-orchestrator | feat-A016 | 待修复 | — |
