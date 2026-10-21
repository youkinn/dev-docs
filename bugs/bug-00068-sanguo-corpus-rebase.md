# bug-00068：底本《三国演义.txt》换代（人民文学出版社版）+ 语料重建

> 状态：修复中
> 涉及项目：mcp-server、mcp-orchestrator、mcp-web、dev-docs
> 关联特性：feat-A004（语料/检索）、feat-A006（引用展示）、feat-A010（阅读器）、feat-A013（问答缓存）、feat-A015（回归标准集）、feat-A018（事件表）
> 关联票：bug-00067（底本缺陷定点修补）
> 日期：2026-10-14

## 一、现象与根因

现底本 `docs/三国演义.txt` 为公网下载的电子文本。与权威整理本（人民文学出版社《三国演义》，以毛宗岗本为底本，2020 年修订）逐字比对，结论：

- **篇幅一致，不缺段**：120 回，正文 591,868 字（权威本）vs 591,983 字（现底本）。
- **约 1.4%（≈8,000 处）字符位不同**，分三类：
  1. **标点体系**：现底本多约 2,000 个「；」、少约 3,000 个「，」，丛书用冒号/分号引出与转折，底本一律作句号。
  2. **校订用字**：`余`→`馀` 628 处、`毋丘俭`→`毌丘俭` 19 处、`张邰`→`张郃` 13 处。
  3. **真错字**：如「玄德麾军回身复杀」，底本作「摩军」；开篇「词曰：」与「——调寄《临江仙》」的位置也不同。

根因：底本来源不是权威整理本，错字与校订差异无法靠定点修补穷尽（bug-00067 已修补一轮，仍有残留）。结论是换底本，不再补丁。

## 二、来源与获取方式

- 来源：豆瓣阅读《三国演义》，人民文学出版社 2020-01「中国古典小说藏本：插图本」，三册对应 `ebook_id`：上册 155370967（第一至四十回）、中册 155370735（第四十一至八十回）、下册 155370876（第八十一至一百二十回）。
- 取数：`POST /j/article_v2/get_reader_data`（入参仅 `aid=<册 id>`，整册一次返回），正文为该站前端加密数据；解密算法：AES-256-CBC，密钥 = SHA-256(登录用户 id 字符串)，IV = 尾部倒数第 13~29 字节，密文 = 前 len-29 字节。已在 Node 侧复刻，无需逐章翻页。
- 依赖：具备阅读权限（购买/会员）的登录态，一次性；三册合计 6 个请求。
- 该站电子书不含插图（出版方未授权图片，仅 1 张地图占位）。

## 三、产出格式（契约）

1. **`docs/三国演义.txt`（替换）**：120 回正文。回目行形如 `第X回 <回目>`，段落之间空行；段落切分沿用来源本自然段（2,129 段，比现底本的 1,445 段更细）。
2. **`docs/sanguo-annotations.json`（新增）**：注共 576 条（上册 317 / 中册 145 / 下册 114）。
   - 单条契约：`{ chapter, chapterTitle, paraIndex, offset, anchorBefore, anchorAfter, note }`
   - `paraIndex` = 该回内段落序号，`offset` = 段内字偏移；**锚点与 chunk 方案解耦**，chunk 参数再变不影响注的定位。
   - `anchorBefore` / `anchorAfter` 为该位置的前后各 16 字，供展示与校验。
3. **辅文**（文前辅文、出版说明、修订说明、前言、地图）不入 120 回语料，另行存放，不进退检索。
4. **可复现性**：工具链入库 `scripts/douban-sanguo/`（`fetch.mjs` 抓取 + 解密、`build.mjs` 生成产出、`verify.mjs` 校验，用法见该目录 `README.md`）；解密后的中间产物不入库；`manifest.json` 记录来源册与产出文件 sha256。已实测：两次独立抓取导出结果逐字节一致（120 回 / 2,129 段 / 591,870 字 / 576 注，锚点 576/576 命中）。

## 四、影响面与重算清单

### 4.1 以 chunkId 为键的派生数据（换代后 100% 死键，必须重建）

