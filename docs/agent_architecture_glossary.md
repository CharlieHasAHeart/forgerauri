# Glossary and Terminology Specification

**Document ID**: AGENT-ARCH-GLOSSARY-001  
**Title**: Agent Architecture Terminology Specification  
**Version**: 1.0.0  
**Status**: Draft  
**Audience**: Architects, engineers, reviewers, code generation tools  
**Language**: Chinese  
**Last Updated**: 2026-03-06

---

## 1. Purpose

This document standardizes the terminology used in the agent architecture and implementation documents.  
Its purpose is to ensure that:

1. team members use the same words with the same meanings;
2. architecture documents, design reviews, and implementation plans remain consistent;
3. code generation tools can map business intent to correct technical structures;
4. cross-layer concepts are not mixed together.

This document is normative unless otherwise stated.

---

## 2. Scope

This document covers terminology for the following topics:

- closed core architecture;
- effect shell architecture;
- profile-based runtime assembly;
- agent loop implementation;
- state, action, evidence, verification, repair, and replan;
- LLM interaction, tool execution, middleware, sandbox, and context engineering.

This document does **not** define:

- product-level business requirements;
- prompt wording details;
- provider-specific API contracts;
- profile-specific behavior catalogs.

---

## 3. Conformance Language

The key words **MUST**, **MUST NOT**, **SHOULD**, **SHOULD NOT**, and **MAY** in this document are to be interpreted as requirement levels.

- **MUST / MUST NOT**: mandatory requirement.
- **SHOULD / SHOULD NOT**: recommended requirement, deviations require justification.
- **MAY**: optional behavior.

---

## 4. Architectural Principles

The terminology in this document is based on the following architectural principles:

1. The **Core** is a **Closed Core**.
2. The **Shell** is an **Effect Shell**.
3. The **Profile** configures the Shell and MUST NOT alter Core semantics directly.
4. LLM, tool, middleware, sandbox, and provider-specific protocols belong to the Shell side.
5. The Core operates on state, transitions, and standardized protocol objects only.

---

## 5. Layer Model

The architecture is divided into three conceptual layers.

### 5.1 Core Layer

The Core layer defines and executes runtime semantics.

### 5.2 Shell Layer

The Shell layer executes external effects and bridges the Core to the outside world.

### 5.3 Profile Layer

The Profile layer configures the Shell for a specific application scenario.

---

## 6. Normative Terminology

### 6.1 Agent

**Definition**  
A runtime system that can pursue a goal through multiple steps, maintain internal state, request external effects, consume results, and advance toward completion or failure.

**Notes**  
In this project, an Agent is not equivalent to an LLM session. It is the composite of Core, Shell, Profile, and external capabilities.

**Layer**  
System-level concept.

---

### 6.2 Core

**Definition**  
The closed runtime kernel responsible for defining and executing internal agent semantics.

**The Core MUST**
- define state and state transitions;
- define runtime protocol objects such as plan, task, action, evidence, and result;
- decide what effect is needed next;
- consume normalized effect results;
- determine verify, repair, replan, done, and failed semantics.

**The Core MUST NOT**
- call an LLM directly;
- call tools directly;
- manage provider message formats directly;
- host middleware that changes core semantics;
- manage sandbox execution directly.

**Layer**  
Core.

---

### 6.3 Closed Core

**Definition**  
An architectural property in which the Core does not accept external capability injection that changes runtime semantics.

**Implication**  
LLM, tools, middleware, sandbox, and profile configuration MUST NOT be modeled as pluggable semantic dependencies of the Core.

**Layer**  
Core principle.

---

### 6.4 Shell

**Definition**  
The effect execution layer that receives requests from the Core, interacts with external systems, and returns normalized results.

**The Shell MUST**
- receive effect requests from the Core;
- perform context construction;
- assemble provider-facing inputs such as messages;
- call LLMs, tools, sandboxed executors, and other external capabilities;
- normalize raw outputs into effect results consumable by the Core.

**The Shell MUST NOT**
- redefine the Core's state semantics;
- redefine done or failed semantics;
- silently replace verification outcomes decided by the Core.

**Layer**  
Shell.

---

### 6.5 Effect Shell

**Definition**  
A Shell designed specifically around effect requests and effect results.

**Notes**  
The term emphasizes that the Shell is the place where external side effects happen.

**Layer**  
Shell principle.

---

### 6.6 Profile

**Definition**  
A scenario-specific configuration package that shapes how the Shell behaves for a given domain or application mode.

**A Profile MAY define**
- handler bindings;
- allowed action kinds;
- context policies;
- validation presets;
- repair presets;
- sandbox policies;
- capability bindings.

**A Profile MUST NOT**
- alter Core state transition semantics directly;
- define Core-only concepts such as done, failed, or transition logic.

