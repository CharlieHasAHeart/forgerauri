# Production Agent Roadmap

## 1. 项目定位与目标场景

当前项目本质上是一个 **agent runtime / core-shell-profile 架构仓库**。它已经落地了五层最小基线：`protocol` 负责标准化边界对象，`core` 负责最小状态推进，`shell` 负责最小 effect 执行桥接，`app` 负责入口封装，`profiles` 负责运行约束对象。

当前项目还不是一个生产级 agent，也不是一个已经完成场景固化的“桌面应用生成系统”。从代码和文档能确认的是：仓库已经形成了可测试的 agent runtime 基础，并且 Shell 主链路已经闭环到 `EffectRequest -> Action[] -> ActionResult[] -> EffectResult`。但它还没有形成真实执行器、真实场景 workflow、真实治理能力和完整恢复语义。

当前目标场景是：**生成固定技术栈的桌面应用程序的 agent**。这一点来自你的目标描述，而不是当前仓库中的完整场景契约。仓库里唯一比较明显的场景信号是项目名 `ForgeTauri`，但现有代码、profile、protocol、README 和架构文档并没有把“固定技术栈桌面应用生成”明确固化成 profile、capability binding、workflow contract、artifact contract 或 acceptance contract。因此，这个目标场景目前应被判断为：

- 目标方向已知；
- 架构基础已经具备；
- 但场景表达仍不完整，尚未在当前仓库中被清晰固化。

## 2. 当前距离生产级 agent 还有多远

当前阶段更准确的判断是：**pre-production runtime kernel / early integration stage**。结构上已经不是“从零搭骨架”，但语义完成度、执行能力和生产治理能力仍明显不足。现在更接近“结构已基本成型，语义与场景能力远未收口”，而不是“只差少量工程化”。

### runtime 完整性

当前已有 run/step/tick/shell loop 的最小闭环，也有 request preparation、result application、runtime gate、shell step tick/request 边界等结构化边界。这个层面已经具备可继续演进的骨架。但它仍停留在最小闭环：任务推进简单，终态语义极薄，持久化与恢复为空白，离生产级 runtime 还差一整层语义与可靠性强化。

### shell 执行能力

Shell 已经不是空壳，主路径清晰，而且 `execute_actions` 与 `run_review` 都有最小行为护栏。但当前 executor 仍是 placeholder boundary：没有 provider、没有 sandbox、没有真实 tool backend、没有上下文工程、没有 command policy 落地。因此它离“能跑生产任务”的距离非常远。

### profile 语义成熟度

Profile 当前更像 runtime constraint object。真正进入流程的只有 `maxSteps`、`autoRunToCompletion`、`allowShellExecution`，`enableReview` 只是被读取但不改变主线。距离“固定技术栈桌面应用生成”的 scenario profile 还差 capability binding、context policy、artifact contract、review routing、safety policy 等完整配置面。

### app 入口成熟度

`runAgent` 和 `runAgentWithProfile` 已经形成清晰入口，但它们仍是薄编排层，不是面向真实产品的入口层。当前没有任务输入协议、没有项目级 artifact 输出协议、没有持久化、没有 run history、没有 operator-facing diagnostics。

### protocol 稳定度

Protocol 对当前最小主线已经够用，而且共享对象目录相对完整，边界纪律也清楚。这是当前仓库最成熟的部分之一。但“协议已定义”不等于“协议已被主线路径消费”，特别是 `ReviewRequest/ReviewResult`、`Evidence`、`ContextPacket`、`PlanPatch` 仍主要是预留对象。

### 错误处理 / 失败语义

当前 failure path 已经有最小模板和状态推进，但语义仍然粗。缺少 failure taxonomy、retry budget、repair/replan 分层、fatal/non-fatal distinction、executor error normalization strategy。对生产级 agent 来说，这一层现在仍明显不足。

### review / HITL 能力

`run_review` 目前只是 accepted-only minimal builder path，不是完整 review orchestration。HITL 只存在于架构规范中，代码中没有真正落地。这个维度距离生产级仍然很远。

### 持久化 / 可恢复性

当前几乎没有持久化、checkpoint、resume、run journal、artifact ref、plan versioning、step replay。这意味着 runtime 还处于内存态原型阶段，距离生产可恢复系统存在明显断层。

### 可观测性 / tracing / 审计

当前测试覆盖能锁住行为，但系统内没有正式 tracing、structured events、audit trail、metrics 或 operator diagnostics。生产环境下这会直接阻碍问题定位、行为归因和治理。

### 桌面应用生成场景适配度

这一项目前最弱。当前仓库没有体现：

- 固定技术栈约束；
- 桌面应用 project scaffold contract；
- 文件生成/修改 artifact contract；
- UI/desktop capability policy；
- code review / build / package / validate workflow。

