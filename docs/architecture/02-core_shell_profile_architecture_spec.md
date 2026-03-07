# Core + Shell + Profile 总体架构规范

**文档 ID**: AGENT-ARCH-SYSTEM-002  
**标题**: Core + Shell + Profile 总体架构规范  
**版本**: 1.1.0  
**状态**: Draft  
**受众**: 架构师、工程师、评审者、代码生成工具  
**语言**: 中文  
**更新时间**: 2026-03-06

---

## 1. 目的

本文定义系统总体分层与边界，明确：

1. Core、Shell、Profile 的职责；
2. 控制流与依赖方向；
3. LLM/工具/中间件/沙箱应位于哪一层；
4. 哪些能力允许扩展，哪些语义禁止漂移。

---

## 2. 架构目标

1. **核心语义稳定**：Core 只定义状态机与运行语义。  
2. **外部能力可替换**：provider/tool/sandbox 可替换，不破坏 Core。  
3. **场景装配独立**：不同业务工作流由 Profile 提供，不污染 Core。  
4. **全链路可审计**：上下文、证据、执行轨迹可追踪。  
5. **扩展可控**：通过 middleware/hook 增强，不通过 core 分叉。

---

## 3. 三层模型

```text
Profile（场景装配）
   |
   v
Shell（外部效应层）
   ^
   |
Core（封闭语义内核）
```

### 3.1 Core（内核）

负责：

- 状态与状态迁移；
- plan/task/milestone/review/replan 语义；
- 何时 done / failed 的最终判定。

不负责：

- 直接调用 LLM；
- 直接执行工具命令；
- 绑定具体 workflow 工具名；
- 维护 provider 私有协议。

### 3.2 Shell（外部效应层）

负责：

- 接收 Core 请求并执行外部动作；
- 组装上下文并调用 provider；
- 执行工具、命令、沙箱；
- 归一化结果并回传 Core；
- 记录 evidence/audit。

### 3.3 Profile（场景装配层）

负责：

- 选择工具集与 middleware；
- 设定 policy（allowed tools/commands/budgets）；
- 注入场景规则（例如 patch 工作流、HITL 规则）。

限制：

- 不能直接改写 Core 状态机语义；
- 只能通过 Shell 能力配置影响执行路径。

---

## 4. 依赖方向（强约束）

1. Core 可以依赖 contracts，不依赖 profile。  
2. Profile 可以依赖 core contracts，但反向依赖禁止。  
3. Middleware 属于外部能力，不属于 Core 语义定义。  
4. 任意 workflow 专用工具名不得硬编码进 Core 默认逻辑。

---

## 5. 运行时交互模型

### 5.1 请求-结果模型

- Core 发出语义请求（例如：规划、执行、重规划）。  
- Shell 执行外部动作并返回归一化结果。  
- Core 消费结果并推进状态机。

### 5.2 典型一轮流程

1. Core 生成当前阶段上下文需求。  
2. Shell 组装 ContextPacket 并调用 Planner/LLM。  
3. Shell 按 policy + middleware 执行工具动作。  
4. Shell 返回结构化结果与 evidence。  
5. Core 执行 criteria/review，决定继续、修复或失败。

---

## 6. 中间件与 Hook 策略

中间件用于机制增强，不改核心语义：

- `init`：包装运行时能力（如 runCmdImpl）；
- `tools`：注入工具；
- `wrapProvider`：注入 provider 规则；
- `hooks`：在关键点拦截/观测（如 `onBeforeToolCall`）。

推荐边界：

- 人审 HITL：放 middleware；
- 文件系统能力：放 middleware；
- 业务工作流限制：放 Profile policy，不放 Core。

---

## 7. 里程碑与全局验收门禁

架构要求：

1. task 完成不等于 milestone 完成；必须执行 milestone review gate。  
2. milestones 完成不等于 run 完成；必须执行 integration review gate。  
3. review 失败进入 repair/replan 循环，预算耗尽才失败终止。

这套 gate 机制属于 Core 语义，不属于某个 Profile 的业务特例。

---

## 8. 扩展新工作流的方法

新增工作流时：

1. 新建 `src/profiles/<your_profile>.ts`；
2. 组合所需工具和 middleware；
3. 配置 policy 与预算；
4. 调用 `runCoreAgent`。

不要：

- 修改 Core 去适配某个具体 workflow；
- 在 Core 默认 planner/policy 写入场景专用工具名。

---

## 9. 审计与回放

系统应保留以下可回放信息：

- context packet 引用；
- evidence 引用；
- tool 调用与结果；
- milestone/goal review 历史；
- 失败原因与重规划轨迹。

目标是“可解释失败、可重放决策、可对比修复路径”。

---

## 10. 实施建议

1. 保持 contracts 稳定，避免跨层类型漂移。  
2. workflow 规则统一下沉到 profile。  
3. Core 只做语义，不做场景偏好。  
4. 先补测试再扩能力，优先覆盖 review gate 与 replan 路径。

