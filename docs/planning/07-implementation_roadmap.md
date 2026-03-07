# Implementation Roadmap and Module Delivery Plan

**Document ID**: AGENT-ARCH-ROADMAP-007  
**Title**: Implementation Roadmap and Module Delivery Plan  
**Version**: 1.0.0  
**Status**: Draft  
**Audience**: Architects, engineers, reviewers, code generation tools  
**Language**: Chinese  
**Last Updated**: 2026-03-07

---

## 1. Purpose

This document defines the implementation roadmap for rebuilding the agent system according to the documented target architecture.

Its purpose is to specify:

1. the implementation sequencing of the new architecture;
2. the module delivery order;
3. the migration strategy from the current repository state;
4. the acceptance criteria for each phase;
5. the engineering constraints for implementation and cleanup.

This document is normative unless otherwise stated.

---

## 2. Scope

This document covers the **implementation and migration plan** for the new architecture.

It includes:

- implementation phases;
- module delivery order;
- recommended repository restructuring;
- testing strategy by phase;
- migration and cleanup strategy;
- acceptance checkpoints;
- engineering risks and mitigation guidance.

It does **not** define:

- Core semantic rules beyond what is already defined in the architecture specifications;
- Shell internal logic beyond what is already defined in the Shell specification;
- provider-specific implementation details;
- product roadmap or feature roadmap outside the architecture rebuild.

---

## 3. Conformance Language

The key words **MUST**, **MUST NOT**, **SHOULD**, **SHOULD NOT**, and **MAY** in this document indicate requirement levels.

- **MUST / MUST NOT**: mandatory requirement.
- **SHOULD / SHOULD NOT**: recommended requirement; deviations require justification.
- **MAY**: optional behavior.

---

## 4. Implementation Goal

The implementation goal is to rebuild the runtime around the following stable target:

- a **Closed Core**;
- an **Effect Shell**;
- a **Profile-driven Shell Assembly**;
- a normalized **Core/Shell protocol boundary**;
- a phase-aware and testable **Agent Loop**.

The rebuild is not intended to preserve the existing implementation structure.  
It is intended to preserve the target architecture and its semantic boundaries.

---

## 5. Strategic Decision

### 5.1 Rebuild Strategy

The recommended strategy is:

## **Rebuild from the bottom up, guided by the architecture documents**

This means:

1. treat the existing implementation as reference material rather than as a mandatory foundation;
2. rebuild protocol and Core first;
3. attach Shell second;
4. attach Profile last;
5. remove legacy implementation only after the new path reaches minimum closure.

### 5.2 Why This Strategy

This strategy is chosen because:

- the current codebase does not fully match the documented target architecture;
- the project now has a clear architectural target;
- rebuilding from the lowest semantic layer improves system understanding;
- it is easier to enforce boundary discipline from the first line of new code than to untangle old code incrementally.

---

## 6. Roadmap Principles

The roadmap is based on the following principles:

1. **Protocol first**: stabilize boundary objects before feature work.
2. **Core before Shell**: semantic control must exist before external effects are attached.
3. **Tests define the floor**: every phase must introduce executable acceptance checks.
4. **Minimal closure first**: deliver the smallest runnable architecture loop before adding breadth.
5. **No semantic leakage**: provider/tool/sandbox complexity must stay out of Core.
6. **Delete late, not early**: delete legacy code only after replacement capability exists.
7. **Documentation-aligned implementation**: all code changes MUST align with the six architecture documents and AGENTS.md.

---

## 7. Target Repository Restructuring

The implementation SHOULD converge toward the following repository structure:

```text
/
  AGENTS.md
  README.md

  docs/
    architecture/
      01-agent_architecture_glossary.md
      02-core_shell_profile_architecture_spec.md
      03-core_internal_design_and_agent_loop_spec.md
      04-shell_internal_design_and_effect_handling_spec.md
      05-profile_design_and_assembly_spec.md
      06-core_shell_protocol_and_data_model_spec.md
    planning/
      07-implementation_roadmap.md

  src/
    protocol/
    core/
    shell/
    profiles/

  tests/
    protocol/
    core/
    shell/
    integration/
```

The exact naming MAY vary, but the separation of concerns MUST be preserved.

---

## 8. Phase Overview

The implementation is divided into seven phases:

1. **Phase 0 — Freeze and Prepare**
2. **Phase 1 — Protocol Foundation**
3. **Phase 2 — Core State Machine Foundation**
4. **Phase 3 — Minimal Closed Loop**
5. **Phase 4 — Shell Capability Expansion**
6. **Phase 5 — Profile Assembly**
7. **Phase 6 — Legacy Cleanup and Hardening**

