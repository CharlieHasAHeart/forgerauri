# Core Internal Design and Agent Loop Specification

**Document ID**: AGENT-ARCH-CORE-003  
**Title**: Core Internal Design and Agent Loop Specification  
**Version**: 1.0.0  
**Status**: Draft  
**Audience**: Architects, engineers, reviewers, code generation tools  
**Language**: Chinese  
**Last Updated**: 2026-03-06

---

## 1. Purpose

This document defines the internal design of the Core and the implementation model of the Agent Loop.

Its purpose is to specify:

1. the Core internal decomposition;
2. the Core runtime object model;
3. the state machine model of the agent loop;
4. the lifecycle of run, milestone, task, and action;
5. verification, repair, and replan semantics inside the Core;
6. the contract by which the Core emits effect requests and consumes effect results.

This document is normative unless otherwise stated.

---

## 2. Scope

This document covers the **Core only**.

It includes:

- Core internal responsibilities;
- Core-owned data models;
- state machine model;
- scheduling and dispatch semantics;
- task lifecycle;
- verification model;
- repair and replan semantics;
- event and audit points owned by the Core.

It does **not** define:

- Shell internal implementation;
- provider-specific message formats;
- tool or sandbox implementations;
- profile-specific capability catalogs;
- prompt wording or LLM-specific behavior.

---

## 3. Conformance Language

The key words **MUST**, **MUST NOT**, **SHOULD**, **SHOULD NOT**, and **MAY** in this document indicate requirement levels.

- **MUST / MUST NOT**: mandatory requirement.
- **SHOULD / SHOULD NOT**: recommended requirement; deviations require justification.
- **MAY**: optional behavior.

---

## 4. Core Design Goals

The Core is designed to satisfy the following goals:

1. **Semantic closure**: all runtime meaning is defined inside the Core.
2. **Deterministic control**: the Core decides lifecycle transitions deterministically from normalized inputs.
3. **Boundary stability**: provider and tool changes do not require redefining Core semantics.
4. **Recoverability**: failures can be classified and routed to retry, repair, or replan.
5. **Auditability**: major transitions and semantic decisions can be recorded.
6. **Implementation clarity**: scheduling, verification, and recovery are explicit modules rather than implicit prompt behavior.

---

## 5. Core Non-Goals

The Core does **not** attempt to:

- manage provider-native message protocols;
- execute tools or commands directly;
- own sandbox execution;
- host capability middleware;
- store prompt templates;
- implement scenario-specific profile rules directly.

---

## 6. Core Architectural Model

### 6.1 Core Nature

The Core is a **closed semantic state machine**.

### 6.2 Core Execution Model

The Core operates as a transition engine over:

- current state;
- normalized input results from the Shell;
- internal deterministic decision rules.

### 6.3 Core Interface Model

The Core has two outputs:

1. updated Core state;
2. an optional next Effect Request.

The Core has one input category:

- a normalized Effect Result.

### 6.4 Core Invariant

The Core MUST remain valid if every LLM, tool, sandbox, or external handler is replaced, as long as the request/result contracts are preserved.

---

## 7. Core Internal Decomposition

The Core SHOULD be decomposed into the following modules.

### 7.1 State Store

Owns the in-memory semantic snapshot of the run.

### 7.2 Transition Engine

Applies state transitions in response to effect results and internal control logic.

### 7.3 Planner State Logic

Owns plan attachment, plan versioning, and plan patch semantics.

### 7.4 Dispatcher

Selects the next ready task deterministically.

### 7.5 Task Lifecycle Manager

Owns task state changes, attempt counters, retry eligibility, and completion marking.

### 7.6 Verification Engine

Applies success criteria at task, milestone, and goal levels.

### 7.7 Failure Classifier

Maps normalized failure evidence to Core-level failure classes and signals.

### 7.8 Recovery Controller

Chooses between retry, repair, replan, and failure escalation.

### 7.9 Event Emitter

Emits semantic lifecycle events.

### 7.10 Audit Hooks

Records references to contexts, results, failures, and state snapshots for replay.

