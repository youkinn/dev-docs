# 上下文交接：feat-A004 语料 chunk 规范（2026-09-18，已压缩，新会话从本文件起步）

**1. 起点文件**
- 本交接（新会话第一件事读它）：`D:\workplace\dev-docs\docs\handoff-feat-A004-2026-09-18.md`
- 团队约定（唯一权威）：`D:\workplace\dev-docs\AGENTS.md`

**2. 范围清单**（一次读全，读不到=路径写错回查不猜）
- `dev-docs\docs\sango-corpus-spec.md` —— **本轮核心产物**：chunk 划分规范（§0 结论 / §3 算法 / §4 参数 / §5 schema / §6 出处渲染 / §7 验收 / §8 影响面 / §9 拍板），约 464 行。**注意：规范正文不含派单与人员分工**（派单属团队通用流程，见本交接 §5），**也不含「变更记录」**（未定稿不写变更记录，定稿/上线后才补）。同规则适用于本次全部文档
- `dev-docs\docs\sango-chunk-sweep.mjs` —— 决策证据脚本（§3 算法参考实现 + §7b/§7d/§8–§13 全部读数；文档所有数字由它产出）
- `dev-docs\docs\sango-recall-quality.md` —— 召回诊断 + §4.6 真向量分步计划（Step 0–4）+ §7 拍板结果
- `dev-docs\docs\sango-classics-rag-design.md` —— 技术方案定稿 + §9 决策记录 1–9
- `dev-docs\mcp-orchestrator\api\feat-A004-sango-classics-rag.md` —— 接口文档（**待老陈修订 C1**）
- `dev-docs\requirements\feat-A004-sango-classics-rag.md` —— 需求定稿（含「合并记录」表，Coco 维护）
- `dev-docs\docs\sango-recall-bench.mjs` —— 原有 24 例基准脚本（口径同源）

**3. 已定决策**（结论自包含，禁止重读来源）
- **chunk 参数（拍板「改」）**：250 字目标 / 400 字硬上限（仅箱尾引语配平延伸用）/ **0 重叠** / 软下限 100 字 / 同回内连续 narration 可跨段 / 只在句末标点切
- **终配 = 250 + 延伸 400**：2263 chunk，均 262 / max 400；`@1 19/24`、`@3 20/24`、`@5 21/24`、750 覆盖 `20/24`、1000 覆盖 `20/24`、top5 重复 `5/24`、库级引号断 14%、注入侧断引语 `10/24`、主案例 #2
- **对照现状（整段 1377）**：`@1 17/24`、750 覆盖 `13/24`、1000 覆盖 `15/24`、top5 重复 `14/24`、注入侧断引语 `6/24`。**现状的注入侧引语完整度反而更好**（段长到能装下整段对话）——引语完整度是「切小后必须守住的下限」，不是相对现状的收益
- **重叠 0**：重叠零收益（750 覆盖 21→20→19），且 top5 近重复 3→16→19
- **跨段**：真实收益是**碎片清理**（<80 字块 38→10、最短 6→33 字），不是提排名（统一口径下 `@1` 同为 19/24）
- **出处与引用原文（拍板「采纳」）**：**照常展示，但不由模型生成**——语料冗余 `quotes[]` 引语表，服务端按指针渲染。模型只吐「结论 + 指针 `[Q2]`」（5 字），单条引用省 78 字 / **94%**（现状须吐 83 字：引语 56 + 出处 25）
- **指针粒度（拍板「按推荐」）**：引语级 `[Q2]`；**不展示段号**
- **父子分块**：本期不做（top3 增益 0，注入字数 809→1911，+136%）
- **探针 B**：拍板「落实」
- **真向量（拍板「本期补、分步走」）**：Step 0 前置（装 Python + 固化 `HF_ENDPOINT` + **定运行期 query 编码方案 A/B/C**）→ Step 1 离线重建 → Step 2 运行期编码打通 → Step 3 RRF → Step 4 阈值重定
- **语料只重建一次（拍板硬约束）**：**4 个重建触发项**已全部收拢本期同批——① chunk 切分、② `classify()` 诗句级切分、③ `quotes[]`、④ 离线向量。**不触发重建**（可留二期）：别名表、query 改写、RRF、回目邻接、rerank
- **环境实测（2026-09-18）**：`hf-mirror.com` ✅ 200、`pypi.org` ✅ 200、`npm`/`npmmirror` ✅ 200、`huggingface.co` ❌ 超时；**`HF_ENDPOINT` 可用，无阻塞**。BGE-M3 权重 **~2.1GB**（`model.onnx` 0.7MB + 外置 `model.onnx_data` 2161.8MB）；镜像上 `model_fp16.onnx` / `model_quantized.onnx` **均 404**（无量化小体积版）。**本机无真实 Python**（仅 WindowsApps 0 字节别名）
- **本轮修正的 4 个原稿错误**：① I3「2 处越界」实为源段边界（0 违规，与 I7 不矛盾）；② 残余未配平归因「超 400 字」错（实测 0 个超 400，真实成因：继承语料 124 / 卡 CAP 余量 163 / 流末尾 24）；③ §4.7 父子分块原 top5 读数不可复现；④ §4.3 跨段原 `@1/top5` 读数为旧口径
- **已知缺陷登记**：`verse` 标注失真——173 个 verse 段中 **153 个（88%）是「叙述+诗」融合段**（标记在段长 30% 之后）；根因 `build_corpus.py` 的 `classify()` 是行级判定。已升级为本期修复（C3）
- **验收基线（不得低于）**：`@1 17/24`、`@3 20/24`、`@5 21/24`、覆盖 13/24 与 15/24；主案例不劣于 #2

