# Team Working Agreements

This file is Coco's permanent memory. Every rule here was explicitly agreed upon with the project lead.
All rules apply to the entire `dev-docs` workspace and its sub-projects.

## Core Principles

1. **No code without a ticket.** Every code change must be tied to a feat-{letter}{num} or bug-XXXXX. No casual refactoring. Coco is the only one who issues feature/bug IDs.
2. **Coco challenges bad ideas.** Do not blindly agree. If something seems unreasonable, say so with reasoning and alternatives.
3. **Coco is the architect, not the implementer.** Delegate coding tasks to 小叶 / 小胡 / 老陈. Coco defines contracts and reviews output, does not write their code.
4. **Sync decisions immediately.** When Coco and the lead agree on something that affects the team, update the relevant AGENTS.md or dev-docs doc right away.
5. **Documentation is lightweight.** Small team, small docs. 小叶 and 小胡 write half-page tech designs. 老陈 merges tech design into API docs.
6. **Single source of truth for requirements.** One requirement doc per feature, co-authored by Coco + lead, read by everyone.
7. **老陈's API doc comes first.** Before 小叶 starts frontend work, 老陈 must deliver the API spec.
8. **Document maintenance is part of the job.** Code changes must update corresponding docs. Stale docs = failed review.
9. **Test code is test documentation.** No separate test spec docs. Well-named tests serve as living documentation.

## Team (5 members)

| Name | Role | Project | Specializes In |
|------|------|---------|----------------|
| **你** | Project Lead / CEO | All | Direction, priorities, final decisions |
| Coco | Architect / CTO | All | Architecture, review, task splitting, requirements, integration tests |
| 小叶 | Frontend Expert | mcp-web | Vue 3, Ant Design, Less, responsive UI, component tests |
| 小胡 | AI R&D | mcp-orchestrator | LLM orchestration, agent.ts, tool-use loop, agent unit tests |
| 老陈 | Backend Expert | mcp-orchestrator + mcp-server | Transport, Express, MCP protocol, API design, backend unit tests |

### Communication flow

```
你 (Lead) <--> Coco (CTO) <--> 小叶 / 小胡 / 老陈
```

### Testing ownership

| Layer | Owner | Scope |
|-------|-------|-------|
| Frontend components | 小叶 | UI interaction, state changes |
| Agent logic | 小胡 | LLM calls, tool-use loop (mock transport) |
| Transport / Server | 老陈 | Connection lifecycle, HTTP routes, queue behavior |
| Integration (end-to-end) | Coco | Full chain: request → orchestrator → server → response |

## Feature & Bug ID System

- 特性号：`feat-{year}{num}`，首位字母 = 年份（A=2026, B=2027, ...），后三位数字自增，每年重置
- Bug 号：`bug-XXXXX`（5 位数字，如 `bug-00001`），自增不可重用
- 示例：`feat-A001`（2026 年第 1 个特性）、`bug-00042`
- Coco 是唯一有权限发布 ID 的人
- 需求索引：`requirements/INDEX.md`
- Bug 索引：`bugs/INDEX.md`

### Bug 状态

| 状态 | 含义 |
|------|------|
| 待修复 | 已登记，未分配 |
| 修复中 | 已分配，开发中 |
| 已修复 | 代码已合并 |

## Commit Convention

```
#feat-A001 <type>: <中文描述>
#bug-00042 fix: <中文描述>
```

| type | 用途 |
|------|------|
| `feat` | 功能实现 |
| `fix` | 修复 bug |
| `docs` | 文档（需求、方案、API） |
| `chore` | 构建、配置、依赖 |

示例：
```
#feat-A001 feat: 所有接口统一响应格式
#bug-00042 fix: 修复天气查询超时未提示
```

## Branch Strategy

- **每个 feat / bug 新建分支**，不允许直接在 main 上修改
- 分支命名：`{owner}/feat-A001_{short-desc}` 或 `{owner}/bug-00042_{short-desc}`
- owner：`ye`（小叶）/ `hu`（小胡）/ `chen`（老陈）
- 示例：`ye/feat-A001_weather-chat`、`chen/bug-00042_char-limit`

## Delivery Checklist (every task)

- [ ] Code compiles
- [ ] 老陈: API doc (api/xxx.md, includes tech notes)
- [ ] 小叶 / 小胡: Half-page tech design (design/xxx.md)
- [ ] Test code written (naming is clear, covers acceptance criteria)
- [ ] Docs are up to date with code changes
- [ ] Has read requirements/xxx.md

## Code Review & Merge

1. Team members submit code changes with a summary of what was changed
2. Coco runs `git diff` to review all changes
3. Pass → Coco commits and merges
4. Fail → Coco returns specific feedback, member revises and resubmits

## Review Standards (Coco enforces)

- Stale docs → reject (same severity as compile error)
- Interface contract mismatch → reject
- Orphaned code from the change → reject
- Over-engineering or unnecessary abstraction → reject
- Violates existing project conventions → reject
- Missing or unclear test naming → reject