---

## 8. Core Data Model

### 8.1 RunStatus

```ts
type RunStatus =
  | "planning"
  | "dispatching"
  | "executing"
  | "verifying"
  | "repairing"
  | "done"
  | "failed"
```

#### Rules

- `done` MUST represent successful completion of the entire run only.
- `failed` MUST represent terminal inability to continue successfully.
- no local lifecycle stage may reuse `done` as a partial completion marker.

---

### 8.2 TaskStatus

```ts
type TaskStatus =
  | "pending"
  | "ready"
  | "executing"
  | "succeeded"
  | "failed"
  | "blocked"
```

#### Rules

- TaskStatus is local to task lifecycle reasoning.
- RunStatus and TaskStatus MUST remain distinct.

---

### 8.3 Plan

```ts
type Plan = {
  version: number
  milestones: Milestone[]
  goalAcceptance: SuccessCriterion[]
}
```

---

### 8.4 Milestone

```ts
type Milestone = {
  id: string
  title: string
  tasks: Task[]
  acceptance: SuccessCriterion[]
}
```

---

### 8.5 Task

```ts
type Task = {
  id: string
  title: string
  dependencies: string[]
  successCriteria: SuccessCriterion[]
}
```

---

### 8.6 Action

```ts
type Action = {
  id: string
  kind: string
  input: unknown
}
```

#### Rules

- Action is a normalized runtime abstraction.
- Action MUST NOT encode provider-native tool-calling structures.

---

### 8.7 Evidence

```ts
type Evidence = {
  id: string
  kind: string
  ref?: string
  data?: unknown
  summary?: string
}
```

---

### 8.8 AgentError

```ts
type AgentError = {
  kind: string
  message: string
  code?: string
}
```

---

### 8.9 FailureSignal

```ts
type FailureSignal = {
  class: "system" | "task"
  kind: string
  message: string
  fingerprint: string
}
```

---

### 8.10 AgentState

```ts
type AgentState = {
  goal: string
  status: RunStatus

  plan?: Plan
  planVersion?: number

  activeMilestoneId?: string
  currentTaskId?: string

  completedTaskIds: string[]
  taskAttempts: Record<string, number>

  toolLikeActions?: Action[]
  actionResults?: ActionResult[]

  latestEvidenceIds: string[]
  evidenceRefs: string[]

  lastError?: AgentError
  lastFailure?: FailureSignal
  lastResponseId?: string

  budgets: Budgets
}
```

#### Rules

- `completedTaskIds` MUST be the single source of truth for completed tasks.
- `currentTaskId` MUST identify at most one active task at any moment.
- `plan` and `planVersion` MUST be updated atomically.

---

### 8.11 Budgets

```ts
type Budgets = {
  maxTurns: number
  usedTurns: number
  maxRetriesPerTask: number
  maxReplans: number
  usedReplans: number
}
```

---

## 9. Core Request/Result Model

### 9.1 EffectRequest

Illustrative shape:

```ts
type EffectRequest =
  | { type: "propose_plan"; goal: string; context: CoreContext }
  | { type: "propose_actions"; taskId: string; context: CoreContext }
  | { type: "execute_actions"; taskId: string; actions: Action[] }
  | { type: "request_review"; review: ReviewRequest }
  | { type: "repair_plan"; reason: FailureSignal; context: CoreContext }
```

### 9.2 EffectResult

Illustrative shape:

```ts
type EffectResult =
  | { type: "plan_proposed"; plan: Plan }
  | { type: "actions_proposed"; taskId: string; actions: Action[] }
  | { type: "actions_executed"; taskId: string; results: ActionResult[]; evidence: Evidence[] }
  | { type: "review_received"; review: ReviewResult }
  | { type: "repair_applied"; patch: PlanPatch }
  | { type: "effect_failed"; error: AgentError }
```

### 9.3 Core Rule

The Core MUST only consume normalized EffectResult values.  
It MUST NOT consume provider-native messages, raw tool-calling objects, or sandbox-native execution records directly.

---

