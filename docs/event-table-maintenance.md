# 事件表维护机制（缺口语清单 / 批次补录 / 覆盖率 KPI）

> 依据：`requirements/feat-A018-event-table.md` 验收 #3（长期机制）与 aliases 三层粒度口径。数据契约见 `docs/feat-A018-event-table-interface.md`（表结构 / norm 版本 / 漂移）。本文件只写机制与口径，不写构建过程。

## 参与对象

- 表：`mcp-server/sango/data/corpus/events.json`（708 条，normVersion 换代 = 补录发布，重启进程生效）。
- 构建链：`dev-docs/test/events/build-events.mjs`（初审产物 → 段位定位 → 落表）→ `verify-events.mjs`（V1–V7 硬校验）。
- 问法池：`mcp-server/sango/data/event-question-pool.json`（真实问法原样进池，**只进池不进表**）。

## 缺口来源（登记触发）

| 来源 | 说明 |
|------|------|
| verify / build 待核 | 段位定位 0 命中、suspect（死亡无共现）、tags 源数据存疑 → 不进表，登记 `dev-docs/test/events/gap.md` |
| 线上漏召 | 线上问题事件类问法未命中事件组（覆盖率探针暴露） |
| 新题面 / 题库新问法 | 测试库新增事件类问法 |
| tags 修正 | tags event.json 事实 / 回号错误修正（如 bug-00043 同类），修正后重跑派生 |

## 批次补录流程（不做单条即改）

1. **攒批**：缺口统一登记 `dev-docs/test/events/gap.md`（模板见下），攒够一批或按月批次。
2. **补录**：区分三类动作——
   - 缺事件（初审漏件）：在 `first-pass.md` 补行（回号 / 事件名 / 白话问法 / 类型 / 备注=补录），再审真实性（负责人）；
   - 缺定位（事件在但 chunk 空）：改 `build-events.mjs` 人工关键词表 `KW_OVERRIDE`；
   - 缺指称（命中但问法不中）：事件行 aliases 加指称词，或检索侧问法骨架（如果期已实现）。
3. **校验**：重跑 `node test/events/build-events.mjs` + `node test/events/verify-events.mjs`（V1–V7 全过）。
4. **回归**：`npm run dev` + `POST /dev/benchmark/run`——整体 top5 ≥ 60.8%，事件类（战役 / 典故 / 事件关系 / 死亡）逐类不倒退（需求验收 #5 顺带门）。
5. **发布**：events.json 更新（meta.normVersion 由脚本重算换代）+ 重启进程生效；`event-coverage-probe` 下月报告口径自动衔接新版本。

## 缺口清单登记模板（gap.md 长期回流节）

| 回号 | 事件名 | 来源 | 状态 | 处理 |
|------|--------|------|------|------|
| 017 | 阎象登场 | tags 存疑（原文无此词） | 待核 | 核证 tags 源数据后补 |

状态流转：待核 → 已核（并入 first-pass.md / KW_OVERRIDE / aliases）→ 已落表；长期不成立者关闭（注明口径取代理由）。

## 覆盖率 KPI 探针

- **分母** = 事件类问法池：线上问题（当月新增事件类问法）+ 题库全集事件类 + 画像事件类，按月累计、原样入库（`event-question-pool.json`）。
- **命中口径** = 问法经实体表改写（A016 同口径归一）后，与 events.json aliases 子串匹配命中事件组。
- **统计**：`node sango/scripts/event-coverage-probe.mjs`——输出当月命中率（命中问法 / 池内问法）、按来源分项、未命中清单；报告落盘 `data/event-coverage-{YYYY-MM}.json`。
- **驱动**：命中率掉（漏召）→ 按缺口三类动作补录；覆盖率只作 KPI 驱动补录，不是标准集回归门（与需求验收 #5 区分）。

## 与相邻机制边界

- 语料重建 chunkIds 漂移：加载期 5% 阈值降级 / 剔除（接口文档 §2.3）；verify 每次落表全量校验；触发即重跑 build-events 定位。
- norm 版本：事件表版本由 rows 内容 hash 决定；实体表（A016）normVersion 独立；两表口径冲突（alias 撞改写键）由 verify V3 拦截，走 bug 流程修正实体表或事件表。
- 问法骨架（检索侧配置）本期未实现（接口文档 §3.4）；覆盖率命中不足时由缺口机制补指称，骨架课题由覆盖率驱动另立。