所以离“生产级桌面应用生成 agent”不是一步之遥，而是仍隔着完整的场景化层。

### 生产安全与治理能力

当前还没有真正的 capability governance、sandbox policy、budget policy、approval policy、artifact safety checks。对生产 agent 来说，这不是后期润色，而是硬门槛。

**结论**：当前仓库离生产级 agent 仍然较远，但不是“毫无基础”。它已经完成了最值得保留的部分：边界清晰、主线最小闭环、测试开始锁定编排行为。下一阶段不应继续把主要精力花在无限细拆结构上，而应转向语义收口、场景收口与执行治理。

## 3. 当前代码已经具备的能力与现状

### 3.1 Core

Core 已经形成较完整的最小 runtime step 边界：

- state preparation：`prepareRuntimeStepState(...)`
- request preparation：`prepareRuntimeStepRequest(...)`
- result application：`applyRuntimeStepResult(...)`
- tick orchestration：`runRuntimeTick(...)`
- continue gate：`canRunRuntimeStep(...)`

此外，Core 还具备：

- `runCoreAgent` / `runSingleStep` / `driveCoreRun` 的最小状态推进骨架；
- `selectNextTask` / `advanceToNextTask` 的 task 指针语义；
- `buildEffectRequest` / `applyEffectResult` / `runEffectCycle` 的最小 effect 边界闭环。

当前状态机语义是“可运行但极简”的状态。它更擅长表达当前闭环的结构一致性，而不是完整任务语义。当前成功与失败路径已存在，但 verify、repair、replan、goal acceptance 仍主要停留在文档规范层。

### 3.2 Shell

Shell 已具备以下执行边界：

- `extractActionsFromEffectRequest(...)`
- `executeActions(...)`
- `buildActionResult(...)`
- `buildEffectResultFromActionResults(...)`
- `buildRunReviewEffectResult(...)`
- `executeEffectRequest(...)`
- `prepareShellRuntimeStepTick(...)`
- `executeShellRuntimeRequest(...)`
- `runShellRuntimeStep(...)`
- `runShellRuntimeLoop(...)`

当前 Shell runtime step / loop 已能把上一轮 result 回流到下一轮 step，并且相关一致性已有测试锁定。限制也很明确：这仍是最小执行链路，不具备真实 provider、真实命令执行、真实 sandbox、真实上下文构造。

### 3.3 App

App 层当前有两类入口：

- `runAgent` / `runAgentStep` / `runAgentOnce` / `runAgentToCompletion`
- `runAgentWithProfile` / `runAgentWithDefaultProfile` / `runAgentToProfileCompletion`

这一层现在更像对 shell/runtime 主链路的薄包装，而不是正式应用入口。它的成熟度主要体现在入口一致性和参数归一化上，不体现在生产工作流承载能力上。

### 3.4 Profiles

Profile 当前真正生效的是：

- `maxSteps`
- `autoRunToCompletion`
- `allowShellExecution`

`enableReview` 目前只被读取，没有改变主流程。这意味着 profile 当前只是运行约束层，而不是场景装配层。它远不足以承载“固定技术栈桌面应用生成”场景，因为还没有：

- capability binding
- action/context policy
- artifact generation policy
- build/package/validate policy
- desktop-specific safety and review policy

### 3.5 Tests

当前测试覆盖已经清楚说明了几件事：

- core/runtime/shell/app 各层主线的一致性已开始被固定；
- request preparation、result application、step tick、loop continue gate、app/profile 入口都已有行为测试；
- `execute_actions` 主链路与 `run_review` 最小路径都有测试护栏；
- shared minimal fixtures 已把当前 runtime 最小输入契约显性化。

但当前测试还没有说明：

- 真实业务语义是正确的；
- 桌面应用生成任务能完成；
- 执行器与外部环境交互是可靠的；
- recovery / review / persistence / governance 可用于生产。

整体上，当前测试更多是在锁定**结构与编排行为**，而不是锁定**业务级 agent 语义**。

## 4. 当前代码的主要缺口

### 4.1 架构已具备但语义未收口的缺口

当前最大的缺口不是“没有架构”，而是“语义太薄”。run、task、review、repair、replan、goal acceptance 都还没有进入真正可用的生产语义层。如果不补，这个 runtime 只能证明边界清晰，不能证明 agent 会做对事。这是近期问题。

### 4.2 运行时可靠性缺口

缺少 checkpoint、resume、persistent state、run journal、idempotent replay、plan mutation discipline。没有这些，任何中断、异常或长流程都无法稳定恢复。这是中近期问题，且会很快卡住真实任务执行。

### 4.3 生产执行能力缺口

当前 Shell executor 只是最小 placeholder。没有真实 action backend、没有文件修改能力契约、没有 build/run/validate capability、没有 sandbox 和 resource policy。这会直接卡住“生成桌面应用”场景。这是近期问题。

