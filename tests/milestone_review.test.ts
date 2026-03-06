import { describe, expect, it } from "vitest";
import { ContextEngine } from "../src/core/context_engine/ContextEngine.js";
import { runPlanFirstAgent } from "../src/core/agent/flow/orchestrator.js";
import { AgentTurnAuditCollector } from "../src/core/agent/telemetry/audit.js";
import type { Planner } from "../src/core/contracts/planning.js";
import type { AgentPolicy } from "../src/core/contracts/policy.js";
import type { AgentState } from "../src/core/contracts/state.js";
import type { ToolRunContext } from "../src/core/contracts/tools.js";
import type { LlmPort } from "../src/core/contracts/llm.js";
import type { Workspace } from "../src/core/contracts/workspace.js";

const provider: LlmPort = { name: "test", model: "test-model" };

const createState = (): AgentState => ({
  goal: "test goal",
  specRef: "spec.json",
  runDir: "/tmp",
  status: "planning",
  usedLLM: false,
  verifyHistory: [],
  budgets: {
    maxTurns: 8,
    maxPatches: 8,
    usedTurns: 0,
    usedPatches: 0,
    usedRepairs: 0
  },
  patchPaths: [],
  humanReviews: [],
  lastDeterministicFixes: [],
  repairKnownChecked: false,
  touchedFiles: [],
  toolCalls: [],
  toolResults: [],
  planHistory: [],
  milestoneReviewHistory: [],
  goalReviewHistory: [],
  contextHistory: []
});

const planner: Planner = {
  async proposePlan() {
    return {
      plan: {
        version: "v2",
        goal: "test goal",
        milestones: [
          {
            id: "m1",
            title: "first",
            tasks: [
              {
                id: "t1",
                title: "task1",
                dependencies: [],
                success_criteria: []
              }
            ],
            acceptance: [{ type: "command", cmd: "echo", args: ["fail"], expect_exit_code: 0 }]
          },
          {
            id: "m2",
            title: "second",
            tasks: [
              {
                id: "t2",
                title: "task2",
                dependencies: [],
                success_criteria: []
              }
            ],
            acceptance: []
          }
        ],
        goal_acceptance: []
      },
      raw: "{}"
    };
  },
  async proposeToolCallsForTask() {
    return { toolCalls: [], raw: "{}" };
  },
  async proposePlanChange() {
    throw new Error("should not replan when budget is zero");
  }
};

const policy: AgentPolicy = {
  tech_stack: {},
  tech_stack_locked: true,
  acceptance: { locked: true, criteria: [] },
  safety: {
    allowed_tools: [],
    allowed_commands: ["echo"]
  },
  budgets: {
    max_steps: 8,
    max_actions_per_task: 4,
    max_retries_per_task: 1,
    max_replans: 0
  }
};

describe("milestone review gate", () => {
  it("runs milestone review after tasks and blocks next milestone on review failure", async () => {
    const state = createState();
    const ctx: ToolRunContext = {
      provider,
      runCmdImpl: async () => ({ ok: false, code: 1, stdout: "", stderr: "boom" }),
      flags: { maxPatchesPerTurn: 8 },
      memory: {
        repoRoot: "/tmp",
        runDir: "/tmp",
        appDir: "/tmp",
        patchPaths: [],
        touchedPaths: []
      }
    };
    const workspace: Workspace = {
      root: "/tmp",
      runDir: "/tmp",
      inputs: { specRef: "spec.json" },
      paths: {}
    };

    await runPlanFirstAgent({
      state,
      provider,
      planner,
      registry: {},
      ctx,
      maxTurns: 8,
      maxToolCallsPerTurn: 2,
      audit: new AgentTurnAuditCollector("test goal"),
      policy,
      runtimePathsResolver: () => ({ repoRoot: "/tmp", appDir: "/tmp", tauriDir: "/tmp/src-tauri" }),
      workspace,
      contextEngine: new ContextEngine()
    });

    expect(state.milestoneReviewHistory.length).toBe(1);
    expect(state.milestoneReviewHistory[0]?.milestoneId).toBe("m1");
    expect(state.milestoneReviewHistory[0]?.ok).toBe(false);
    expect(state.completedTasks).toContain("t1");
    expect(state.completedTasks).not.toContain("t2");
    expect(state.status).toBe("failed");
  });
});
