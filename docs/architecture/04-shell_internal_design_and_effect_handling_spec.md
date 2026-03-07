# Shell 内部设计与效应处理规范

**文档 ID**: AGENT-ARCH-SHELL-004  
**标题**: Shell 内部设计与效应处理规范  
**版本**: 1.1.0  
**状态**: Draft  
**受众**: 架构师、工程师、评审者、代码生成工具  
**语言**: 中文  
**更新时间**: 2026-03-07

---

## 1. 目的

本文定义 Shell 层的内部职责与效应处理流程，确保：

1. Core 请求能被稳定执行；
2. provider/tool/sandbox 差异被 Shell 吸收；
3. 返回给 Core 的结果保持归一化与可审计。

---

## 2. Shell 职责边界

Shell 必须负责：

- 接收 Core 的 effect 请求；
- 组装上下文与 provider 输入；
- 执行工具、命令与外部调用；
- 执行 middleware 管线；
- 归一化结果并回传 Core；
- 记录 evidence 与执行轨迹。

Shell 不应负责：

- Core 状态机语义定义；
- done/failed 判定规则；
- 里程碑与全局验收语义本身。

---

## 3. 内部分解建议

1. **Request Router**：按 effect kind 路由到处理器。  
2. **Context Builder/Engine**：构建阶段化上下文。  
3. **Provider Bridge**：LLM 交互与 JSON 结构化输出。  
4. **Tool Executor**：工具调用与输入输出校验。  
5. **Middleware Pipeline**：拦截、增强、门禁、审计。  
6. **Result Normalizer**：把原始输出转换为边界协议对象。  
7. **Telemetry Bridge**：记录审计事件与引用。

---

## 4. 效应处理生命周期

### 4.1 接收请求

- 输入：Core 发出的当前阶段请求（planning/toolcall/replan/review）。

### 4.2 构建上下文

- 构建 ContextPacket；
- 注入最新 evidence 与关键代码片段；
- 对大文本使用 ref/blob 外置。

### 4.3 执行外部能力

- 通过 provider 调用 LLM；
- 执行工具动作；
- 必要时进入沙箱命令执行。

### 4.4 middleware 处理

典型拦截点：

- `init`：运行时包装（如 runCmdImpl）；
- `wrapProvider`：注入系统规则；
- `onBeforeToolCall`：执行前门禁/改写；
- `onToolResult`：结果后处理；
- `onPatchPathsChanged`：补丁路径观测。

### 4.5 归一化与返回

- 统一生成 `ok/data/error/meta` 结构；
- 返回 Core 可直接消费的结果对象。

---

## 5. 命令执行与安全

Shell 在命令执行上应满足：

1. 服从 allowed commands policy；
2. 在需要时经过 HITL 审批；
3. 标准化退出码与 stderr/stdout；
4. 对高风险命令有明确拒绝策略。

---

## 6. 证据与可观测性

每次关键执行建议产出：

- 结构化 evidence（exitCode、parsedErrors 等）；
- 大文本输出 ref（stdoutRef/stderrRef）；
- 工具调用输入摘要与结果摘要；
- context packet ref。

目标：支持“失败复现”和“决策回放”。

---

## 7. 与 Profile 的协作

Shell 行为由 Profile 装配决定，例如：

- 启用哪些工具；
- middleware 顺序；
- 人审规则（patchTools、commandAllowlist）；
- 场景化 provider 规则。

Shell 不应在内部硬编码某一业务 workflow。

---

## 8. 实施建议

1. 先定义统一协议，再实现 handler。  
2. 避免将 provider 私有结构直接上抛给 Core。  
3. middleware 仅做机制增强，语义判断留在 Core。  
4. 先保证可审计，再优化性能。