**Layer**  
Profile.

---

### 6.7 State

**Definition**  
The complete internal runtime snapshot used by the Core at a given moment.

**Typical Contents**
- goal;
- run status;
- plan and plan version;
- active milestone and current task;
- completed task identifiers;
- last error;
- current budgets;
- recent evidence references.

**Layer**  
Core.

---

### 6.8 State Machine

**Definition**  
The formal control model that governs how the Core transitions from one state to another.

**Notes**  
This is the primary implementation model of the Core.

**Layer**  
Core.

---

### 6.9 Transition

**Definition**  
A state change applied by the Core in response to an input result or internal decision.

**Examples**
- planning -> dispatching
- executing -> verifying
- repairing -> dispatching
- verifying -> done

**Requirement**  
A transition MUST be determined by the Core. It MUST NOT be silently introduced by a tool, middleware, or provider adapter.

**Layer**  
Core.

---

### 6.10 Run

**Definition**  
A complete execution lifecycle of the agent from start input to terminal state.

**Terminal States**
- done
- failed

**Layer**  
Core.

---

### 6.11 Plan

**Definition**  
A structured representation of the overall execution strategy for a run.

**Typical Fields**
- version
- milestones
- goal acceptance

**Requirement**  
A Plan SHOULD be structured data and MUST NOT be treated as an informal text memo.

**Layer**  
Core.

---

### 6.12 Milestone

**Definition**  
A stage-level grouping of tasks within a plan.

**Typical Role**
- represent a phase boundary;
- provide milestone-level acceptance checks.

**Layer**  
Core.

---

### 6.13 Task

**Definition**  
The smallest schedulable unit of work in the agent loop.

**A Task SHOULD**
- have a clear objective;
- have explicit dependencies where applicable;
- define success criteria;
- be retryable or repairable.

**Layer**  
Core.

---

### 6.14 Action

**Definition**  
The standardized unit of executable intent recognized by both Core and Shell.

**Notes**
- An Action is not the same thing as a provider-native tool-call object.
- An Action is a cross-layer runtime abstraction.

**Examples**
- read_file
- write_file
- apply_patch
- run_command

**Layer**  
Core/Shell boundary.

---

### 6.15 Action Proposal

**Definition**  
A candidate set of actions proposed for a task.

**Notes**
- It expresses what should be executed next.
- It does not indicate that execution has already happened.

**Typical Source**
- generated in the Shell, often using an LLM.

**Layer**  
Core/Shell boundary.

---

### 6.16 Action Result

**Definition**  
The standardized result of executing an action.

**Typical Contents**
- success or failure;
- outputs;
- touched paths;
- evidence references;
- structured error.

**Layer**  
Core/Shell boundary.

---

### 6.17 Evidence

**Definition**  
Any factual artifact that can be used for verification, diagnosis, or audit.

**Examples**
- stdout/stderr;
- generated file content;
- command exit code;
- tool output reference;
- artifact metadata.

**Layer**  
Core/Shell boundary, consumed by Core.

---

### 6.18 Verify

**Definition**  
The process of determining whether a task, milestone, or goal has been satisfied.

**Requirement**
- verification SHOULD be deterministic where possible;
- verification MUST NOT rely solely on an LLM declaring completion.

**Layer**  
Core.

---

### 6.19 Success Criterion

**Definition**  
A structured rule used by the Core to evaluate whether a target condition has been met.

**Common Forms**
- tool result expectation;
- file existence;
- file content containment;
- command success.

**Layer**  
Core.

---

### 6.20 Acceptance

**Definition**  
A higher-level verification rule applied at the milestone or goal level.

**Layer**  
Core.

---

### 6.21 Repair

**Definition**  
A local recovery process that attempts to recover from failure without replacing the entire plan.

**Typical Forms**
- retry current task;
- append a corrective action;
- introduce a repair task;
- request additional evidence.

**Layer**  
Core semantic concept; executed through Shell effects.

---

### 6.22 Replan

**Definition**  
A plan adjustment process used when the current plan is insufficient to complete the run.

**Preferred Form**
- plan patch;
- task-level additions, removals, updates, or reorderings.

**Requirement**
- replan SHOULD prefer patch semantics over whole-plan replacement.

**Layer**  
Core semantic concept; may require Shell assistance.

---

### 6.23 Done

**Definition**  
The terminal state indicating that the global goal has passed final acceptance.

**Requirement**
- done MUST represent full run completion only;
- done MUST NOT be used for task completion;
- done MUST NOT be used for milestone completion.

**Layer**  
Core.

---

### 6.24 Failed

**Definition**  
The terminal state indicating that the run cannot continue successfully or can no longer satisfy its goal.

**Layer**  
Core.

---

