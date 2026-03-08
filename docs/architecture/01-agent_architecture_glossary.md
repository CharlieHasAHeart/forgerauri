# Agent 架构术语规范

- 版本：1.2.0
- 状态：Draft
- 更新时间：yyyy-mm-dd

## 2. 目的

本文用于统一当前仓库中的架构术语，降低跨层沟通歧义。术语定义应尽量与现有代码一一对应，便于直接对照文件理解实现。本文不是路线图，不把未来能力写成既成事实。对于尚未落地但需要保留的概念，会明确标注为预留术语。

## 3. 适用范围

当前覆盖：protocol / core / shell / app / profiles 五层术语，以及 run / step / tick / task / action / effect / profile。

当前不覆盖：具体 prompt、厂商 API 私有字段、场景化 profile 细节、真实 action executor 的内部实现、repair / replan 细节。

## 4. 术语强度词

- 必须：强制要求，偏离即视为不符合规范。
- 禁止：明确不允许使用或表达。
- 应该：推荐做法，通常应遵循，除非有明确理由。
- 可以：可选做法，不影响规范一致性。

## 5. 分层总览（修正版）

1. Protocol：定义跨层共享的数据结构、类型守卫和边界对象。
2. Core：负责状态推进、step/tick 相关运行语义与核心纯逻辑。
3. Shell：负责 effect request/result 的边界桥接与最小执行闭环。
4. App：负责对外运行入口与调用编排封装。
5. Profile：负责运行方式约束（如默认步数、是否自动跑完、是否允许 shell 执行）。

## 6. 规范术语表

| 概念 | 规范术语 | 代码锚点 | 定义 |
|---|---|---|---|
| 分层 | Protocol | `src/protocol/index.ts` | 跨层共享协议对象与守卫的统一出口。 |
| 分层 | Core | `src/core/index.ts` | 运行语义与状态推进逻辑所在层。 |
| 分层 | Shell | `src/shell/index.ts` | effect 请求与结果的桥接和外层轮转层。 |
| 分层 | App | `src/app/index.ts` | 对外暴露运行入口的应用封装层。 |
| 分层 | Profile | `src/profiles/default-profile.ts` | 运行约束对象及默认策略定义。 |
| 协议对象 | AgentState | `src/protocol/agent-state.ts` | 一次 run 的标准化状态快照。 |
| 协议对象 | Plan | `src/protocol/plan.ts` | 任务与里程碑组织的计划对象。 |
| 协议对象 | Task | `src/protocol/task.ts` | 最小可调度、可检查执行单元。 |
| 协议对象 | Action | `src/protocol/action.ts` | 待执行动作的标准化表示。 |
| 协议对象 | ActionResult | `src/protocol/action-result.ts` | 单个动作执行结果的标准化表示。 |
| 协议对象 | EffectRequest | `src/protocol/effect-request.ts` | core 发往外层执行的标准化请求。 |
| 协议对象 | EffectResult | `src/protocol/effect-result.ts` | 外层执行回流给 core 的标准化结果。 |
| 运行语义 | Run | `src/core/run-core-agent.ts` | 整体运行生命周期语义，偏全局进程。 |
| 运行语义 | Step | `src/core/run-single-step.ts` | core 内的一次最小推进编排。 |
| 运行语义 | Tick | `src/core/run-runtime-tick.ts` | runtime 外层轮转单元，包裹 core 推进与 effect 吸收。 |
| 状态字段 | currentTaskId | `src/protocol/agent-state.ts` | 当前任务指针字段，用于标记当前推进目标 task。 |

## 预留术语

- Planner：预留术语，当前仓库未形成独立 planner 子系统，不应视为已落地模块。
- Middleware：预留术语，当前未实现可插拔中间件管线，不应映射到现有 shell 文件。
- Hook：预留术语，当前未提供稳定 hook 机制，不应当作扩展点规范。
- HITL：预留术语，当前未接入人工介入流程，不应在主流程语义中当作已实现能力。
- Repair：预留术语，当前主线未实现 repair 流程，不应与现有失败处理混用。
- Replan：预留术语，当前主线未实现 replan 流程，不应与 plan 更新逻辑混同。

## 8. 术语使用规则

- `run / step / tick` 必须按层级使用，不得混称同一概念。
- `payload` 统一表示主体数据，不翻译为“系统负载”。
- `profile` 当前默认指运行约束对象，不自动等同完整场景装配系统。
- `done` 只用于 run 终态表达，不随意指代局部任务完成。
- `effect request / effect result` 应用于跨层边界对象，不替代内部临时变量命名。

## 9. 常见误用与纠正

- 误用：把 shell 当成“真实 action executor 已完成”。纠正：当前 shell 仅有最小桥接与占位执行路径。
- 误用：把 profile 理解成只有 `maxSteps` 的参数对象。纠正：当前 profile 还包含 `autoRunToCompletion`、`allowShellExecution`、`enableReview` 等约束。
- 误用：把 tick 和 step 当成同一层概念。纠正：step 在 core 内，tick 在 runtime 外层。
- 误用：把 payload 机械翻译成“负载”。纠正：payload 在本项目语境下是边界对象的主体数据。
- 误用：把 `currentTaskId` 当作任务列表本身。纠正：它仅是状态中的当前任务指针。

## 10. 极简架构图

```text
External Caller
      |
      v
     App <------ Profile
      |
      v
    Shell
      |
      v
     Core
      ^
      |
   Protocol (共享)
```

## 11. 版本策略

- 新增术语时，先更新 glossary。
- glossary 更新后，再同步更新架构图文档。
- 文档稳定后，再更新实现注释与测试命名，保持术语一致。
