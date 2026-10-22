# dev-docs

天枢项目群的跨项目开发文档仓库，服务于 mcp-web、mcp-orchestrator、mcp-server 及未来所有项目。

> 原则：小团队，文档宜轻不宜重。测试代码即测试文档，不单独维护测试用例清单。

## 目录结构

```
dev-docs/
├── README.md
├── AGENTS.md                    团队约定（Coco 的永久记忆）
├── requirements/                每个需求一份，跨项目共享
│   ├── INDEX.md                 需求登记表
│   ├── BACKLOG.md               未立项的迭代想法池（不占编号）
│   └── feat-A001-*.md           需求文档
├── bugs/                        Bug 文档与索引
│   └── INDEX.md                 Bug 登记表
├── docs/                        架构、对接流程、排查手册、专题设计
│   ├── architecture.md          架构与调用关系
│   ├── requirement-intake.md    需求对接流程
│   ├── bug-intake.md            Bug 对接流程
│   └── troubleshooting.md       排查手册
├── templates/
│   ├── requirement.md           需求文档模板
│   ├── tech-design.md           轻量技术方案模板
│   └── api-spec.md              接口文档模板
│
├── mcp-web/
│   └── design/                  按需技术方案（小叶）
│
├── mcp-orchestrator/
│   ├── design/                  半页技术方案（小胡）
│   └── api/                     接口文档与统一响应约定（老陈）
│
├── handoff/                     任务交接摘要
├── scripts/                     仓库维护与数据脚本
└── test/                        评测数据、探针与复现脚本
```

## 编号

- 特性号：`feat-{年份字母}{三位数字}`，A=2026；由负责人指定，自增不可重用。
- 故事号：`story-{特性号}-{两位序号}`，由 Coco 登记在对应需求文档。
- Bug 号：`bug-{五位数字}`，由 Coco 按 `bugs/INDEX.md` 自增发行。
- 文档与仓库维护统一使用 `feat-A999`。

需求索引表：[requirements/INDEX.md](requirements/INDEX.md)

Bug 索引表：[bugs/INDEX.md](bugs/INDEX.md)

迭代想法池：[requirements/BACKLOG.md](requirements/BACKLOG.md)（候选方向，未立项，不占编号）

## 工作流

```
1. 需求讨论
   Coco 起草 → 负责人反复核对修改 → 定稿 → 登记到 INDEX.md
   产出：requirements/feat-XXX-*.md（唯一一份，全员阅读）

2. 任务分配
   Coco 拆分任务并分配给小叶 / 小胡 / 老陈（子 Agent），明确产出与验收标准
   有依赖的任务串行（老陈接口文档先出），其余并行

3. 开发前
   老陈 → 接口文档 + 表设计
   小胡 → 半页技术方案
   小叶 → 按需技术方案（用到新技术，或负责人 / Coco 判断有价值时）

4. 开发 + 测试
   三人并行开发，各自写测试代码（命名清晰，覆盖验收标准）
   成员自测通过 → Coco 合入需求分支并审查 → 提测
   负责人在需求分支上端到端验收（人工）

5. 验收通过后
   Coco 发起 PR（目标 main）
   → 负责人合并 PR
```

## 交付清单

- [ ] 代码实现，编译通过
- [ ] 老陈：接口文档 + 表设计
- [ ] 小胡：半页技术方案
- [ ] 小叶：按需技术方案（用到新技术，或负责人 / Coco 判断有价值时）
- [ ] 测试代码（命名清晰，覆盖需求验收标准）
- [ ] 文档与代码同步
- [ ] 已阅读并理解 requirements/feat-XXX-*.md

## 测试分工

| 层 | 负责人 | 范围 |
|----|--------|------|
| 前端组件 | 小叶 | UI 交互、状态变更 |
| Agent 逻辑 | 小胡 | LLM 调用、tool-use 循环（mock transport） |
| Transport / Server | 老陈 | 连接生命周期、HTTP 路由、队列行为 |
| 端到端验收 | 你（负责人） | 提测后在需求分支上人工验收：请求 → orchestrator → server → 响应 |
