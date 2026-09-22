# feat-A010: 原文阅读器 + 日志页筛选增强 — 技术方案（前厅）

> 作者：小叶
> 对应特性号：feat-A010（story-A010-04）
> 日期：2026-09-22
> 前置：接口文档 feat-A010-original-text-reader.md（契约已冻结）

## 涉及文件（mcp-web）

| 文件 | 操作 | 说明 |
|------|------|------|
| src/components/SangoChapterReader.vue | 新增 | A4 阅读器组件，`v-model:open` + 三项入参（chapter / chapterTitle / chunkId） |
| src/api/client.ts | 修改 | `LogListQuery` 增 `domain`；新增 sango chapter 类型与 `fetchSangoChapter`（模块级按回缓存 Map<number, Promise>，失败不写缓存） |
| src/utils/clipboard.ts | 新增 | `copyText`：navigator.clipboard 优先，降级 execCommand + 临时 textarea |
| src/utils/sangoChapter.ts | 新增 | 短号提取、citation.text 匹配（includes）、回号范围校验等纯函数 |
| src/views/LogsView.vue | 修改 | 「项目」筛选（全部/天气/风云三国/三国演义→不传/weather/fengyunsanguo/sango-novel），重置一并清空；列表末尾「操作」列复制 traceId；`scroll.x` 用 `max-content`；挂载阅读器 |
| src/components/RetrievalDiagnosticsPanel.vue | 修改 | 候选分数表 chunkId 由纯文本改为可点击（emit open-reader，带 candidates[].chapter / title，不解析 chunkId 字符串）；表尾新增「操作」列复制完整 chunkId（成功反馈、不开阅读器） |
| src/views/WeatherView.vue | 修改 | 三国演义模式引用卡片原文末尾「查看原文」按钮：fetchSangoChapter（共享缓存）→ includes 匹配 → 打开阅读器；匹配不到不传 chunkId 停顶部 |
| src/style.less | 修改 | `html` 滚动条口径：`overflow-y: scroll` → `overflow-y: auto; scrollbar-gutter: stable`（槽位照旧预留、无溢出时不绘制滚动条） |
| src/utils/*.test.ts、src/api/client.test.ts | 修改/新增 | node:test 组件层逻辑单测覆盖验收条目 |

## 核心流程

```
日志页候选分数表 chunkId 点击 → panel emit { chapter, title, chunkId } → LogsView 打开阅读器
  → 组件读共享缓存（未命中 GET /api/v1/sango/chapters/:chapter）→ 渲染 A4 长纸
  → chunkId 命中则正文行挂载后容器内偏移滚动居中 + 高亮，未命中/未传停正文顶部
聊天页「查看原文」→ fetchSangoChapter(chapter)（与组件共用缓存，不重复请求）
  → chunks[].text.includes(citation.text) 取 chunkId（同回重复文本落第一处）
  → 匹配不到不传 chunkId → 打开组件（组件读缓存渲染）
```

## 选型 & 注意

- 阅读器入参严格按需求「组件入参契约」表；打开/关闭用 `v-model:open`，无额外业务入参
- A4 观感：210mm 纸宽 + 纸面阴影 + 衬线正文 + 长纸滚动（不分页）；正文只渲染 chunkId 尾段短号（如 c0021），不展示整串 chunkId 与 segFrom/segTo
- 弹框尺寸（负责人 2026-09-22 验收意见 + 二次验收调整）：宽固定 960px；正文区纵向 flex 撑满视口，**不写 magic number、不写 `100vh` 算术**——`a-modal` 加 `wrap-class-name="reader-modal-wrap"`，非 scoped 样式块（选择器统一挂 `.reader-modal-wrap` 下，不外泄）覆盖 antd 默认 `top: 100px` / `padding-bottom: 24px`：`.ant-modal { top: 0; height: 100%; max-height: 100%; padding-bottom: 0 }` → `.ant-modal-content { display: flex; flex-direction: column; height: 100% }` → `.ant-modal-body { flex: 1 1 auto; min-height: 0 }` → `.reader-body { flex: 1 1 auto; min-height: 0 }`；纸面 `min-height: 100%` 随之变高；底部导航条 `flex: 0 0 auto` 常驻不随正文滚动。弹框吃满一屏（wrap 不再加 `padding: 12px 0` 上下留白），正文区底色改 `#00000087`（纸面浮在深色底上）
- 弹框高度基准：**以 `.ant-modal-wrap` 实际盒子为基准**——wrap 是 `position: fixed; inset: 0`（= 视口高、无内边距），`.ant-modal { height: 100%; max-height: 100% }` 吃 wrap 的 content box，正好「最多一屏」，不会比 wrap 高而在视口右缘（弹框外）弹出滚动条；wrap 吃 antd 默认 `overflow: auto`（不再覆盖 `overflow: hidden`），因弹框高度不超过 wrap，wrap 自身不产生滚动条；弹框链路上唯一实际滚动容器是 `.reader-scroll`。已知问题：弹框开 / 关会改写 `document.body` 的溢出与宽度（antd 滚动锁），导致页面抖动与滚动位置重置，见 bug-00017
- 页面滚动口径：弹框打开时页面不滚动、屏幕右缘不出现页面级滚动条——antd 滚动锁（`vc-util/Dom/scrollLocker.js`）在 lock 时对 container（默认 `document.body`）设 `overflow/overflowX/overflowY: hidden`，并在检测到滚动条占位时设 `width: calc(100% - scrollBarSize)`；原先 `html { overflow-y: scroll }` 强制常驻绘制滚动条才是右缘那条 inert 滚动条，故全局改为 `html { overflow-y: auto; scrollbar-gutter: stable }`：槽位照旧预留（滚动条出现 / 消失不再横向抖动，bug-00011 修法效果保留），但无溢出时不绘制。已知边界：Safari 18.2 以下不支持 `scrollbar-gutter`，该情形退化为 `overflow-y: auto`，可能重现滚动条出现 / 消失的横向抖动，属已知约束，需要时另开票
- 定位与防抖：正文区高度固定，翻回 / 跳转时 `data = null` 不再塌缩；先置 `loading = false` + `await nextTick()` 让 chunk 行挂载，再用容器内偏移 `scrollTop = centeredScrollTop(el.offsetTop, el.offsetHeight, container.clientHeight)` 居中，不用 `scrollIntoView`（避免连带滚动弹框外层 / 页面）（2026-09-22 二次验收仍未通过：定位时机仍可能早于弹框正文挂载，见 bug-00016）
- 定位测量口径：只用**与祖先 transform 无关的布局量**（`offsetTop` / `offsetHeight` / `clientHeight`）——antd v4 Modal 打开带 `ant-zoom` 动画（`.ant-modal` 上 `scale(0.2)` → `scale(1)`，0.3s），祖先 transform 会等比缩放 `getBoundingClientRect`，用 rect 差值算偏移会被乘上当时的 scale 而偏上；故 `.reader-scroll` 加 `position: relative` 使其成为 `chunk-row` 的 offsetParent，组件内不保留任何依赖 rect 的定位计算
- 底部「上一回/下一回 {标题}」直取 data.prev/next，第 1 / 120 回对应按钮禁用；回号输入跳转 1~120，越界 warning 不跳转
- 旧「chunkId 纯文本」渲染路径随入口改造一并清理（验收 14）
- 复制：复制 traceId / chunkId 均走 copyText 降级路径（http / https 都能复制），成功 message 反馈
- 引用卡片本体不加点击入口；阅读器不渲染引用角标