Each phase has explicit outputs and acceptance criteria.

---

## 9. Phase 0 — Freeze and Prepare

### 9.1 Objective

Establish a safe starting point for the rebuild.

### 9.2 Required Actions

The team MUST:

1. preserve the current repository state as a reference point;
2. stop adding major new features to the legacy runtime;
3. establish the target directory layout;
4. place the architecture documents and AGENTS.md into their intended locations;
5. identify which existing tests are:
   - characterization tests;
   - reusable semantic tests;
   - legacy-only implementation tests.

### 9.3 Deliverables

- reference branch or tag for legacy runtime;
- documented target repository structure;
- initial empty or scaffolded directories for:
  - `src/protocol`
  - `src/core`
  - `src/shell`
  - `src/profiles`
  - `tests/protocol`
  - `tests/core`
  - `tests/shell`
  - `tests/integration`

### 9.4 Acceptance Criteria

Phase 0 is complete when:

- the current implementation is preserved as reference;
- the new architecture directories exist;
- no new architectural work is being added to the legacy runtime;
- the six architecture documents and AGENTS.md are available in-repo.

---

## 10. Phase 1 — Protocol Foundation

### 10.1 Objective

Implement the canonical Core/Shell boundary types and validation layer.

### 10.2 Scope

This phase MUST implement the normalized shared schemas for:

- `Plan`
- `Milestone`
- `Task`
- `SuccessCriterion`
- `Action`
- `ActionResult`
- `Evidence`
- `AgentError`
- `FailureSignal`
- `ContextPacket`
- `EffectRequest`
- `EffectResult`
- `PlanPatch`
- `ReviewRequest`
- `ReviewResult`

### 10.3 Required Outputs

The implementation SHOULD provide:

1. schema definitions;
2. serialization-safe type definitions;
3. request/result validators;
4. boundary normalizer interfaces;
5. protocol version constant or envelope support.

### 10.4 Testing Requirements

The team MUST add protocol tests for:

- schema validity;
- serialization safety;
- required field enforcement;
- boundary normalization rules;
- rejection of provider-native or non-serializable payloads.

### 10.5 Acceptance Criteria

Phase 1 is complete when:

- the protocol package builds independently;
- all boundary types are defined;
- validation exists for request/result objects;
- protocol tests pass.

---

## 11. Phase 2 — Core State Machine Foundation

### 11.1 Objective

Implement the minimum viable closed Core as a semantic state machine.

### 11.2 Scope

This phase MUST implement:

- `AgentState`;
- `RunStatus`;
- task selection and dispatch logic;
- task attempt accounting;
- transition engine;
- verification engine interface and minimal implementation;
- failure classification;
- recovery controller;
- event emission points.

### 11.3 Core Constraint

The Core implementation in this phase MUST remain free of:

- LLM clients;
- message objects;
- tool registries;
- middleware chains;
- sandbox objects;
- profile-specific branches.

### 11.4 Required Outputs

The implementation SHOULD provide:

1. pure state transition functions where possible;
2. a step function such as:
   - `step(state, input?) -> { state, request? }`;
3. deterministic task dispatch;
4. explicit terminal state handling.

### 11.5 Testing Requirements

The team MUST add Core tests for:

- initial planning request emission;
- valid plan attachment;
- next ready task selection;
- action proposal request emission;
- action execution request emission;
- task verification pass/fail transitions;
- retry / repair / replan routing;
- correct terminal handling of `done` and `failed`.

### 11.6 Acceptance Criteria

Phase 2 is complete when:

- the Core can step from state to request deterministically;
- the Core can consume normalized results;
- Core tests pass without importing any Shell/runtime integration code.

---

## 12. Phase 3 — Minimal Closed Loop

### 12.1 Objective

Create the smallest end-to-end runnable architecture loop using the new protocol and Core.

### 12.2 Scope

This phase SHOULD implement a minimal Shell capable of serving the Core in a controlled environment.

The first runnable loop SHOULD support:

- `propose_plan`
- `propose_actions`
- `execute_actions`

The implementation MAY begin with stubbed or deterministic handlers rather than full LLM integration.

### 12.3 Required Outputs

The implementation SHOULD provide:

1. minimal request router;
2. minimal effect handlers;
3. minimal result normalization path;
4. integration harness that loops:
   - Core emits request
   - Shell handles request
   - Core consumes result

### 12.4 Testing Requirements

The team MUST add integration tests proving:

