# Core + Shell + Profile Architecture Specification

**Document ID**: AGENT-ARCH-SYSTEM-002  
**Title**: Core + Shell + Profile Overall Architecture Specification  
**Version**: 1.0.0  
**Status**: Draft  
**Audience**: Architects, engineers, reviewers, code generation tools  
**Language**: Chinese  
**Last Updated**: 2026-03-06

---

## 1. Purpose

This document defines the overall architecture of the agent system using the following model:

- Closed Core
- Effect Shell
- Profile-based Shell Configuration

The purpose of this document is to establish:

1. the top-level architectural decomposition;
2. the responsibility boundaries of Core, Shell, and Profile;
3. the direction of dependency and data flow;
4. the placement of LLM, tools, middleware, sandbox, and context engineering;
5. the architectural constraints that all subsequent design and implementation documents MUST follow.

This document is normative unless otherwise stated.

---

## 2. Scope

This document defines the **overall system architecture** only.

It covers:

- architecture layers and boundaries;
- runtime responsibility decomposition;
- control flow and data flow across layers;
- placement of major subsystems;
- profile binding model;
- shell capability model;
- architecture invariants.

It does **not** define in detail:

- Core internal state machine implementation;
- Agent Loop implementation details;
- task scheduling algorithm details;
- provider-specific API bindings;
- profile-specific capability catalogs;
- exact tool schemas.

Those topics are covered by separate documents.

---

## 3. Conformance Language

The key words **MUST**, **MUST NOT**, **SHOULD**, **SHOULD NOT**, and **MAY** in this document indicate requirement levels.

- **MUST / MUST NOT**: mandatory architectural rule.
- **SHOULD / SHOULD NOT**: recommended rule; deviation requires explicit justification.
- **MAY**: optional design choice.

---

## 4. Architectural Goal

The architecture is designed to achieve the following goals:

1. **Semantic closure**: runtime semantics remain inside the Core.
2. **Effect isolation**: all external side effects occur in the Shell.
3. **Scenario configurability**: application scenarios are modeled through Profile without polluting Core semantics.
4. **Provider independence at the Core boundary**: Core MUST NOT depend on LLM provider protocols.
5. **Capability modularity**: tools, LLM adapters, sandbox, middleware, and review bridges remain composable in the Shell.
6. **Auditability**: requests, results, evidence, and major transitions can be recorded and replayed.
7. **Long-term evolvability**: new profiles, new effect handlers, and new providers can be introduced without redefining Core semantics.

---

## 5. Top-Level Architecture

### 5.1 Architectural Decomposition

The system is decomposed into three primary layers:

1. **Core**
2. **Shell**
3. **Profile**

### 5.2 Layer Relationship

```text
+------------------------------+
|           Profile            |
|   scenario-specific config   |
+--------------+---------------+
               |
               v
+------------------------------+
|            Shell             |
|  effect handling and bridge  |
+--------------+---------------+
               ^
               |
+------------------------------+
|             Core             |
|   closed runtime semantics   |
+------------------------------+
```

### 5.3 Dependency Direction

The dependency direction MUST be interpreted as follows:

- Profile configures Shell.
- Shell serves Core.
- Core emits requests and consumes results.
- Core MUST NOT depend directly on Profile.
- Core MUST NOT depend directly on external capabilities.

---

## 6. Core Layer

### 6.1 Definition

The Core is the closed runtime kernel responsible for semantic control of the agent.

### 6.2 Responsibilities

The Core MUST:

- define state and transition semantics;
- define runtime objects such as Plan, Task, Action, Evidence, and Failure Signal;
- decide what should happen next in semantic terms;
- determine verification, repair, replan, done, and failed semantics;
- consume normalized results from the Shell.

### 6.3 Non-Responsibilities

The Core MUST NOT:

- call LLM providers directly;
- manage messages or prompts directly;
- own tool registries;
- own middleware pipelines;
- manage sandbox execution;
- depend on profile-defined external capability structures.

