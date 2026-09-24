# 模型自主工具路由（统一对话入口）— 技术方案

> 作者：小叶
> 对应特性号：feat-A003
> 日期：2026-09-15

## 涉及文件（mcp-web）

| 文件 | 操作 | 说明 |
|------|------|------|
| src/api/client.ts | 修改 | 删除 ChatScenario / SangoService / ChatRequestOptions 与组包逻辑；sendChatMessage(message) 只发 `{ message }`；新增 sendSangoRandom(message, sessionId?) → POST /sango/random；信封校验收敛到内部 postForAnswer() |
| src/stores/chat.ts | 修改 | 新增纯前端 UX 类型 ChatMode / SangoServiceId；mode 默认 null；computed usesSangoRandom 决定端点；setSangoService 接受 null（顺带修掉 main 上遗留的 TS2345 编译错误） |
| src/views/WeatherView.vue | 修改 | 类型改从 store 引入；退出标签改为 setMode(null)；保留「风云三国未选子服务」的发送拦截 |

## 核心流程

```
标签（天气 / 风云三国，默认不选）→ 只改 Pinia UX 状态，不进请求体
  → 选风云三国: 展开服务面板；选子服务 → resetChatSession()（清记录 + 重建 sessionId）
  → 发送: mode==='sango' 且未选子服务 → message.warning 拦截，不发请求
  → 端点二选一: 风云三国-随机一题 → POST /sango/random { message, sessionId }
                其余（含未选标签）  → POST /chat { message }
  → 回复: code===200 取 data.answer 纯文本渲染；否则展示 message
```

## 选型 & 注意

- 请求体瘦身：/api/chat 是严格白名单，多一个键就 400，所以「把标签翻译成 scenario/service」的逻辑整块删除，不留开关、不做兼容分支
- 端点选择条件只有一个：`mode === 'sango' && sangoService === 'random'`（store 内部 computed `usesSangoRandom`，不 return 出 store，避免无消费方的孤儿 API）。随机一题是确定性本地命令；知识问答 / 天气 / 普通问答全部交给模型自主路由，前端不预判语义
- sessionId 只服务随机一题：store 创建时生成一次，切标签或切子服务时 resetChatSession() 重建，保证同一轮「出题—作答—查答案」期间不变；空值不带该键（后端视同无会话）
- 保留的 UX 拦截及理由：风云三国已选但未选子服务时提示「请先选择「问题查询」或「随机一题」」。此时前端无法确定该走 /chat 还是 /sango/random，面板本就是让用户显式声明意图，属输入防呆，不是路由决策
- 标签保留、默认不选：用于能力可发现性与后续模板挂靠；未选标签时走 /api/chat，由模型自主路由（天气工具 / 题库 / 自由作答），hint 文案相应改为「未选择时由助手自动判断：天气 / 风云三国 / 自由问答」——A002 的「默认为普通问答」已过期；modeLabel 与输入框内标签在 mode 为 null 时返回空，展示逻辑无需额外分支
- 类型归属：ChatMode / SangoServiceId 是 UX 概念，从 api/client.ts 移到 stores/chat.ts，client.ts 只保留传输层契约（ApiResponse / ChatData）
- 破坏性变更无灰度：mcp-web 与 mcp-orchestrator 必须同一次发布
- 项目无测试设施，本期不新增测试框架；质量门槛为 `npm run build` + `npm run lint` 全绿