- a run can progress from planning to execution;
- a task can complete and update state;
- milestone acceptance can be checked;
- `done` is only reached through goal acceptance;
- failure routing behaves as designed.

### 12.5 Acceptance Criteria

Phase 3 is complete when:

- the new runtime can complete a minimal run end-to-end;
- the runtime uses only normalized protocol objects across the boundary;
- the test suite demonstrates the canonical loop:
  - Plan -> Dispatch -> Execute -> Verify -> Repair

---

## 13. Phase 4 — Shell Capability Expansion

### 13.1 Objective

Expand the Shell into a proper effect-handling layer.

### 13.2 Scope

This phase SHOULD implement:

- Context Engine;
- Message Assembly Layer;
- LLM adapters;
- Action Execution Handler;
- Tool executors;
- Result Normalizer;
- middleware pipeline;
- sandbox integration.

### 13.3 Sequencing

The recommended sequencing is:

1. Context Engine
2. Message Assembly Layer
3. LLM adapters for proposal handlers
4. Tool execution and sandbox support
5. middleware and audit hooks
6. richer normalization and error handling

### 13.4 Testing Requirements

The team MUST add Shell tests for:

- request routing;
- context packet construction;
- provider input assembly;
- provider-native proposal normalization into `Action[]`;
- action execution normalization into `ActionResult[]` and `Evidence[]`;
- middleware governance behavior;
- sandbox execution constraints.

### 13.5 Acceptance Criteria

Phase 4 is complete when:

- the Shell can serve real or realistic effect requests;
- provider-native and executor-native outputs are fully normalized;
- Shell tests pass independently from legacy code.

---

## 14. Phase 5 — Profile Assembly

### 14.1 Objective

Implement Profile as a real shell-assembly system.

### 14.2 Scope

This phase SHOULD implement:

- Profile schema;
- Profile validation;
- Profile loader;
- Profile assembler;
- Shell assembly output;
- profile-controlled capability and policy binding.

### 14.3 Required Outputs

The implementation SHOULD provide:

1. at least one baseline profile;
2. declarative handler/capability binding;
3. context policy binding;
4. middleware selection binding;
5. sandbox policy binding.

### 14.4 Testing Requirements

The team MUST add tests for:

- profile validation success/failure;
- prohibited semantic intrusion rejection;
- correct handler and capability binding;
- profile-specific shell assembly behavior;
- preservation of Core invariants under different profiles.

### 14.5 Acceptance Criteria

Phase 5 is complete when:

- a Profile can assemble a Shell without altering Core semantics;
- at least one realistic scenario profile is functional;
- profile tests pass.

---

## 15. Phase 6 — Legacy Cleanup and Hardening

### 15.1 Objective

Retire legacy implementation paths and harden the new architecture.

### 15.2 Preconditions

Legacy cleanup MUST NOT begin until:

1. Phases 1 through 5 are complete;
2. the new runtime can complete representative runs;
3. boundary protocol tests pass;
4. Core, Shell, and Profile have independent test coverage.

### 15.3 Required Actions

The team SHOULD:

1. remove legacy runtime entry paths;
2. remove legacy type definitions that conflict with the new protocol;
3. replace legacy tests with:
   - new semantic tests;
   - new protocol tests;
   - new integration tests;
4. update README and developer docs;
5. harden validation and invariants;
6. remove dead code and adapters no longer used.

### 15.4 Acceptance Criteria

Phase 6 is complete when:

- the new architecture is the default runtime path;
- no production-relevant code depends on legacy runtime modules;
- legacy-only tests have been removed or rewritten;
- the repository reflects the new structure cleanly.

---

## 16. Testing Strategy

### 16.1 Testing Layers

The new implementation SHOULD maintain four test layers:

1. **Protocol tests**
2. **Core tests**
3. **Shell tests**
4. **Integration tests**

### 16.2 Protocol Tests

Validate schema shape, serialization, and boundary constraints.

### 16.3 Core Tests

Validate state transitions, lifecycle semantics, and recovery decisions.

### 16.4 Shell Tests

Validate routing, context construction, normalization, middleware, and sandbox behavior.

### 16.5 Integration Tests

Validate end-to-end runtime behavior through the Core/Shell boundary.

---

## 17. Minimum Semantic Test Set

Before broad feature work, the team MUST implement a minimum semantic test set that proves the following:

1. a run with no plan emits `propose_plan`;
2. a valid plan can be attached;
3. the next ready task is selected deterministically;
4. successful task verification records completion;
5. milestone acceptance is distinct from task success;
6. goal acceptance is distinct from milestone acceptance;
7. `done` is reached only after goal acceptance passes;
8. task failure does not automatically imply run failure;
9. retry / repair / replan are distinct recovery paths;
10. protocol normalization prevents raw provider-native objects from entering the Core.

