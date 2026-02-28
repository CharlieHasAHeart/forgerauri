import { describe, expect, test } from "vitest";
import { MockProvider } from "./helpers/mockProvider.js";
import { handleReplan } from "../src/agent/runtime/replanner.js";
import { AgentTurnAuditCollector } from "../src/runtime/audit/index.js";
import { defaultAgentPolicy } from "../src/agent/policy/policy.js";
import { planV1Schema } from "../src/agent/plan/schema.js";
import type { AgentState } from "../src/agent/types.js";

const basePlan = planV1Schema.parse({
  version: "v1",
  goal: "test",
  acceptance_locked: true,
  tech_stack_locked: true,
  milestones: [],
  tasks: [
    {
      id: "t1",
      title: "task",
      description: "task",
      dependencies: [],
      success_criteria: [{ type: "tool_result", tool_name: "tool_noop", expected_ok: true }]
    }
  ]
});

const makeState = (): AgentState => ({
  goal: "goal",
  specPath: "spec.json",
  outDir: "generated",
  flags: { apply: true, verify: false, repair: false, truncation: "auto" },
  status: "replanning",
  usedLLM: true,
  verifyHistory: [],
  budgets: { maxTurns: 8, maxPatches: 6, usedTurns: 0, usedPatches: 0, usedRepairs: 0 },
  patchPaths: [],
  humanReviews: [],
  touchedFiles: [],
  toolCalls: [],
  toolResults: [],
  lastDeterministicFixes: [],
  repairKnownChecked: false,
  planData: basePlan,
  planVersion: 1,
  planHistory: []
});

describe("replanner", () => {
  test("returns guidance when user review denies", async () => {
    const provider = new MockProvider([
      JSON.stringify({
        version: "v2",
        reason: "adjust plan",
        change_type: "tasks.update",
        evidence: ["failing"],
        impact: { steps_delta: 0, risk: "low" },
        requested_tools: [],
        patch: [{ action: "tasks.update", task_id: "t1", changes: { description: "new" } }]
      }),
      JSON.stringify({
        decision: "denied",
        reason: "not approved",
        guidance: "Please keep current acceptance and fix task logic."
      })
    ]);

    const state = makeState();
    const policy = defaultAgentPolicy({
      maxSteps: 8,
      maxActionsPerTask: 4,
      maxRetriesPerTask: 3,
      maxReplans: 2,
      allowedTools: ["tool_noop"]
    });

    const result = await handleReplan({
      provider,
      state,
      policy,
      failedTaskId: "t1",
      failures: ["x"],
      replans: 0,
      audit: new AgentTurnAuditCollector("goal"),
      turn: 1,
      requestPlanChangeReview: async () => "I do not approve this change. Keep current acceptance and fix task logic."
    });

    expect(result.ok).toBe(false);
    expect(state.lastError?.message).toContain("Guidance");
  });

  test("applies patch when user review approves", async () => {
    const provider = new MockProvider([
      JSON.stringify({
        version: "v2",
        reason: "add retry helper",
        change_type: "tasks.add",
        evidence: ["failing"],
        impact: { steps_delta: 1, risk: "low" },
        requested_tools: [],
        patch: [
          {
            action: "tasks.add",
            task: {
              id: "t2",
              title: "extra",
              description: "extra",
              dependencies: ["t1"],
              success_criteria: [{ type: "tool_result", tool_name: "tool_noop", expected_ok: true }]
            }
          }
        ]
      }),
      JSON.stringify({
        decision: "approved",
        reason: "looks good",
        patch: [
          {
            action: "tasks.add",
            task: {
              id: "t2",
              title: "extra",
              description: "extra",
              dependencies: ["t1"],
              success_criteria: [{ type: "tool_result", tool_name: "tool_noop", expected_ok: true }]
            }
          }
        ]
      })
    ]);

    const state = makeState();
    const policy = defaultAgentPolicy({
      maxSteps: 8,
      maxActionsPerTask: 4,
      maxRetriesPerTask: 3,
      maxReplans: 2,
      allowedTools: ["tool_noop"]
    });

    const result = await handleReplan({
      provider,
      state,
      policy,
      failedTaskId: "t1",
      failures: ["x"],
      replans: 0,
      audit: new AgentTurnAuditCollector("goal"),
      turn: 1,
      requestPlanChangeReview: async () => "Approve this plan change and apply the proposed patch."
    });

    expect(result.ok).toBe(true);
    expect(result.replans).toBe(1);
    expect(state.planVersion).toBe(2);
    expect(state.planData?.tasks.some((task) => task.id === "t2")).toBe(true);
  });
});