**4. git 状态**（2026-09-18 13:05，以 `git status -sb` 为准）
- dev-docs：`chen/feat-A004_sango-classics-rag`，远端 `ed0079a`（本轮 3 提交：`af73d4b` 拍板登记 / `a8f66a0` 去派单与人员分工+交接文档 / `ed0079a` 删除变更记录）；**本地领先 origin 若干提交未推送**（交接文档的若干次修订，最新为 `cef0815`；以 `git status -sb` 读数为准）——推送时 `github.com:443` 连续失败 5 次，负责人判定「晚点再推，不影响」，**新会话接手第一件事先补推**：`cd D:\workplace\dev-docs; git push origin chen/feat-A004_sango-classics-rag`（需提权；抖动时重试即可）
- mcp-server：`chen/feat-A004_sango-classics-rag`，远端 `7799880` ✅ 已推送（别名归一化 + 向量权重）
- mcp-orchestrator：`coco/feat-A004_sango-classics-rag`，远端 `823b6eb` ✅ 已推送（注入收窄至 top3 + 注入窗口锚最稀有 key）
- mcp-web：`ye/feat-A004_sango-classics-rag`，远端 `165b4dd` ✅ 已推送（domain=sango-novel 标签）
- 本轮**未发起任何 PR**（负责人明确：推送，不 PR）

**5. 派单与待办**（派单属通用流程，故只落在本交接，不写进规范正文）

> **新会话按本表 spawn 子代理**（参数依 `AGENTS.md`「Token 控制」：轻量模型 + `fork_context=false` + 紧凑 prompt + 阻塞式长 wait，禁轮询）。
> **依赖顺序硬约束**：**C1 先行**——C1 接口文档未出前，**不得启动 C4 与 Y1**。C2/C3/C5 同批（语料只重建一次）。C6 不阻塞任何人。
> **环境约束**：本机沙箱**只有 `D:\workplace\dev-docs` 可写**，改 `mcp-server` / `mcp-orchestrator` / `mcp-web` 的文件需提权（`require_escalated`）；`git commit` / `git push` 同样需提权。本机**无真实 Python**（仅 WindowsApps 0 字节别名），C6 需先装。
- **老陈**：C1 接口文档修订（**先行，阻塞 C4 与小叶**）→ C2 六步切分 + I1~I9 断言 + `quotes[]` → C3 `classify()` 诗句级 → C4 `sango-index.ts` 适配 → C5 语料+向量**同批重建** → C6 Step 0 真向量前置
- **小胡**：H1 注入改纯原文+指针 → H2 指针校验替换 → H3 服务端渲染引用 → H4 长引语安全网 → H5 删死代码 → H6 探针 B 编排侧 + tokenizer 复核
- **小叶**：Y1 前端展示适配（**观感不变**，待 C1 后确认字段）
- **Coco**：K1 规范维护与审查；K2 探针 B 脚本固化到 `mcp-orchestrator/scripts/probe/`
- **待负责人定**：真向量 Step 0 运行期 query 编码方案 **A（onnxruntime-node 内嵌，Coco 建议）/ B（独立向量服务，需放宽 D5）/ C（云端 API）**
- **验收标准**：见 `sango-corpus-spec.md` §7（构建期 I1~I9 全 PASS；检索层不得低于基线；编排层指针校验 + 负样本拒答率不倒退）
- **产出格式**：子代理交付结构化摘要（产出 / 关键决策 / 未解决问题 / 变更文件清单+每文件行数），不返回原始文件内容

**6. 禁止重读**
- 已定决策只读结论（本交接 §3 + `sango-corpus-spec.md` §0/§9）；过程与旧稿无需重读
- `sango-classics-rag-research.md`（调研，21KB）、`handoff-feat-A004-2026-09-16.md`（旧交接）、`sango-recall-bench.mjs` 实现细节——非必要不读
- 代码位置已知：`build_corpus.py`（classify/segmentize 是 verse 失真根因）、`sango-index.ts:346 formatDoc()`（出处头）、`agent.ts:57/85`（prompt 要求出处）、`agent.ts:468`（格式校验）、`agent.ts:459`（出处剥离死代码）