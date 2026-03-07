# Core 内部设计与 Agent Loop 规范

**文档 ID**: AGENT-ARCH-CORE-003  
**标题**: Core 内部设计与 Agent Loop 规范  
**版本**: 1.1.0  
**状态**: Draft  
**受众**: 架构师、工程师、评审者、代码生成工具  
**语言**: 中文  
**更新时间**: 2026-03-06

---

## 1. 目的

本文定义 Core 的内部职责边界与 Agent Loop 的运行语义，重点回答：

1. Core 内部由哪些模块组成；
2. 运行状态如何迁移；
3. Task / Milestone / Goal 的验收顺序是什么；
4. 失败后如何进入 retry / repair / replan；
5. Core 与外部效应层如何交互。

---

## 2. Core 设计原则

1. **封闭语义**：Core 决定语义，外部能力只提供结果。  
2. **确定性控制**：状态迁移由规则驱动，不靠隐式 prompt 推断。  
3. **可恢复**：失败可分类并进入明确恢复路径。  
4. **可审计**：关键决策节点可回放（context/evidence/turn 记录）。

---

## 3. Core 内部模块

### 3.1 Flow

- `runCoreAgent`：初始化运行环境与依赖。  
- `runPlanFirstAgent`：主循环编排。  
- `runTurn`：选择当前可执行任务。  
- `runTaskWithRetries`：任务重试控制。  
- `runTaskAttempt`：单次任务尝试。  
- `handleReplan`：计划补丁与重规划。

### 3.2 Execution

- `executeToolCall`：单工具执行与 hook 拦截。  
- `executeActionPlan`：一组工具调用执行。  
- `evaluateCriteriaSet`：通用验收标准判定。  
- `errors/failures`：错误标准化与失败分类。

### 3.3 Context

- `ContextEngine`：构建给 Planner 的统一上下文包。  
- 上下文包含：目标、快照、证据、相关代码、变更摘要、记忆、下一步请求。

### 3.4 Policy & Gate

- allowed tools / allowed commands 约束。  
- tool call 数量与 action budget 约束。  
- plan change gate 与人工审核解释流程。

---

## 4. 关键数据模型

### 4.1 PlanV2

- `goal`：全局目标。  
- `milestones[]`：里程碑集合。  
- `goal_acceptance[]`：全局联调验收标准。

### 4.2 Milestone

- `tasks[]`：本里程碑任务集合。  
- `acceptance[]`：里程碑完成门禁。

### 4.3 PlanTask

- `dependencies[]`：依赖任务 ID。  
- `success_criteria[]`：任务级成功标准。

### 4.4 AgentState（与本主题相关）

- `status`：planning/executing/reviewing/replanning/done/failed。  
- `activeMilestoneId`：当前里程碑。  
- `completedTasks[]`：已完成任务。  
- `milestoneReviewHistory[]`：里程碑验收历史。  
- `goalReviewHistory[]`：全局验收历史。

---

## 5. Agent Loop（规范执行顺序）

### 5.1 初始计划阶段

1. 构建 planning context packet。  
2. Planner 产出 `PlanV2`。  
3. 计划进入 state，开始 milestone 循环。

### 5.2 里程碑执行阶段

对每个 milestone：

1. 设置 `activeMilestoneId`。  
2. 持续选择并执行该 milestone 内可执行 task，直到任务全部完成。  
3. 执行 milestone acceptance review（`evaluateCriteriaSet`）。

### 5.3 里程碑修复阶段（Milestone Repair）

若 milestone review 失败：

1. 进入 replan，目标是修复当前 milestone。  
2. 将补救 patch 应用到当前计划（通常是追加/更新任务）。  
3. 返回当前 milestone 继续执行，直到 review 通过或预算耗尽。

### 5.4 全局联调阶段（Integration Review）

当所有 milestone 通过后：

1. 执行 `goal_acceptance` review。  
2. 若通过：状态进入 `done`。  
3. 若失败：进入 integration repair。

### 5.5 全局修复阶段（Integration Repair）

1. 触发 replan 生成全局补救计划。  
2. 补救任务执行完后再次进行 goal review。  
3. 达到 replan 预算上限则 `failed`。

---

## 6. Tool 执行与 Hook 语义

`onBeforeToolCall` 决策：

- `allow`：继续执行；
- `deny`：拒绝执行并记错误；
- `override_call`：替换 call 后重新走 policy/schema；
- `override_result`：跳过实际执行，直接消费结果。

`onToolResult` 与 `onPatchPathsChanged` 用于后处理与观测，不改变核心状态机定义。

---

## 7. 验收标准执行器（Criteria Engine）

`evaluateCriteriaSet` 支持：

- `tool_result`
- `file_exists`
- `file_contains`
- `command`

要求：

1. `command` 必须经过 allowed commands gate。  
2. 失败返回结构化 `failures[]`，且附可定位 note。  
3. Task、Milestone、Goal 三层都复用同一执行器。

---

## 8. 失败与终止规则

以下情况会进入 `failed`：

1. 无可执行任务且并非已完成状态；
2. 运行超过 max turns；
3. replan 预算耗尽；
4. milestone/goal review 长期失败且无法生成有效补救；
5. policy gate 明确拒绝关键动作。

---

## 9. 审计与回放要求

每轮至少应记录：

- context packet ref；
- planner raw 输出；
- tool calls 与 tool results；
- evidence ref（如 stdout/stderr blob ref）；
- review 结果（milestone / goal）。

目标：可还原“为何某个任务、里程碑、全局验收通过或失败”。

---

## 10. 实施边界

本文仅定义 Core 语义，不约束：

- 具体 provider 接入；
- 具体工具实现细节；
- profile 的业务策略与工具组合；
- 前端界面的人审交互形态。