### 6.4 Core Output Model

The Core communicates outward through **Effect Request** objects.

### 6.5 Core Input Model

The Core consumes **Effect Result** objects returned by the Shell.

### 6.6 Core Design Constraint

The Core MUST remain valid and executable as a semantic state machine even if all provider-specific and tool-specific implementations are replaced.

---

## 7. Shell Layer

### 7.1 Definition

The Shell is the effect execution and integration layer responsible for turning Core requests into real-world work and turning raw outputs back into normalized results.

### 7.2 Responsibilities

The Shell MUST:

- accept effect requests from the Core;
- perform request routing;
- construct context packets;
- assemble provider-facing messages or other external inputs;
- invoke LLMs, tools, sandboxed executors, review systems, and external services;
- normalize outputs into effect results;
- manage capability-specific middleware;
- capture evidence and runtime traces.

### 7.3 Shell Subsystems

The Shell SHOULD be decomposed into the following subsystems:

1. Request Router
2. Context Engine
3. Middleware Pipeline
4. Effect Handlers
5. Capability Layer
6. Result Normalizer
7. Audit / Telemetry Bridge

### 7.4 Shell Design Constraint

The Shell MAY evolve independently in terms of effect implementation, but MUST preserve the Core-facing contracts.

---

## 8. Profile Layer

### 8.1 Definition

A Profile is a scenario-specific configuration package that shapes how the Shell behaves for a specific class of tasks or applications.

### 8.2 Responsibilities

A Profile MAY define:

- enabled handlers;
- action kind allowlists;
- capability bindings;
- context policies;
- validation presets;
- repair presets;
- sandbox policies;
- instruction assembly policy;
- external routing policy.

### 8.3 Architectural Constraint

A Profile MUST configure the Shell only.

A Profile MUST NOT:

- alter Core transitions;
- redefine done or failed;
- inject semantic shortcuts into the Core;
- redefine Core state objects.

### 8.4 Practical Interpretation

Profile is a **Shell assembly input**, not a **Core semantic dependency**.

---

## 9. Runtime Boundary Model

### 9.1 Boundary Principle

The Core/Shell boundary is the most important architectural boundary in the system.

### 9.2 Boundary Contract

The boundary MUST be defined in terms of:

- Effect Request
- Effect Result
- shared runtime protocol objects such as Action, Evidence, and Failure Signal

### 9.3 Boundary Rule

Provider-specific objects MUST NOT cross into the Core.

This includes, but is not limited to:

- message arrays;
- tool-calling protocol objects;
- model-specific response types;
- raw tool handles;
- sandbox session objects.

---

## 10. Effect Model

### 10.1 Definition

An **Effect** is any externally-executed activity needed to advance the run.

### 10.2 Typical Effect Types

Typical effect categories include:

- plan proposal;
- action proposal;
- action execution;
- review request;
- repair proposal;
- external observation or data retrieval.

### 10.3 Effect Request

An Effect Request is emitted by the Core when external work is required.

### 10.4 Effect Result

An Effect Result is returned by the Shell after handling an Effect Request.

### 10.5 Architectural Rule

The Core MUST reason in terms of effect requests and effect results, not in terms of provider-native API operations.

---

## 11. Placement of Major Concerns

### 11.1 LLM

LLMs belong to the Shell capability layer.

The Core MUST NOT directly own:

- model clients;
- provider configuration;
- message protocol logic;
- tool-calling protocol logic.

### 11.2 Message and Prompt Assembly

Message assembly and prompt construction belong to the Shell.

The Core MUST NOT treat prompt text or provider message arrays as first-class semantic objects.

### 11.3 Tool Execution

Tools belong to the Shell capability layer.

Tool execution MUST be mediated by Shell handlers and executors.

### 11.4 Middleware

Middleware belongs to the Shell.

Middleware MAY be used for:

- logging;
- metrics;
- safety checks;
- budget checks;
- request/result normalization;
- capability lifecycle wrapping.