### 4.4 Profile / Scenario 适配缺口

当前 profile 不能表达固定技术栈、项目结构模板、代码生成规范、验证工作流、artifact acceptance。没有这一层，就无法把通用 runtime 约束变成具体产品场景。这是近期到中期的关键问题。

### 4.5 Review / Approval / HITL 缺口

当前 review 只是最小 builder path，没有真正 review request orchestration、没有人工确认路径、没有 gating policy。对于生产级代码生成 agent，这一层会直接影响安全与质量。这是中期问题，但应尽早设计边界。

### 4.6 桌面应用生成专属能力缺口

这是最关键的场景缺口。当前仓库没有明确表达：

- 目标技术栈 contract；
- project scaffold / template contract；
- file patching contract；
- desktop packaging/build/test contract；
- generated app acceptance criteria。

如果不补，项目只能演进成“泛化 runtime 原型”，而不是“固定技术栈桌面应用生成 agent”。这是近期就应开始定义的问题。

### 4.7 工程治理缺口

缺少 structured logging、tracing、metrics、audit trail、budget limits、policy enforcement、safety guardrails。没有这些，系统不适合生产运行。这是中期问题，但需要在接入真实执行能力前同步规划。

### 4.8 文档与实现对齐缺口

大部分架构文档已对齐当前实现，但 planning 文档缺位，README 仍引用了一个当前不存在的 `docs/planning/07-implementation_roadmap.md`。如果不补，会导致新对话和新贡献者拿不到统一阶段判断。这是当前就应修复的问题，而这份 `roadmap.md` 正是在填这个缺口。

## 5. 从当前代码到生产级 agent 的路线图

### Phase 0：当前基线确认与结构冻结

**目标**：把现有 runtime/core/shell/profile/app 基线明确固定为“当前工作底座”，停止无边界细拆。

**为什么现在做**：当前结构已经足够清晰，继续优先抽边界的收益正在下降。需要先把“哪些部分已稳定、哪些部分尚未进入语义层”说清楚。

**应完成的能力**：

- 完成当前阶段 roadmap 与阶段判断文档；
- 明确哪些 boundary 已稳定；
- 形成“哪些模块暂不继续细拆”的共识；
- 明确桌面应用目标场景在仓库中尚未被固化的事实。

**这一阶段不该做**：

- 不开始大规模 provider/integration 实现；
- 不扩展新的 effect kind；
- 不在 profile 上过早堆配置项而没有真实消费路径。

**退出条件**：

- 结构基线与当前能力边界文档清楚；
- 新对话可以直接用 roadmap 作为上下文；
- 团队对“下一步进入语义和场景层”有统一判断。

### Phase 1：Core 语义收口

**目标**：让 Core 从“编排正确”走向“语义明确”，至少补齐 verify / task success / failure / retry / repair / replan 的最小有效规则。

**为什么现在做**：没有这一步，任何真实执行器接入都会把语义缺口放大成行为不稳定。

**应完成的能力**：

- task success / task failure 语义明确；
- terminal failure 条件明确；
- retry / repair / replan 至少有最小分层；
- review 进入 Core 语义模型的最小位置明确；
- effect result 对 state 的影响不再只是“成功清 task / 失败置 failed”。

**这一阶段不该做**：

- 不追求完整企业级恢复系统；
- 不引入复杂策略引擎；
- 不同时做多种场景 workflow。

**退出条件**：

- 关键状态迁移有明确语义测试；
- run 不再只是结构性推进；
- recovery 语义至少形成最小闭环。

### Phase 2：场景化 profile 与桌面应用约束接入

**目标**：把“固定技术栈桌面应用生成 agent”的场景，从口头目标变成代码和文档中的明确 contract。

**为什么现在做**：只有在 Core 语义基本收口后，profile/capability/workflow contract 才能稳定落位。

**应完成的能力**：

- 明确目标技术栈；
- 定义对应 profile；
- 定义 desktop app generation workflow contract；
- 定义 scaffold / file generation / validation / review 边界；
- 明确 artifact contract 与 acceptance criteria。

**这一阶段不该做**：

- 不把 profile 变成新的语义引擎；
- 不直接把 provider 私有协议写进 Core；
- 不把“支持任意技术栈”当目标。

**退出条件**：

- 场景 profile 已能表达固定技术栈约束；
- 生成任务的输入、输出、验证步骤有明确 contract；
- 文档中不再需要对目标场景做“尚未固化”的保留说明。

### Phase 3：生产执行与治理能力

**目标**：让 Shell 从最小桥接层进入可控执行层。

**为什么现在做**：场景 contract 已明确之后，才知道哪些 capability 真正值得接入。