This minimum test set defines the semantic floor of the rebuild.

---

## 18. Migration Strategy for Existing Tests

### 18.1 Characterization Tests

Legacy tests that describe current implementation behavior MAY be retained temporarily as characterization tests.

### 18.2 Semantic Rewrites

Any legacy test that expresses a valid architectural semantic SHOULD be rewritten against the new runtime.

### 18.3 Removal Rule

Legacy tests SHOULD be removed when:

- the behavior is legacy-only and undesired; or
- the semantic intent is already captured by the new test suite.

---

## 19. Engineering Risks and Mitigations

### 19.1 Risk: Reintroducing Old Architecture Through Convenience

During implementation, old concepts may be reintroduced for convenience.

#### Mitigation
Use AGENTS.md and architecture docs as hard review references.

### 19.2 Risk: Core Becomes Integration Layer Again

There is a risk that provider or tool logic leaks into Core during rapid implementation.

#### Mitigation
Keep protocol and Core tests separate from Shell tests.

### 19.3 Risk: Shell Redefines Semantics Implicitly

A permissive middleware or handler may begin to redefine success/failure or recovery logic.

#### Mitigation
Keep semantic assertions exclusively in Core tests and boundary contracts.

### 19.4 Risk: Overbuilding Before Minimal Closure

The team may implement too many adapters and policies before proving the minimal loop.

#### Mitigation
Do not move beyond Phase 3 until the minimal closed loop is stable.

### 19.5 Risk: Legacy Cleanup Too Early

Removing legacy code too soon may discard useful reference behavior.

#### Mitigation
Delete legacy code only after representative new-path tests are passing.

---

## 20. Milestone-Based Delivery View

The implementation SHOULD also be tracked through the following delivery milestones:

### Milestone A — Protocol Stabilized
Deliverables:
- protocol schemas
- validation
- protocol tests

### Milestone B — Core Runnable
Deliverables:
- state machine
- dispatcher
- recovery controller
- core tests

### Milestone C — Minimal End-to-End Loop
Deliverables:
- minimal shell
- minimal handlers
- integration tests

### Milestone D — Full Shell Foundation
Deliverables:
- context engine
- message assembly
- normalization
- tool execution
- middleware
- sandbox

### Milestone E — Profile Assembly
Deliverables:
- profile schema
- loader
- validator
- assembler
- at least one usable profile

### Milestone F — Legacy Removed
Deliverables:
- old runtime retired
- repository cleaned
- final docs aligned

---

## 21. Recommended Implementation Order Inside `src/`

Within the new source tree, the recommended implementation order is:

1. `src/protocol`
2. `src/core`
3. `src/shell`
4. `src/profiles`

The order MUST reflect the architecture dependency direction:

```text
protocol -> core -> shell -> profiles
```

The following order is prohibited:

```text
profiles -> core
shell provider logic -> core
tool runtime -> core
```

---

## 22. Code Review Guidance

Reviewers SHOULD reject changes that:

- introduce provider-native types into Core;
- allow raw tool-calling objects to cross the boundary;
- allow middleware to alter Core semantics;
- introduce profile branching into Core;
- redefine `done` or `failed`;
- bypass protocol validation for convenience.

Reviewers SHOULD favor changes that:

- strengthen layer separation;
- improve normalization clarity;
- make tests more semantic and less implementation-coupled;
- reduce ambiguity at the Core/Shell boundary.

---

## 23. Completion Definition

The architecture rebuild is considered complete when all of the following are true:

1. the new protocol is stable and validated;
2. the new Core is the sole semantic runtime;
3. the new Shell is the sole effect-serving layer;
4. Profile is a real shell-assembly system;
5. legacy runtime code is retired;
6. the repository structure matches the documented architecture;
7. the test suite is primarily organized by protocol, core, shell, and integration;
8. AGENTS.md and docs accurately describe the running system.

---

## 24. Summary

This roadmap defines the delivery sequence for rebuilding the project around the target architecture.

The required order is:

1. freeze and prepare;
2. build the protocol layer;
3. build the closed Core;
4. prove a minimal closed loop;
5. expand the Shell;
6. add real Profile assembly;
7. remove legacy code and harden the new runtime.

The most important implementation rule is:

> Rebuild semantics first, effects second, scenario assembly last.

All implementation work SHOULD be evaluated against this rule.