| 数据 | 位置 | 换代前规模 |
|------|------|------------|
| 标签数据（A014 保留四类） | `mcp-server/sango/data/corpus/tags/`：event.json、story.json、duel.json | event.json 1,731 条、story.json 334 条（115 个典故名）、duel.json 39 条；契约要求死键为 0 |
| 事件表 | `mcp-server/sango/data/corpus/events.json` | 714 条，行内含 chunkIds（bug-00058 即 chunkId 不全） |
| 事件 / 典故评测集 | `dev-docs/test/standard-set/events/eval-set.json` | 2,134 处 chunkId 锚 |
| feat-A015 主标准集 evidence | mcp-server 侧（本仓库仅有校验脚本 `test/standard-set/feat-A015-verify.mjs` 与锚审计产物） | 199 题，锚点须重定位 |
| L3 锚点派生脚本 | `dev-docs/test/events/`：l3-anchor-overrides.mjs、derive-l3-from-tags.mjs、rebuild-l3-anchors.mjs | 人工覆盖表内含 chunkId |
| 探针数据集与审计产物 | `dev-docs/test/`：cls900 / cls1800 / cls2400.json（722 / 1,303 / 1,708 锚）、entities 目录 json、label 系列 probe.json、sparse-label-probe.json、tag 系列 audit.json、vector-norm-probe.json | 过程产物，按后续是否继续使用决定是否重建 |

**加载容错不适用**：events.json 契约允许「chunkId 漂移未超 5% 阈值则降级 / 剔除」（`docs/event-table-maintenance.md` 引接口文档 §2.3）。换代漂移为 100%，远超该容错面，靠容错等于整表作废——必须重跑 `build-events.mjs` + `verify-events.mjs`（含人工关键词表 `KW_OVERRIDE`）重新落表。

### 4.2 不依赖 chunkId（不受换代影响，抽样确认即可）

- `mcp-server/sango/data/entity-table.json`：词条级（起草规模 person 193 + nonPerson 214、aliases 902、referentVerdicts 89、ambiguityGuard 29），无 chunkId / 回号锚。
- `mcp-server/sango/data/event-question-pool.json`：真实问法原样进池，不含语料锚。
- `dev-docs/test/三国演义1000问.md`、`answerable2400.json`、`entity2400.json`：未见 chunkId / 回号锚。

### 4.3 随语料变动（重算 / 重标定）

| 项 | 处理 |
|----|------|
| 语料与 chunkId | `build_corpus.py` 重跑（现约 2,344 块），按 `docs/sango-corpus-spec.md` 不变量复核 |
| 向量库 | 全量重建（embedding 批量调用按原则 4 报备登记） |
| 检索标定读数 | `MIN_COSINE`、标签 0.1 加权、死亡意图置顶、重排阈值按新语料重测（现读数出自旧底本） |
| feat-A015 回归 | 换底本前后跑分对比、逐条归因（LLM 调用报备）；`test/standard-set/results/**` 历史快照留档，不作新基线 |
| feat-A013 缓存 | 全量清空 |
| feat-A006 引用定位 | 历史日志 `citation.text` 对新语料不再命中：历史不回溯，新日志按新语料 |
| feat-A010 阅读器 | 数据源切新底本，上下回标题随新目录 |
| 文档同步 | `docs/sango-corpus-spec.md`（实测数字）、`docs/llm-answer-accuracy-current-state.md`（事实库）、`docs/sango-tag-system.md` 与 `docs/event-table-maintenance.md`（读数变化时）、`docs/sango-check.md`（随换代作废） |

## 五、验收标准

1. 120 回齐全，回目与来源本逐条一致（脚本核对，0 差异）。
2. 正文与来源本逐字一致（校验脚本可复跑，0 差异）。
3. 576 条注全部就位，锚点可定位（抽检 100% 命中）。
4. 语料重建满足 `sango-corpus-spec.md` 的全部不变量。
5. feat-A015 标准集段级/回级指标不低于换底本前；低于则逐条归因并报负责人。
6. 阅读器按回显示新原文、上下回跳转正常。
7. 缓存清理、事件表重建、实体表核对完成且回归通过。

## 六、任务分工

- 老陈（mcp-server）：语料构建、chunk 重算、向量重建、MCP 工具数据源切换。
- 小胡（mcp-orchestrator）：缓存清理、检索与注入链路回归、事件表重建。
- 小叶（mcp-web）：阅读器与引用卡片按新语料显示。
- Coco：契约、分支与提交、审查、回归组织、文档同步。
- 负责人：验收。

## 七、风险

- **版权**：底本与注均系人民文学出版社整理成果，仅作内部语料与内部功能使用，不对外分发。
- **抓取依赖登录态**：一次性任务，脚本与导出 hash 已落档，可复跑。
- **答案会变**：建议先在测试环境完成切换与回归对比，再切线上。