## 7. Shell-Side Terminology

### 7.1 Effect

**Definition**  
Any externally-executed behavior required to advance the run.

**Examples**
- ask an LLM for a plan;
- ask an LLM for actions;
- execute a tool;
- run a command;
- request human review.

**Layer**  
Shell.

---

### 7.2 Effect Request

**Definition**  
A standardized request emitted by the Core to ask the Shell for an external result.

**Examples**
- propose_plan
- propose_actions
- execute_actions
- request_review
- repair_plan

**Layer**  
Core/Shell boundary.

---

### 7.3 Effect Result

**Definition**  
A standardized result returned by the Shell to the Core after an external effect is handled.

**Examples**
- plan_proposed
- actions_proposed
- actions_executed
- review_received
- repair_applied

**Layer**  
Core/Shell boundary.

---

### 7.4 Effect Handler

**Definition**  
A Shell-side module responsible for processing a specific kind of effect request.

**Examples**
- plan proposal handler;
- action proposal handler;
- action execution handler;
- review handler.

**Layer**  
Shell.

---

### 7.5 Capability Layer

**Definition**  
The part of the Shell that actually owns and invokes external capabilities.

**Typical Capabilities**
- LLM adapters;
- tool executors;
- sandbox manager;
- external service adapters.

**Layer**  
Shell.

---

### 7.6 Result Normalizer

**Definition**  
A Shell-side component that converts raw external outputs into standardized effect results.

**Layer**  
Shell.

---

## 8. LLM and Provider Terminology

### 8.1 LLM

**Definition**  
An external language model used for producing plans, action proposals, review interpretations, or repair suggestions.

**Requirement**
- the LLM belongs to the Shell-side capability layer;
- the Core MUST NOT depend on provider-specific LLM contracts.

**Layer**  
Shell.

---

### 8.2 Message

**Definition**  
A provider-facing message object used to communicate with an LLM.

**Notes**
- message is a transport/protocol object;
- message is not a Core runtime object.

**Layer**  
Shell/provider protocol.

---

### 8.3 Message Assembler

**Definition**  
A Shell-side component that renders a structured context packet into provider-specific messages.

**Layer**  
Shell.

---

### 8.4 Prompt

**Definition**  
The textual or structured instruction content used to guide an LLM for a specific request.

**Requirement**
- prompts belong to the Shell;
- the Core MUST NOT use prompt text as a first-class semantic object.

**Layer**  
Shell.

---

### 8.5 Tool-Calling

**Definition**  
A provider-specific structured output protocol in which the LLM emits tool invocation proposals.

**Requirement**
- tool-calling MUST be treated as a Shell-internal mechanism;
- at the Core boundary, tool-calling MUST be normalized into Action Proposal data.

**Layer**  
Shell/provider protocol.

---

## 9. Context Engineering Terminology

### 9.1 Context Engineering

**Definition**  
The process of selecting, filtering, compressing, and structuring relevant information for a specific effect request.

**Requirement**
- context engineering belongs to the Shell;
- it MUST occur before message assembly;
- it SHOULD be phase-aware.

**Layer**  
Shell.

---

### 9.2 Context Engine

**Definition**  
The Shell-side subsystem responsible for context engineering.

**Responsibilities**
- select relevant state;
- select relevant evidence;
- compress large content;
- structure context by phase.

**Layer**  
Shell.

---

### 9.3 Context Packet

**Definition**  
A structured context object produced by the Context Engine for downstream use.

**Uses**
- message assembly;
- audit storage;
- replay;
- review;
- repair support.

**Layer**  
Shell/Core boundary object, produced by Shell.

---

### 9.4 Context Phase

**Definition**  
The runtime phase for which a context packet is being constructed.

**Typical Phases**
- planning
- action_proposal
- review
- repair

**Layer**  
Shell.

---

## 10. Tool, Middleware, and Sandbox Terminology

### 10.1 Tool

**Definition**  
An external executable capability used by the Shell to realize an Action.

**Examples**
- file read/write executor;
- patch executor;
- command runner;
- network access adapter.

**Requirement**
- tools belong to the Shell capability layer;
- the Core MUST NOT own a tool registry as part of its semantic model.

**Layer**  
Shell.

---

### 10.2 Tool Executor

**Definition**  
A Shell-side component that maps normalized Actions to concrete tool execution.

**Layer**  
Shell.

---

### 10.3 Middleware

**Definition**  
A Shell-side cross-cutting processing layer applied to effect flow.

**Appropriate Uses**
- logging;
- tracing;
- metrics;
- budget checks;
- safety checks;
- permission checks;
- error normalization;
- result enrichment.

**Prohibited Uses**
- redefining Core transitions;
- redefining done or failed;
- silently overriding verification semantics;
- introducing hidden retry or replan semantics.

