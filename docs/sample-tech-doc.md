# 技术文档样例（正面）：以 feat-A010 原文阅读器为例

> 作者：Coco　日期：2026-09-22　用途：技术文档写法的正面样例 —— 写技术文档时按这个骨架（口径见 `AGENTS.md` 基本原则 5）
> 对照：反面教材 `mcp-web/design/feat-A010-original-text-reader.md`（流水账）；契约来源 `mcp-orchestrator/api/feat-A010-original-text-reader.md`

## 1. 目标与范围

两处入口复用同一阅读器（A4 观感、按回展示原文、定位到具体片段）：日志页候选分数表 `chunkId`、聊天页引用原文「查看全文」；日志页另加「项目」筛选与 traceId 复制。
非目标：PDF 生成 / 全文检索 / 移动端适配 / 给 `citations[]` 加 `chunkId`（聊天侧定位靠 `citation.text` 与整回原文匹配，零契约变更）。

## 2. 关键决策

| 决策 | 备选 | 选择与代价 |
|------|------|-----------|
| 弹框高度：纵向 flex 撑满视口 | 固定高度 / `calc(100vh - Npx)` | 无 magic number、不随视口失配；代价是须补齐 antd 高度链（见风险 1） |
| 定位测量只用 `offsetTop / offsetHeight / clientHeight` | `getBoundingClientRect` 差值 | Modal 打开带 `ant-zoom` 缩放，rect 会被 transform 等比放大而偏上；代价是 `.reader-scroll` 须 `position: relative` |
| 定位时机用 `watch([scrollRef, loading, data], …, { flush: 'post' })` | 轮询 / `@after-open-change` | antd-vue 4.2.6 **无** `afterOpenChange`；代价是须「容器已挂载 + 目标行存在」才测量 |
| 切回 / 跳转不清空正文，不加加载浮层 | 置 `data = null` + 加载提示 | 切回常 < 50ms，空白帧与一闪即过的提示都是噪声；失败保留旧内容 + `message.error` |

## 3. 契约与数据流

`GET /api/v1/sango/chapters/:chapter`（回号 → chunks）；组件入参 `v-model:open` + `chapter / chapterTitle / chunkId / showFooter`，无额外业务入参。
缓存：模块级 `Map<number, Promise>` 按回共享（两处入口不重复请求），失败不写缓存。
聊天侧定位：`chunks[].text.includes(citation.text)` 取 chunkId（同回重复文本取第一处），匹配不到不传 chunkId、停正文顶部。

## 4. 风险与已知约束

1. **antd-vue 4.2.6 高度链**：`.ant-modal` 下两个无 class 子 div —— sentinelStart（含 content）须撑开，sentinelEnd 焦点哨兵须钉死 0；`.ant-modal-content` 不能写 `height: 100%`（父级 auto → 百分比失效）。**升级 antd 后须复核这三条**（根因与实测见 bug-00015）。
2. **滚动口径**：唯一滚动容器是 `.reader-scroll`（`scrollbar-gutter: stable`），wrap 保持 antd 默认 `overflow: auto`；页面侧 `html { overflow-y: auto; scrollbar-gutter: stable }`，弹框打开时中和 antd 滚动锁对 body 的副作用（锁条件恒真，`:get-container` 绕不开，见 bug-00017）；弹框内「页面不滚动」由 wrap + `.reader-scroll` 的 `overscroll-behavior: contain` 保证。
3. **兼容边界**：Safari < 18.2 不支持 `scrollbar-gutter` → 退化为 `overflow-y: auto`，可能重现横向抖动；已知约束、未修。

## 5. 验证方式

真浏览器（真组件 + 真实数据）逐帧采样：慢网拉长 loading 态，确认 loading ↔ loaded 之间 `.ant-modal` / `.reader-scroll` / 底部导航读数恒定（不抖）；翻回、回号跳转、接口被拦失败三条路径同法实测。纯函数（短号提取 / citation 匹配 / 回号范围校验）走 `node:test` 单测。

## 6. 涉及文件

- 新增：`src/components/SangoChapterReader.vue`、`src/utils/sangoChapter.ts`、`src/utils/clipboard.ts`
- 修改：`src/views/LogsView.vue`、`src/components/RetrievalDiagnosticsPanel.vue`、`src/views/WeatherView.vue`、`src/api/client.ts`、`src/style.less`
