# 风云三国知识问答（模式标签与服务面板）— 技术方案

> 作者：小叶
> 对应特性号：feat-A002
> 日期：2026-09-14

## 涉及文件（mcp-web）

| 文件 | 操作 | 说明 |
|------|------|------|
| src/views/WeatherView.vue | 修改 | 「天气」「风云三国」单选 Tag；风云三国常见服务面板（问题查询/随机一题，✕ 收起）；聊天框模式标签与按模式切换的空状态/占位/加载文案 |
| src/stores/chat.ts | 修改 | Pinia 状态 mode/sangoService/sessionId；setMode/setSangoService 统一 resetChatSession() 防幽灵会话 |
| src/api/client.ts | 修改 | sendChatMessage 增加 ChatRequestOptions（scenario/service/sessionId 可选），按场景组包 |

## 核心流程

```
选择模式（天气 / 风云三国 / 未选择=普通问答）
  → 选中风云三国: 顶部展开「风云三国常见服务」面板（✕ 仅收起面板，不影响已选子服务）
  → 选择子服务（问题查询/随机一题）: 聊天框显示模式标签 + resetChatSession 清记录并重建 sessionId
  → 发送: 校验（sango 未选子服务 → message.warning 拦截）
  → 组包: general 只发 message / weather 带 scenario / sango 带 scenario+service+sessionId
  → 回复: 纯文本 pre-wrap 渲染 + 复制按钮（随机一题无选项按钮，输入选项字母 A-D 或文本作答）
```

## 选型 & 注意

- 模式状态收敛到 Pinia（mode / sangoService / sessionId）；标题、空状态图标与文案、placeholder、loading 文案由页面 computed 按模式派生
- 切换模式/子服务统一走 setMode/setSangoService → resetChatSession()：清空消息与 error、重建 sessionId，防止后端幽灵会话串题；相同值重复选择直接 return，不触发重置
- setMode 切到非 sango 时清空 sangoService；风云三国 Tag 取消选中但面板已收起 → 先展开面板而非退出模式
- sango 未选子服务就发送：拦截并提示「请先选择「问题查询」或「随机一题」」
- 面板显隐是页面局部 ref（panelVisible），不进 Pinia；关闭面板不影响已选子服务与聊天
- 组包集中在 store.buildChatOptions()：general 缺省不发 scenario，后端按缺省走普通问答；sango 必须带 service+sessionId
- sessionId 前端生成：`Date.now().toString(36)` + 随机串；模式标签「风云三国-知识问答 / 风云三国-随机一题」仅在 sango 且已选子服务时显示