Middleware MUST NOT redefine Core semantics.

### 11.5 Context Engineering

Context engineering belongs to the Shell.

It MUST happen before provider-specific message assembly.

### 11.6 Sandbox

Sandbox belongs to the Shell execution environment.

The Core MUST remain unaware of sandbox implementation details.

### 11.7 Human Review / External Review

Human review bridges belong to the Shell.

The Core MAY request review as an effect, but MUST NOT depend on a specific review transport or interface.

---

## 12. Shell Internal Decomposition

The Shell SHOULD be structured as follows.

### 12.1 Request Router

Receives effect requests and routes them to the correct handler.

### 12.2 Context Engine

Constructs phase-specific context packets from Core state, evidence, and runtime references.

### 12.3 Middleware Pipeline

Applies cross-cutting behavior to request handling and result handling.

### 12.4 Effect Handlers

Process concrete effect request categories.

Recommended handler types include:

- Plan Proposal Handler
- Action Proposal Handler
- Action Execution Handler
- Review Handler
- Repair/Replan Handler

### 12.5 Capability Layer

Owns and invokes concrete external capabilities.

Typical components include:

- LLM adapters
- tool executors
- sandbox manager
- file adapters
- command runners
- service adapters

### 12.6 Result Normalizer

Converts provider-native or executor-native output into standardized effect results.

### 12.7 Telemetry / Audit Bridge

Captures request, result, evidence, and runtime trace data for observability.

---

## 13. Profile-to-Shell Binding Model

### 13.1 Binding Principle

Profiles bind to the Shell, not to the Core.

### 13.2 What a Profile Configures

A Profile SHOULD be able to configure:

- which handlers are enabled;
- which capability adapters are available;
- which action kinds are allowed;
- how context is constructed for each phase;
- how safety policy is enforced in the Shell;
- which validation presets are used by Shell-provided helper layers;
- how repair requests are routed.

### 13.3 What a Profile MUST NOT Configure

A Profile MUST NOT configure:

- Core transitions;
- terminal state semantics;
- Core-owned verification semantics;
- core runtime object structure.

### 13.4 Example Binding Direction

```text
Profile
  -> configures handler bindings
  -> configures capability bindings
  -> configures context policy
  -> configures sandbox policy
  -> configures middleware selection

Shell
  -> applies the above during effect handling

Core
  -> remains unchanged
```

---

## 14. Data Flow

### 14.1 High-Level Flow

```text
Core State
  -> Core emits Effect Request
  -> Shell routes request
  -> Shell constructs context
  -> Shell invokes capabilities
  -> Shell normalizes outputs
  -> Shell returns Effect Result
  -> Core applies transition
```

### 14.2 LLM-Oriented Flow

```text
Core
  -> propose_actions request
  -> Shell Context Engine
  -> Shell Message Assembler
  -> LLM Adapter
  -> raw provider response
  -> Action Normalizer
  -> actions_proposed result
  -> Core
```

### 14.3 Tool Execution Flow

```text
Core
  -> execute_actions request
  -> Shell Action Execution Handler
  -> Tool Executor
  -> Sandbox / external execution environment
  -> raw execution outputs
  -> Result Normalizer
  -> actions_executed result
  -> Core
```

---

## 15. Control Flow Ownership

### 15.1 Core Control Ownership

The Core owns semantic control flow.

This includes:

- when a plan is needed;
- when actions are needed;
- when verification is applied;
- when repair is triggered;
- when replan is triggered;
- when the run is done or failed.

### 15.2 Shell Execution Ownership

The Shell owns effect realization.

This includes:

- how a request is fulfilled;
- which capability is used;
- how context is assembled;
- how raw outputs are normalized;
- how external execution is constrained.

### 15.3 Critical Rule

The Shell MAY influence how an effect is performed, but MUST NOT redefine why the Core requested it.

---

## 16. Architectural Invariants

