# Agent 架构术语规范

**文档 ID**: AGENT-ARCH-GLOSSARY-001  
**标题**: Agent 架构术语规范  
**版本**: 1.1.0  
**状态**: Draft  
**受众**: 架构师、工程师、评审者、代码生成工具  
**语言**: 中文  
**更新时间**: 2026-03-06

---

## 1. 目的

本文用于统一本仓库的 Agent 架构术语，避免同一概念出现多套叫法，确保：

1. 团队沟通语义一致；
2. 设计文档与实现代码可一一映射；
3. 评审、排障、回放使用同一词典；
4. 自动化工具不会误解跨层概念。

除非特别声明，本文为规范性文档。

---

## 2. 适用范围

本文覆盖以下主题术语：

- Core / Shell / Profile 分层；
- Agent Loop（计划、执行、验收、修复、重规划）；
- State、Task、Milestone、Action、Evidence；
- Planner、Tool、Middleware、Hook、Sandbox；
- 审计与回放相关概念。

本文不定义：

- 产品业务需求；
- 具体 Prompt 文案；
- 厂商 API 私有字段；
- 某个 Profile 的专有策略细节。

---

## 3. 术语强度词

本文中的 **必须**、**禁止**、**应该**、**可以** 含义如下：

- **必须 / 禁止**：强约束；
- **应该**：推荐约束，偏离需要说明；
- **可以**：可选行为。

---

## 4. 分层总览（规范）

1. **Core**：封闭语义内核，负责状态机与决策语义。  
2. **Shell**：外部效应执行层，负责 LLM/工具/命令/沙箱/审计桥接。  
3. **Profile**：场景化装配层，决定 Shell 启用哪些能力与策略。

约束：

- Core 不依赖 Profile；
- Core 不直接依赖外部 provider/tool 协议；
- Profile 不能改写 Core 状态机语义。

---

## 5. 规范术语表

| 概念 | 规范术语 | 代码锚点 | 定义 |
|---|---|---|---|
| 运行内核 | Core | `src/core/**` | 封闭状态机，定义语义与转移 |
| 外部执行层 | Shell | （实现层概念） | 执行外部效果并归一化结果 |
| 场景装配 | Profile | `src/profiles/**` | 组合工具、中间件、策略 |
| 计划器 | Planner | `src/core/contracts/planning.ts` | 基于上下文生成 plan/tool calls/plan change |
| 工具规范 | ToolSpec | `src/core/contracts/tools.ts` | 单个工具的输入解析与执行契约 |
| 中间件 | KernelMiddleware | `src/core/middleware/types.ts` | 注入工具、包裹 provider、注册 hooks |
| Hook 扩展点 | KernelHooks | `src/core/contracts/hooks.ts` | 核心流程中的通用拦截/观察点 |
| 运行状态 | AgentState | `src/core/contracts/state.ts` | 运行过程的语义状态快照 |
| 计划 | PlanV2 | `src/core/planning/Plan.ts` | 目标、里程碑、全局验收 |
| 里程碑 | Milestone | `src/core/planning/Plan.ts` | 任务集合 + 里程碑验收 |
| 任务 | PlanTask | `src/core/planning/Plan.ts` | 最小可调度执行单元 |
| 成功准则 | SuccessCriterion | `src/core/planning/Plan.ts` | 可判定的验收条件 |
| 证据 | Evidence | `src/core/contracts/context.ts` | 命令结果与错误结构化摘要 |
| 上下文包 | ContextPacket | `src/core/contracts/context.ts` | 提供给 Planner 的固定分区上下文 |
| 人审 | HITL | `src/middleware/humanInTheLoop.ts` | 命令/补丁审批门禁（通过 middleware） |

---

## 6. 术语使用规则

1. 说“工具”时，指 ToolSpec 注册项，不叫插件。  
2. 说“中间件”时，指 KernelMiddleware，不等同于 Profile。  
3. 说“Profile”时，指装配配置，不是 Core。  
4. 说“修复（repair）”时，指在当前目标内补救；“重规划（replan）”指计划层变更。  
5. “完成（done）”只用于 run 终态，不用于局部任务。

---

## 7. 常见误用与纠正

- 误用：把 `apply_structured_edits` 当作 Core 固有能力。  
  纠正：它是外部工具，是否启用由 Profile 决定。

- 误用：把 Milestone 完成等同于 Task 全部执行完成。  
  纠正：Milestone 必须额外通过 milestone acceptance review。

- 误用：将 HITL 放到 Core 逻辑分支里。  
  纠正：HITL 应通过 middleware + hook 实现。

---

## 8. 极简架构图

```text
Profile (装配策略)
    |
    v
Shell (LLM/Tools/Middleware/Sandbox/Audit)
    ^
    |
Core (状态机语义: plan -> task -> review -> repair/replan)
```

---

## 9. 版本策略

当出现新增术语或语义调整：

1. 先更新本文；
2. 再更新实现注释与架构文档；
3. 最后更新测试命名与日志字段。

