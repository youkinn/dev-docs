# Bug 索引

编号规则：5 位数字自增，不可重用。

| Bug 号 | 标题 | 涉及项目 | 关联特性 | 状态 | 修复日期 |
|--------|------|----------|----------|------|----------|
| bug-00001 | 知识问答省略/冗余问法未命中题库（「夏侯惇字什么」提示未收录） | mcp-orchestrator | feat-A002 | 已修复 | 2026-09-14 |
| bug-00002 | 选中"风云三国"标签后模型未路由到题库工具 | mcp-orchestrator | feat-A003 | 待修复 | — |
| bug-00003 | 演义检索召回质量不达标（原文有答案却答「演义中未涉及」） | mcp-server, mcp-orchestrator | feat-A004 | 待修复 | — |
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
| bug-00018 | 域锁定生成轮返回空答案（`/api/chat` 200 但 `answer=""`）。根因＝思考模型 `max_tokens` 与思考预算共享 + 该输入下推理不收敛（放大预算到 3000 仍 `length`、content 仍空）+ 空答案走 Guard 软性域直通当 success 返回。修复口径＝生成轮关闭思考（实测 1000→150 token 且答案正常）+ 空答案/`finish_reason=length` 不得 200 直通 | mcp-orchestrator | feat-A011 | 修复中 | — |
| bug-00019 | 工具调用记录缺「调用方 / 发起阶段」（日志页只看得到「谁被调用」，看不出「谁发起、哪个阶段发起」）→ auto 路径的服务端 L3 题库预检被读成模型乱调工具（trace `2ef3608a`）。修复口径＝`tool_call_logs` 增 `caller`（model / server）+ `stage`（l3 / fastpath / classify / generation），历史 NULL 不回填；日志页「调用方法」后增「调用方」列合成显示 | mcp-orchestrator, mcp-web | feat-A011 | 已修复 | 2026-09-22 |
