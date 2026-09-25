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
| bug-00012 | A003 测试 harness 未注入独立日志库 → 测试写入开发库 data/logs.db，日志页出现测试噪声（「随机一题」既有「对话」又有「答题」；负责人核对：该条无耗时、无域，确认为测试数据）。修复＝两个 harness 注入 `:memory:` | mcp-orchestrator | feat-A007 / feat-A008 | 待修复 | — |
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
