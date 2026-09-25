# 需求索引

编号规则：首位字母 = 年份（A=2026, B=2027, ...），后三位数字自增，每年重置。

| 特性号 | 标题 | 涉及项目 | 状态 | 定稿日期 |
|--------|------|----------|------|----------|
| feat-A001 | 天气助手页面 | mcp-web, mcp-orchestrator, mcp-server | 草稿 | — |
| feat-A002 | 风云三国知识问答 | mcp-web, mcp-orchestrator | 定稿 | 2026-09-14 |
| feat-A003 | 模型自主工具路由（统一对话入口） | mcp-orchestrator, mcp-server, mcp-web | 定稿 | 2026-09-15 |
| feat-A004 | 三国演义解读（只解读不评论） | mcp-orchestrator, mcp-server, mcp-web | 定稿 | 2026-09-16 |
| feat-A005 | 风云三国迁出总台（fengyunsanguo MCP） | mcp-orchestrator, mcp-server, mcp-web | 定稿 | 2026-09-20 |
| feat-A006 | 答案展示结构化（结论 + 引用出处卡片） | mcp-orchestrator, mcp-web | 定稿 | 2026-09-20 |
| feat-A007 | 链路日志追踪（后台管理页） | mcp-orchestrator, mcp-web | 定稿 | 2026-09-20 |
| feat-A008 | 风云三国与天气日志补全 | mcp-orchestrator, mcp-web | 已归档 | 2026-09-21 |
| feat-A009 | 检索诊断（召回可解释） | mcp-server, mcp-orchestrator, mcp-web | 已归档 | 2026-09-21 |
| feat-A010 | 原文查看（A4 阅读器）+ 日志页筛选增强 | mcp-web, mcp-orchestrator, mcp-server | 已归档 | 2026-09-22 |
| feat-A011 | 输入 token 优化（提示词瘦身 + 天气下线 + auto 轻量分类） | mcp-orchestrator, mcp-web | 已提测 | 2026-09-22 |
| feat-A012 | LLM 调用可观测增强（`reasoning_tokens` + 重试标识 + 路由来源 + Token 明细与图表缓存维度 + 状态列简化） | mcp-orchestrator, mcp-web | 已提测 | 2026-09-23 |
| feat-A013 | 三国演义问答缓存（应用层 query→answer 语义缓存，含命中解释 / 分布图表 / 开关 / 清除） | mcp-orchestrator, mcp-web, mcp-server | 已归档 | 2026-09-23 |
| feat-A014 | 标签体系评审与使用边界（删四类事件标签、索引剥壳、保留死亡意图与 0.1 通路、校验校准） | mcp-server | 已归档 | 2026-09-24 |
| feat-A015 | 三国演义 RAG 回归标准集 | dev-docs, mcp-server, mcp-web | 草稿 | — |
| feat-A999 | 长期文档与仓库维护（不上线、不归档；仅 Coco 文档提交用） | dev-docs | 草稿 | — |

> feat-A009 依赖顺序：feat-A008（已归档）→ bug-00010（已修复）→ feat-A009（2026-09-21 定稿，前置已解除，可开工）。


> 未立项的迭代想法、候选方向见 [BACKLOG.md](BACKLOG.md)。那不是需求、不占编号，立项才发 feat 号。
