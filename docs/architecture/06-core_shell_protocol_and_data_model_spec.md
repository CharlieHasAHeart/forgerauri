# Core-Shell 协议与数据模型规范

**文档 ID**: AGENT-ARCH-PROTOCOL-006  
**标题**: Core-Shell 协议与数据模型规范  
**版本**: 1.1.0  
**状态**: Draft  
**受众**: 架构师、工程师、评审者、代码生成工具  
**语言**: 中文  
**更新时间**: 2026-03-07

---

## 1. 目的

本文定义 Core 与 Shell 边界上的标准协议对象与数据结构，确保：

1. Core 只消费归一化结果；
2. Shell 承担外部协议差异；
3. 跨层对象可版本化演进；
4. 审计与回放具有稳定结构。

---

## 2. 适用范围

本文仅覆盖 Core/Shell 边界协议，包含：

- Effect Request（Core 发起）；
- Effect Result（Shell 返回）；
- Action / ActionResult；
- Evidence；
- FailureSignal；
- ContextPacket；
- Review 请求/结果对象。

不包含：

- Core 内部状态机细节；
- Shell 内部 handler 实现；
- Provider SDK 私有字段；
- 工具具体实现。

---

## 3. 规范原则

1. **归一化**：provider/tool/sandbox 原始对象必须先归一化再越过边界。  
2. **语义中立**：边界对象表达事实与意图，不嵌入厂商私有语义。  
3. **可版本化**：协议对象应显式版本字段或具备向后兼容策略。  
4. **最小泄漏**：原始 messages、SDK error 对象不得直接暴露给 Core。

---

## 4. 边界对象（规范）

### 4.1 EffectRequest

Core 发给 Shell 的执行请求，最小包含：

- `kind`: 请求类型（如 planning/toolcall/replan/review）；
- `context`: 已构建的上下文包或引用；
- `constraints`: policy/budget/safety 约束。

### 4.2 EffectResult

Shell 返回给 Core 的归一化结果，最小包含：

- `ok`: 是否成功；
- `data`: 结构化成功载荷；
- `error`: 结构化错误（code/message/detail?）；
- `meta`: 扩展元信息（ref、usage、trace 等）。

### 4.3 Action 与 ActionResult

- `Action`: 可执行动作描述（name + input + on_fail）。
- `ActionResult`: 动作执行结果（ok/data/error/touchedPaths）。

### 4.4 Evidence

用于验证与修复决策的结构化证据，典型字段：

- `command`、`exitCode`、`ok`；
- `parsedErrors[]`（file/line/code/message）；
- `stdoutRef`、`stderrRef`。

### 4.5 ContextPacket

提供给 Planner/LLM 的固定分区上下文，包含：

- systemRules
- runGoal
- projectSnapshot
- milestone（可选）
- latestEvidence
- relevantCode
- changesSoFar
- memoryDecisions
- nextActionRequest

---

## 5. 错误与失败信号

错误对象应标准化：

- `code`: 稳定机器码（如 `PATCH_APPLY_FAILED`）；
- `message`: 人类可读摘要；
- `detail`: 可选引用（ref）或补充信息。

Core 的失败判定基于归一化结果与状态机规则，不依赖 provider 原始异常结构。

---

## 6. 引用与大文本外置

为避免上下文爆炸，边界协议建议：

1. 大文本（stdout/stderr/完整 patch/context）使用 `ref` 外置；
2. 协议中只保留摘要或截断预览；
3. 任何可追溯实体都应可通过 ref 回放。

---

## 7. 版本演进规则

1. 新增字段优先使用可选字段；
2. 删除字段需伴随主版本升级；
3. 语义变化必须更新文档并同步测试；
4. 跨层协议变更必须先定义再实现。

---

## 8. 合规检查清单

- Core 是否仍只消费归一化对象？
- Shell 是否屏蔽了 provider 私有结构？
- Evidence/Context 是否支持 ref 回放？
- 错误码是否稳定、可机器判定？
- 协议改动是否有版本说明与测试覆盖？

