# Profile 设计与装配规范

**文档 ID**: AGENT-ARCH-PROFILE-005  
**标题**: Profile 设计与装配规范  
**版本**: 1.1.0  
**状态**: Draft  
**受众**: 架构师、工程师、评审者、代码生成工具  
**语言**: 中文  
**更新时间**: 2026-03-07

---

## 1. 目的

本文定义 Profile 层的职责、可配置边界与装配方式，确保：

1. 场景能力由 Profile 组织；
2. Core 不被 workflow 细节污染；
3. 不同场景可并行演进且互不干扰。

---

## 2. Profile 的定位

Profile 是 **Shell 的装配输入**，不是 Core 的语义依赖。

Profile 主要负责：

- 选择并组合工具；
- 选择并组合 middleware；
- 设定 policy（allowed tools/commands、budgets）；
- 注入场景规则（例如 patch 工作流、人审策略）。

Profile 不负责：

- 定义 done/failed 语义；
- 改写 Core 状态迁移；
- 绕过 Core 验收门禁。

---

## 3. 设计原则

1. **单一职责**：一个 Profile 聚焦一个场景。  
2. **显式装配**：工具、策略、中间件必须在 Profile 中可见。  
3. **可审计**：关键策略（如人审、命令白名单）必须可追踪。  
4. **可替换**：新增场景通过新 Profile，而不是改 Core 默认逻辑。

---

## 4. 推荐结构

```text
src/profiles/
  <profile_name>.ts
```

Profile 工厂推荐输出：

- `CoreRunDeps`（registry、policy、middlewares、humanReview 等）
- 或更高层的 `run<ProfileName>(...)` 包装函数

---

## 5. 装配内容规范

### 5.1 Registry 装配

- 可以在 `baseRegistry` 上追加场景工具；
- 禁止在 Core 内强制注入场景工具名；
- 工具冲突应在装配阶段显式报错。

### 5.2 Middleware 装配

- middleware 顺序即执行顺序；
- 需要审计的门禁（如 HITL）应放在可观测位置；
- 不建议在 middleware 中隐式改变 Core 语义。

### 5.3 Policy 装配

- allowed_tools / allowed_commands 由 Profile 明确给出；
- budget 可按场景覆盖；
- 不得在 Core 默认 policy 中写入场景专用工具名。

### 5.4 Planner 规则注入

- 场景规则应通过 Profile 层（如 wrapProvider）注入；
- Core 默认 planner 保持通用，不绑定 workflow。

---

## 6. 与 HITL 的关系

Profile 可以决定是否启用 HITL middleware，以及：

- 哪些工具属于 patch apply gate；
- 哪些命令需要 command exec 人审；
- 拒绝时的行为（deny 或中断）。

这类策略属于 Profile，不属于 Core。

---

## 7. 版本与演进

Profile 演进建议：

1. 先新增 Profile，不直接破坏现有 Profile；
2. 变更 policy/tool/middleware 时同步文档；
3. 为关键场景提供最小 smoke 测试；
4. 明确声明该 Profile 的适用目标与限制。

---

## 8. 评审清单

- 是否有场景工具被硬编码进 Core？
- 是否所有场景规则都在 Profile 中显式声明？
- 是否 policy 与 middleware 组合可解释？
- 是否保留了 Core 的通用性与封闭语义？