**应完成的能力**：

- 真实 action executor；
- 文件/命令/build/test capability；
- sandbox or equivalent execution isolation；
- policy / budget / approval gating；
- result normalization hardening；
- 最小 tracing / audit / metrics。

**这一阶段不该做**：

- 不过早追求多 provider 泛化；
- 不引入和场景无关的大型平台抽象；
- 不把治理逻辑下沉到 Core。

**退出条件**：

- Shell 能执行真实桌面应用生成任务的关键能力；
- 关键风险路径有治理；
- 执行结果可追踪、可诊断。

### Phase 4：可恢复性与审计闭环

**目标**：让系统具备长流程运行、失败恢复、可回放与可审计能力。

**为什么现在做**：真实执行能力上线后，恢复与审计会变成生产门槛。

**应完成的能力**：

- checkpoint / resume；
- run journal；
- artifact ref / evidence strategy；
- structured event stream；
- traceable review / approval records。

**这一阶段不该做**：

- 不把恢复系统设计成新的业务层；
- 不让日志体系反向污染语义模型。

**退出条件**：

- 中断后可恢复；
- 关键决策链可审计；
- 关键产出物可回放和溯源。

### Phase 5：生产准备与场景验证

**目标**：从“工程上能跑”进入“对目标场景可用”。

**为什么现在做**：只有前面的语义、执行与治理都具备后，才值得做真实场景评估。

**应完成的能力**：

- 桌面应用生成端到端验证；
- 真实样例集；
- failure review；
- quality gates；
- operator 文档和默认运行路径。

**这一阶段不该做**：

- 不一边验证一边继续大规模重构 runtime 骨架；
- 不引入新的主要场景。

**退出条件**：

- 至少一条固定技术栈桌面应用生成路径可稳定重复；
- 关键失败模式有应对；
- 项目可以被称为“生产前候选”，而不是原型。

## 6. 近期优先级（接下来 5～10 步）

当前不建议继续以“结构再细拆”为主要节奏。现有 boundary 已经足够清楚，下一步应开始转向语义和场景收口。

建议的近期优先级：

1. 明确并文档化目标桌面应用技术栈 contract。如果仓库现在还不能证明具体技术栈，就先把“待明确项”显式列出来，而不是继续隐含。
2. 为 Core 补 task success / failed / retry / repair 的最小语义测试。现在结构测试很多，语义测试明显不够。
3. 把 `run_review` 从 accepted-only path 提升为至少有最小 request/result contract 的可消费路径，先补边界语义，不急着做复杂 orchestration。
4. 定义 Shell 真实执行能力的第一条窄路径。优先选一个与桌面应用生成直接相关的能力，例如文件修改或项目 scaffold，而不是泛化 provider 抽象。
5. 让 profile 真正驱动至少一条 shell policy，而不只是步数和开关。否则 profile 还停留在参数对象阶段。
6. 为 artifact / evidence / context 补第一版最小 contract，哪怕只服务于固定场景，也比继续停留在预留对象更有价值。
7. 引入最小运行日志 / tracing 结构，至少能还原 step、request、result 和 failure path。
8. 做一次“默认运行路径复盘”。如果完成以上几步后主线仍然清晰，再决定是否需要第二轮结构整理。

重新复盘项目的合适节点是：**当固定技术栈场景 contract 被第一次写清楚，并且第一条真实执行能力接入完成之后**。在那之前，继续做纯结构抽离的收益会明显下降。

## 7. 对后续对话/实现的指导原则

1. 优先从“结构收口”切换到“语义收口”。当前最小边界已经足够多，后续新增结构抽离必须证明自己能降低语义复杂度，而不是仅仅让文件更细。
2. 继续坚持小步推进，但小步的目标应更偏向可用语义、场景 contract 和执行能力，而不是重复边界拆分。
3. `core`、`shell`、`profile` 当前都不应再无理由继续细拆。除非某段逻辑已经成为清晰、稳定、可复用的边界，否则优先增强现有边界的语义。
4. 一旦开始实现真实桌面应用生成能力，就必须同步更新文档，尤其是 profile、protocol 和 shell boundary 文档。否则新对话会重新把系统误判成“纯 runtime 原型”。
5. 任何涉及新 effect kind、新 artifact contract、新 review semantics、新 profile capability binding 的改动，都应先明确它属于哪一层，再动代码。
6. 如果出现以下任一情况，应重新做一次全项目复盘：
   - 第一个固定技术栈 profile 落地；
   - 第一个真实执行能力落地；
   - review / repair / replan 语义进入主线路径；
   - 持久化与恢复开始进入实现。

当前最应该守住的一条原则是：**不要把“生产级 agent 还差很远”误解成“继续抽结构就会更接近生产”**。现在真正缺的是语义、场景和治理。