## 10. Agent Loop Model

### 10.1 Canonical Loop

The canonical loop implemented by the Core is:

**Plan -> Dispatch -> Execute -> Verify -> Repair**

### 10.2 Loop Semantics

- **Plan**: obtain or update a structured plan.
- **Dispatch**: choose the next executable task.
- **Execute**: request and execute normalized actions for a task.
- **Verify**: evaluate task, milestone, and goal criteria.
- **Repair**: recover locally or replan when needed.

### 10.3 Control Ownership

The Core owns:

- whether planning is needed;
- whether a task is ready;
- whether a result counts as success or failure;
- whether retry, repair, or replan should occur;
- whether the run is done or failed.

---

## 11. Run Lifecycle

### 11.1 Initial State

A run begins with:

- a goal;
- an empty or uninitialized plan;
- zero completed tasks;
- status = `planning`.

### 11.2 Terminal States

A run terminates in one of:

- `done`
- `failed`

### 11.3 Run-Level Pseudocode

```ts
function coreStep(state: AgentState, input?: EffectResult): CoreStepOutput {
  const nextState = transitionEngine.apply(state, input)

  if (nextState.status === "done" || nextState.status === "failed") {
    return { state: nextState }
  }

  const request = decideNextEffect(nextState)
  return { state: nextState, request }
}
```

### 11.4 Run-Level Decision Order

The Core SHOULD evaluate next-step needs in the following order:

1. no plan available -> request plan;
2. plan exists but no ready task and milestone not accepted -> verify or repair;
3. ready task exists and no pending action proposal -> request actions;
4. action proposal available but not executed -> request execution;
5. execution completed -> verify task;
6. all milestones passed and goal acceptance passed -> done;
7. unrecoverable condition -> failed.

---

## 12. Milestone Model

### 12.1 Milestone Role

Milestones define phase-level grouping and phase-level acceptance.

### 12.2 Milestone Activation

At any point in time, the Core SHOULD track at most one active milestone identifier for sequential milestone execution.

### 12.3 Milestone Completion

A milestone is not considered complete merely because all its tasks were attempted.

A milestone is complete only when:

1. all relevant tasks are completed; and
2. milestone acceptance passes.

### 12.4 Rule

Milestone completion MUST NOT directly set RunStatus to `done`.

---

## 13. Task Dispatch Model

### 13.1 Dispatcher Role

The Dispatcher selects the next ready task using deterministic logic.

### 13.2 Ready Task Definition

A task is considered ready when:

1. it belongs to the active milestone;
2. it is not already completed;
3. all dependencies are completed.

### 13.3 Blocked Condition

A milestone is blocked when:

- tasks remain incomplete;
- no incomplete task is ready.

### 13.4 Dispatcher Output

The Dispatcher MUST return one of:

- a ready task;
- no task because milestone task set is exhausted;
- blocked state.

### 13.5 Rule

Task dispatch MUST NOT rely on the LLM.

---

## 14. Task Lifecycle Model

### 14.1 Lifecycle Stages

```text
pending -> ready -> executing -> succeeded
                     |             ^
                     v             |
                   failed ---------
                     |
                     v
                   blocked
```

### 14.2 Task Start

When a task is selected, the Core MUST:

- set `currentTaskId`;
- increment or initialize its attempt state as needed;
- set run status to `executing`.

### 14.3 Task Success

A task is successful only when task-level verification passes.

### 14.4 Task Failure

A task failure does not automatically imply run failure.

Task failure MUST first be classified.

### 14.5 Task Completion Recording

On success, the Core MUST:

- add task id to `completedTaskIds`;
- clear or update current task context appropriately.

---

## 15. Task Attempt Model

### 15.1 Attempt Definition

A task attempt is one complete cycle of:

1. request action proposal;
2. receive proposed actions;
3. request action execution;
4. receive execution results and evidence;
5. verify task success criteria.

### 15.2 Attempt Boundaries

The Core MUST treat one proposal-execution-verification chain as one attempt.

### 15.3 Attempt Count