**Layer**  
Shell.

---

### 10.4 Capability Middleware

**Definition**  
A broader form of middleware, inspired by systems such as deepagents, that may package tools, prompt injection, lifecycle wrapping, and state extension together.

**Note**
This term is descriptive. It refers to a style of runtime module, not to the recommended closed-core semantic boundary.

**Layer**  
Shell/runtime assembly concept.

---

### 10.5 Sandbox

**Definition**  
An isolated execution environment used by the Shell to safely perform side-effectful operations.

**Typical Responsibilities**
- filesystem isolation;
- process isolation;
- command restrictions;
- resource limits;
- artifact and evidence collection.

**Requirement**
- sandbox belongs to the Shell execution environment;
- the Core MUST remain unaware of sandbox implementation details.

**Layer**  
Shell.

---

## 11. Failure and Recovery Terminology

### 11.1 Failure

**Definition**  
Any condition in which an action, task, milestone, or run does not meet its expected outcome.

**Layer**  
Core/Shell shared concern; classified for Core semantics.

---

### 11.2 Failure Class

**Definition**  
A coarse classification of failure.

**Recommended Values**
- system
- task

**Layer**  
Core.

---

### 11.3 Failure Signal

**Definition**  
A structured representation of a failure used for diagnosis and recovery decisions.

**Typical Fields**
- class
- kind
- message
- fingerprint

**Layer**  
Core/Shell boundary object, consumed by Core.

---

## 12. Observability Terminology

### 12.1 Event

**Definition**  
A structured runtime occurrence emitted for diagnostics, UI, telemetry, or replay.

**Examples**
- plan proposed;
- task selected;
- tool started;
- tool ended;
- criteria failed;
- replan applied;
- run done;
- run failed.

**Layer**  
Cross-cutting, typically emitted by Core and/or Shell.

---

### 12.2 Telemetry

**Definition**  
The collection of runtime signals, timings, counts, and operational traces.

**Layer**  
Cross-cutting.

---

### 12.3 Audit

**Definition**  
The durable recording of contexts, requests, results, evidence, and final state snapshots for replay and diagnosis.

**Layer**  
Cross-cutting.

---

## 13. Terminology Mapping by Layer

### 13.1 Core Vocabulary

The following terms are Core vocabulary:

- state
- state machine
- transition
- run
- plan
- milestone
- task
- action
- evidence
- success criterion
- acceptance
- verify
- repair
- replan
- done
- failed

### 13.2 Shell Vocabulary

The following terms are Shell vocabulary:

- effect
- effect request
- effect result
- effect handler
- context engine
- context packet
- message assembler
- capability layer
- result normalizer
- middleware
- sandbox

### 13.3 Provider / External Vocabulary

The following terms are external/provider vocabulary:

- LLM
- message
- prompt
- tool-calling
- tool
- command runner
- file adapter
- review bridge

---

## 14. Prohibited Terminology Mixing

To preserve architectural clarity, the following misuse patterns are prohibited in architecture and implementation documents.

### 14.1 Core MUST NOT be described as owning:
- LLM providers;
- tool registries;
- middleware chains;
- sandbox execution environments;
- provider-native message objects.

### 14.2 Profile MUST NOT be described as:
- altering Core transition semantics;
- injecting semantic logic into the Core.

### 14.3 Tool-Calling MUST NOT be treated as:
- a Core runtime primitive.

Instead, it MUST be normalized to Action Proposal.

### 14.4 Message MUST NOT be treated as:
- a Core input model.

Instead, it belongs to the Shell/provider protocol.

### 14.5 Done MUST NOT be used to mean:
- task finished;
- milestone finished;
- local verification finished.

---

## 15. Terminology Usage Rules

The following usage rules apply to subsequent documents and code comments.

1. Use **Action** instead of provider-native tool call terminology at Core boundaries.
2. Use **Effect Request** and **Effect Result** for Core/Shell contracts.
3. Use **Context Packet** instead of raw prompt text when describing Shell-side context construction.
4. Use **Evidence** for factual execution artifacts.
5. Use **Repair** for local recovery and **Replan** for plan-level modification.
6. Use **Capability Middleware** only when referring to middleware styles that package tools, prompts, and lifecycle hooks together.
7. Use **Closed Core** whenever emphasizing that semantic control stays inside the Core.

---

## 16. Summary

This terminology specification establishes the canonical language for the project.

The central distinction is:

- the **Core** governs semantics;
- the **Shell** governs effects;
- the **Profile** configures Shell behavior;
- provider-specific constructs such as message, prompt, tool-calling, tool, middleware, and sandbox remain outside the Core.

All subsequent architecture and implementation documents SHOULD conform to this terminology unless an explicit exception is documented.