The following invariants MUST hold.

### 16.1 Invariant A: Semantic Closure

All semantic control stays inside the Core.

### 16.2 Invariant B: Effect Isolation

All external side effects happen in the Shell.

### 16.3 Invariant C: Profile Non-Intrusion

Profiles configure Shell behavior only.

### 16.4 Invariant D: Protocol Normalization

All provider-native outputs MUST be normalized before entering the Core.

### 16.5 Invariant E: Boundary Stability

Changes to tools, LLM providers, sandbox implementations, or profile catalogs MUST NOT require redefining Core semantics.

### 16.6 Invariant F: Observability

Requests, results, evidence, and major transitions SHOULD remain auditable.

---

## 17. Prohibited Architectural Patterns

The following patterns are prohibited.

### 17.1 Injecting LLM into Core

The Core MUST NOT directly depend on model clients or provider objects.

### 17.2 Injecting Tool Registry into Core

The Core MUST NOT own an execution registry that ties semantics to concrete tools.

### 17.3 Injecting Middleware into Core Semantics

Middleware MUST NOT be used to override state transitions, verification outcomes, or terminal state semantics.

### 17.4 Letting Profile Rewrite Core Logic

Profiles MUST NOT define Core-only logic.

### 17.5 Allowing Provider Protocol Objects into Core

Tool-calling objects, raw message objects, and raw provider responses MUST NOT cross the Core boundary.

---

## 18. Recommended Interface Shape

The architecture SHOULD expose Core/Shell integration using request/result contracts.

### 18.1 Core to Shell

```ts
type EffectRequest =
  | { type: "propose_plan"; goal: string; context: CoreContext }
  | { type: "propose_actions"; taskId: string; context: CoreContext }
  | { type: "execute_actions"; taskId: string; actions: Action[] }
  | { type: "request_review"; review: ReviewRequest }
  | { type: "repair_plan"; reason: FailureSignal; context: CoreContext }
```

### 18.2 Shell to Core

```ts
type EffectResult =
  | { type: "plan_proposed"; plan: Plan }
  | { type: "actions_proposed"; taskId: string; actions: Action[] }
  | { type: "actions_executed"; taskId: string; results: ActionResult[]; evidence: Evidence[] }
  | { type: "review_received"; review: ReviewResult }
  | { type: "repair_applied"; patch: PlanPatch }
  | { type: "effect_failed"; error: AgentError }
```

These definitions are illustrative. Exact schemas are defined in implementation documents.

---

## 19. Implementation Guidance

### 19.1 Core Team Guidance

When implementing Core:

- focus on semantics and protocol shape;
- avoid importing provider or executor concepts;
- reason only in terms of normalized runtime objects.

### 19.2 Shell Team Guidance

When implementing Shell:

- keep provider-specific logic localized;
- normalize early at the boundary;
- keep middleware limited to effect-flow concerns;
- ensure context engineering remains separate from Core semantics.

### 19.3 Profile Authoring Guidance

When authoring profiles:

- think in terms of shell assembly;
- do not define new semantic terminal states;
- do not create profile-only interpretations of done or failed;
- prefer capability and policy binding rather than semantic branching.

---

## 20. Future Extension Model

The architecture is expected to support future extensions such as:

- additional profiles;
- new provider adapters;
- new sandbox implementations;
- new review bridges;
- richer context policies;
- additional capability middleware.

Such extensions MUST preserve the Core/Shell/Profile boundary model defined in this document.

---

## 21. Summary

This specification defines the canonical overall architecture of the system:

- **Core** is the closed semantic runtime kernel.
- **Shell** is the external effect execution and integration layer.
- **Profile** is the scenario-specific configuration layer that shapes the Shell.
- LLM, tool execution, middleware, context engineering, and sandbox all belong to the Shell side.
- The Core and Shell interact only through normalized request/result contracts.

All downstream design documents and implementations MUST preserve these boundary rules unless an explicit architectural exception is documented and approved.