The Core MUST maintain per-task attempt counts.

### 15.4 Attempt Output

An attempt produces one of:

- success;
- task failure;
- system failure.

---

## 16. Verification Model

### 16.1 Verification Layers

The Core MUST apply verification at three levels:

1. Task Verification
2. Milestone Acceptance
3. Goal Acceptance

### 16.2 Separation Rule

These three verification levels MUST remain distinct.

No single verification result MUST be overloaded to mean all three.

### 16.3 Verification Inputs

Verification SHOULD use:

- action results;
- evidence;
- state;
- structured success criteria.

### 16.4 Verification Output

Verification MUST produce:

- `ok: boolean`
- failure list where applicable

### 16.5 Rule

The Core MUST decide semantic success from verification outputs.  
The Shell may help gather evidence, but MUST NOT define semantic success.

---

## 17. Failure Classification Model

### 17.1 Purpose

Failure classification exists to separate semantic task incompletion from runtime/system faults.

### 17.2 Minimum Classes

The Core MUST support at least:

- `system`
- `task`

### 17.3 System Failure

System failure indicates the machinery or contract is broken.

Examples:
- invalid normalized result;
- impossible state;
- missing active plan when plan is required;
- invalid plan patch;
- invariant violation.

### 17.4 Task Failure

Task failure indicates the machinery worked, but the task did not achieve its criteria.

Examples:
- expected file missing;
- command verification failed;
- content requirement not met.

### 17.5 Rule

Recovery decisions MUST depend on structured FailureSignal, not only on raw messages.

---

## 18. Recovery Model

### 18.1 Recovery Priority

The Core MUST prioritize recovery in the following order:

1. Retry
2. Repair
3. Replan
4. Fail

### 18.2 Retry

Retry SHOULD be used when:

- the failure is task-class;
- retry budget for the task remains;
- there is no invariant violation.

### 18.3 Repair

Repair SHOULD be used when:

- more evidence or a corrective local action may recover the task;
- the current plan is still structurally valid.

### 18.4 Replan

Replan SHOULD be used when:

- the plan lacks necessary tasks;
- milestone or goal acceptance cannot pass under the current structure;
- local repair is insufficient.

### 18.5 Terminal Failure

The Core MUST fail the run when:

- a system failure is unrecoverable;
- retry and repair are exhausted and replan is unavailable or invalid;
- replan budget is exhausted;
- a Core invariant is violated.

---

## 19. Plan Patch and Replan Semantics

### 19.1 Preferred Model

The Core SHOULD use **plan patch** semantics rather than full plan replacement.

### 19.2 Supported Patch Semantics

Recommended patch operations include:

- milestone add
- task add
- task remove
- task update
- task reorder

### 19.3 Replan Consistency Checks

After a patch is applied, the Core MUST verify:

1. `completedTaskIds` only contains tasks that still exist;
2. removed tasks are removed from completion state;
3. `activeMilestoneId` is still valid;
4. `currentTaskId` is still valid or is cleared;
5. plan version is incremented.

### 19.4 Invalid Replan

If any consistency check fails, the Core MUST treat the result as a system failure.

---

## 20. Core Transition Rules

### 20.1 Planning Transitions

- no plan available -> emit `propose_plan`
- valid plan received -> attach plan and move to dispatching

### 20.2 Dispatching Transitions

- ready task found -> move to executing path
- no ready task but milestone incomplete -> blocked/repair path
- no ready task and all milestones accepted -> goal verification path

### 20.3 Executing Transitions

- no action proposal available -> emit `propose_actions`
- actions proposed -> emit `execute_actions`
- actions executed -> move to verifying

### 20.4 Verifying Transitions

- task verification passes -> mark task complete and return to dispatching
- task verification fails -> classify failure and route to recovery
- milestone acceptance fails -> route to repair/replan
- goal acceptance passes -> done
- goal acceptance fails -> repair/replan or failed

### 20.5 Repairing Transitions

- retry allowed -> return to executing flow
- repair applied -> return to dispatching or executing as appropriate
- valid plan patch applied -> return to dispatching
- repair unavailable -> failed

