# Shell 内部设计与效应处理规范

**文档 ID**: AGENT-ARCH-SHELL-004  
**标题**: Shell 内部设计与效应处理规范  
**版本**: 1.2.0  
**状态**: Draft  
**受众**: 架构师、工程师、评审者、代码生成工具  
**语言**: 中文  
**更新时间**: 2026-03-08

---

## 1. 引言与目的

本文是当前五层基线中的 Shell 层规范文档。`02-core_shell_profile_architecture_spec.md` 负责整体分层与主线路径，本文只聚焦 Shell 内部职责、effect request/result 桥接、结果归一化与可观测性边界。本文描述的是当前实现态与规范边界，不是未来完整 agent 平台的所有外部集成设计。阅读时应与 glossary、runtime visual model 交叉对照。

---

## 2. Shell 职责边界

Shell 必须负责：

- 接收 normalized `EffectRequest`；
- 组织上下文构造与执行输入；
- 承接外部能力调用（按 request 类型进入 capability path）；
- 执行 action / effect handling；
- 进行结果归一化；
- 返回 normalized `EffectResult`；
- 保留可审计执行痕迹。

Shell 不负责：

- Core 状态机语义；
- `done` / `failed` 判定；
- task / milestone / goal acceptance 语义；
- retry / repair / replan 语义定义。

Shell 是 integration layer，不是语义裁决层。

---

## 3. 内部分解建议（当前实现态优先）

### 3.1 Effect Request Handler

- 当前映射：`executeEffectRequest`（`src/shell/execute-effect-request.ts`）。
- 职责：接收并分派 `EffectRequest.kind`，进入对应处理路径。

### 3.2 Action Extractor Boundary

- 当前映射：`extractActionsFromEffectRequest`（`src/shell/extract-actions-from-effect-request.ts`）。
- 职责：从 `EffectRequest` 提取合法 `Action[]`，不负责执行和聚合。

### 3.3 Action Executor Boundary

- 当前映射：`executeActions`（`src/shell/action-executor.ts`）。
- 职责：将 `Action[]` 转为 `ActionResult[]`，当前为最小 executor boundary。

### 3.4 Action Result Builder

- 当前映射：`buildActionResult`（`src/shell/build-action-result.ts`）。
- 职责：将单个 `Action` 转换为 `ActionResult`。

### 3.5 Effect Result Builder

- 当前映射：`buildEffectResultFromActionResults`（`src/shell/build-effect-result-from-actions.ts`）。
- 职责：将 `ActionResult[]` 聚合为 `EffectResult`。

### 3.6 Shell Runtime Loop

- 当前映射：`prepareShellRuntimeStepTick`、`executeShellRuntimeRequest`、`runShellRuntimeStep`、`runShellRuntimeLoop`（`src/shell/*`）。
- 职责：将 shell step 拆分为 tick 准备边界、request 执行边界、step 编排与 loop 编排，并保持 incoming result 的回流。
- 说明：这是当前实现态对 runtime 粒度的细化，不代表更大平台能力的承诺。

### 3.7 Context Construction Boundary

- 当前主线：保持边界位，不强制具体实现。
- 说明：Shell 语义允许承载上下文构造能力，但当前主线未展开完整 context engine。

### 3.8 Result Normalization Boundary

- 当前主线：已形成 `Action -> ActionResult -> EffectResult` 的最小归一化路径。
- 说明：provider/tool/sandbox 原生结果应先归一化再回流 Core。

### 3.9 Telemetry / Audit Hooks（治理机制）

- 当前主线：保留治理扩展位，不作为 Shell 语义主体。
- 说明：可用于 tracing/metrics/audit，但不应改变 Core 语义。

> 说明：完整 provider bridge、真实 tool executor、完整 sandbox orchestration 属于 Shell 语义边界内允许承载的能力，但当前未完整接入主线路径。

---

## 4. 效应处理生命周期

1. Shell 接收 Core 发出的 normalized `EffectRequest`。  
2. Shell 根据 `request.kind` 进入对应处理路径。  
3. Shell 组织该路径所需的上下文或执行输入。  
4. Shell 调用外部能力或内部 builder（按能力路径选择）。  
5. Shell 先产出 `ActionResult[]`，再聚合为 `EffectResult`。  
6. Shell 向 Core 回流 normalized `EffectResult`。

当前主线已落地的是最小路径：`execute_actions` 可进入 `EffectRequest -> Action[] -> ActionResult[] -> EffectResult` 桥接链路。`planning/toolcall/replan/review` 不应在本文中被表述为“已全部落地的固定阶段枚举”，它们仅可作为 Shell 可承载的 effect intent 示例。返回对象必须是 Core 可消费的 normalized protocol object，而不是私有 `ok/data/error/meta` 结构约定。

---

## 5. middleware / hook 语义（治理层）

middleware / hook 属于 Shell 治理与扩展机制，不是 Shell 规范语义本体。

可选用途包括：

- logging
- metrics
- tracing
- safety checks
- budget checks
- audit augmentation
- normalization assistance

约束：任何 hook/middleware 都不应改变 Core semantics。

---

## 6. 命令执行与安全

命令执行、sandbox、tool executor 都是 Shell 可接入能力，不是 Core 对象。命令相关策略属于 Shell capability governance。

治理原则：

1. 遵守 allowed commands policy；
2. 在需要时支持 HITL 审批；
3. 标准化 exit code / stdout / stderr；
4. 对高风险命令有明确拒绝策略。

命令执行不是 Shell 的唯一主场景，只是可接入能力之一。

---

## 7. 结果归一化与边界对象

所有 provider-native / tool-native / sandbox-native 输出，必须先归一化，再返回 Core。Core 只能看到边界安全的协议对象。

必须遵守：

- raw message objects 不能直接跨边界；
- tool-call payloads 不能直接作为 Core 原语；
- sandbox handles 不能直接跨边界；
- 应使用标准边界对象：`Action[]`、`ActionResult[]`、`EffectRequest`、`EffectResult`、`ContextPacket`。

这一节是 Core/Shell boundary rules 的实现落点。

---

## 8. 与 Profile 的协作

Profile 只配置 Shell assembly，不改变 Shell 对外边界协议，也不改 Core 语义。

Profile 可配置：

- handler bindings
- capability bindings
- action policy
- context policy
- middleware selection
- sandbox policy
- review routing policy

当前 Profile 实现仍偏 runtime profile，尚未形成完整场景化装配系统。

---

## 9. 当前实现边界 / 非目标

本文不假定以下能力已完整落地：

- 完整 provider bridge；
- 完整 tool execution runtime；
- 完整 sandbox orchestration；
- 完整 review routing；
- 完整 scenario-specific profile assembly。

这些能力属于 Shell 允许承载的方向；当前文档优先描述仓库主线路径中已可对照的能力与边界。
