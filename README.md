# dev-docs

跨项目的开发文档仓库，服务于 mcp-web、mcp-orchestrator、mcp-server 及未来所有项目。

> 原则：小团队，文档宜轻不宜重。测试代码即测试文档，不单独维护测试用例清单。

## 目录结构

```
dev-docs/
├── README.md
├── AGENTS.md                    团队约定（Coco 的永久记忆）
├── requirements/                每个需求一份，跨项目共享
│   ├── INDEX.md                 需求登记表
│   ├── BACKLOG.md               未立项的迭代想法池（不占编号）
│   └── FEAT-NNN-title.md
├── templates/
│   ├── requirement.md           需求文档模板
│   ├── tech-design.md           轻量技术方案（小叶 / 小胡，半页）
│   └── api-spec.md              接口文档（老陈，含技术要点）
│
├── mcp-web/
│   └── design/                  小叶的半页技术方案
│
├── mcp-orchestrator/
│   ├── design/                  小胡的半页技术方案
│   └── api/                     老陈的接口文档（技术方案已合并）
│
├── mcp-server/
│   └── api/                     老陈的接口文档（如有变更）
│
└── architecture/
    └── decisions/               架构决策记录（ADR），Coco 维护
```

## 特性号（FEAT-ID）

每个需求分配唯一编号 `FEAT-NNN`，自增不可重用。所有文档通过特性号关联。

需求索引表：[requirements/INDEX.md](requirements/INDEX.md)

迭代想法池：[requirements/BACKLOG.md](requirements/BACKLOG.md)（候选方向，未立项，不占编号）

## 工作流

```
1. 需求讨论
   Coco 起草 → 你反复核对修改 → 定稿 → 登记到 INDEX.md
   产出：requirements/FEAT-NNN-title.md（唯一一份，全员阅读）

2. 开发前
   老陈 → api/FEAT-NNN-xxx.md（接口文档，含技术要点）
   小叶 → design/FEAT-NNN-xxx.md（半页方案）
   小胡 → design/FEAT-NNN-xxx.md（半页方案）

3. 开发 + 测试
   三人并行开发，各自写测试代码（命名清晰，覆盖验收标准）
   需求分支合齐 → Coco 审查通过 → 提测
   负责人在需求分支上端到端验收（人工）

4. 验收通过后
   Coco 发起 PR（目标 main）
   → 负责人合并 PR
```

## 交付清单

- [ ] 代码实现，编译通过
- [ ] 老陈：接口文档（api/xxx.md，含技术要点）
- [ ] 小叶 / 小胡：半页技术方案（design/xxx.md）
- [ ] 测试代码（命名清晰，覆盖需求验收标准）
- [ ] 文档与代码同步
- [ ] 已阅读并理解 requirements/FEAT-NNN-xxx.md

## 测试分工

| 层 | 负责人 | 范围 |
|----|--------|------|
| 前端组件 | 小叶 | UI 交互、状态变更 |
| Agent 逻辑 | 小胡 | LLM 调用、tool-use 循环（mock transport） |
| Transport / Server | 老陈 | 连接生命周期、HTTP 路由、队列行为 |
| 端到端验收 | 你（负责人） | 提测后在需求分支上人工验收：请求 → orchestrator → server → 响应 |