---

## 21. Core Event Model

The Core SHOULD emit semantic events at major lifecycle points.

### 21.1 Recommended Events

```ts
type CoreEvent =
  | { type: "plan_attached"; version: number }
  | { type: "task_selected"; taskId: string }
  | { type: "task_succeeded"; taskId: string }
  | { type: "task_failed"; taskId: string; failure: FailureSignal }
  | { type: "milestone_verified"; milestoneId: string; ok: boolean }
  | { type: "goal_verified"; ok: boolean }
  | { type: "retry_scheduled"; taskId: string }
  | { type: "repair_requested"; reason: FailureSignal }
  | { type: "replan_requested"; reason: FailureSignal }
  | { type: "replan_applied"; newVersion: number }
  | { type: "done" }
  | { type: "failed"; error: AgentError }
```

### 21.2 Event Rule

Events MUST reflect semantic changes, not provider-native transport details.

---

## 22. Core Audit Points

The Core SHOULD record references for:

- plan versions;
- selected task identifiers;
- verification results;
- failure signals;
- repair and replan decisions;
- final terminal reason.

The Core MAY rely on the Shell to persist referenced artifacts, but Core-owned semantic decisions MUST remain traceable.

---

## 23. Reference Pseudocode

### 23.1 Core Step Function

```ts
function step(state: AgentState, input?: EffectResult): CoreStepOutput {
  const s1 = applyInput(state, input)

  if (isTerminal(s1)) {
    return { state: s1 }
  }

  const semanticDecision = decideNextSemanticMove(s1)

  switch (semanticDecision.type) {
    case "need_plan":
      return { state: s1, request: buildPlanRequest(s1) }

    case "need_actions":
      return { state: s1, request: buildActionProposalRequest(s1) }

    case "need_execution":
      return { state: s1, request: buildActionExecutionRequest(s1) }

    case "need_repair":
      return { state: s1, request: buildRepairRequest(s1) }

    case "done":
      return { state: { ...s1, status: "done" } }

    case "failed":
      return { state: { ...s1, status: "failed", lastError: semanticDecision.error } }
  }
}
```

### 23.2 Apply Input

```ts
function applyInput(state: AgentState, input?: EffectResult): AgentState {
  if (!input) return state

  switch (input.type) {
    case "plan_proposed":
      return attachPlan(state, input.plan)

    case "actions_proposed":
      return attachProposedActions(state, input.taskId, input.actions)

    case "actions_executed":
      return attachExecutionResults(state, input.taskId, input.results, input.evidence)

    case "repair_applied":
      return applyPlanPatch(state, input.patch)

    case "effect_failed":
      return attachEffectError(state, input.error)

    default:
      return state
  }
}
```

These pseudocode blocks are illustrative and do not replace the normative rules above.

---

## 24. Implementation Constraints

### 24.1 Core MUST NOT

- import provider-native message types into Core semantics;
- rely on tool names as semantic control signals unless normalized as Actions;
- allow middleware to alter transitions;
- store profile-specific runtime semantics.

### 24.2 Core SHOULD

- normalize all external inputs at the boundary;
- keep lifecycle phases explicit;
- keep verification deterministic where possible;
- prefer plan patch to plan replacement;
- keep task completion as a single-source-of-truth structure.

### 24.3 Core MAY

- expose a reducer-style API;
- expose an event log for replay;
- separate pure transition logic from mutable state containers.

---

## 25. Summary

This document defines the Core as a closed semantic state machine implementing a structured agent loop:

**Plan -> Dispatch -> Execute -> Verify -> Repair**

The Core owns:

- runtime semantics;
- task scheduling semantics;
- verification semantics;
- failure classification semantics;
- repair and replan semantics;
- terminal state semantics.

The Core does **not** own:

- provider message protocols;
- direct tool execution;
- sandbox operations;
- middleware execution;
- profile-specific runtime behavior.

All subsequent implementation work on the Core MUST preserve the state machine and boundary rules defined in this specification.
