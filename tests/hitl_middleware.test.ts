import { describe, expect, it } from "vitest";
import { createHumanInTheLoopMiddleware } from "../src/middleware/humanInTheLoop.js";
import { applyMiddlewares } from "../src/core/middleware/applyMiddlewares.js";
import { executeToolCall } from "../src/core/agent/execution/executor.js";
import type { AgentPolicy } from "../src/core/contracts/policy.js";
import type { AgentState } from "../src/core/contracts/state.js";
import type { LlmPort } from "../src/core/contracts/llm.js";
import type { ToolRunContext, ToolSpec } from "../src/core/contracts/tools.js";

const llm: LlmPort = { name: "test-llm", model: "test-model" };

const createState = (): AgentState => ({
  goal: "test",
  specRef: "spec.json",
  runDir: "/tmp",
  status: "executing",
  usedLLM: false,
  verifyHistory: [],
  budgets: {
    maxTurns: 8,
    maxPatches: 8,
    usedTurns: 1,
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
  contextHistory: []
});

const createCtx = (
  runCmdImpl: ToolRunContext["runCmdImpl"] = async () => ({ ok: true, code: 0, stdout: "ok", stderr: "" })
): ToolRunContext => ({
  provider: llm,
  runCmdImpl,
  flags: { maxPatchesPerTurn: 8 },
  memory: {
    runDir: "/tmp",
    patchPaths: [],
    touchedPaths: []
  }
});

const policy: AgentPolicy = {
  tech_stack: {},
  tech_stack_locked: true,
  acceptance: { locked: true, criteria: [] },
  safety: {
    allowed_tools: ["apply_structured_edits"],
    allowed_commands: ["pnpm", "cargo", "tauri", "node"]
  },
  budgets: {
    max_steps: 8,
    max_actions_per_task: 8,
    max_retries_per_task: 3,
    max_replans: 2
  }
};

describe("humanInTheLoop middleware", () => {
  it("denies patch tool when patchTools matches and humanReview is missing", async () => {
    const state = createState();
    const ctx = createCtx();
    const tool: ToolSpec = {
      name: "apply_structured_edits",
      run: async () => ({ ok: true, data: { ok: true } })
    };
    const middleware = createHumanInTheLoopMiddleware({
      options: { patchTools: ["apply_structured_edits"] }
    });
    const installed = await applyMiddlewares({
      middlewares: [middleware],
      ctx,
      state,
      registry: { apply_structured_edits: tool },
      provider: llm
    });

    const executed = await executeToolCall({
      call: { name: "apply_structured_edits", input: { edits: [] } },
      registry: installed.registry,
      ctx,
      state,
      policy,
      hooks: installed.hooks
    });

    expect(executed.ok).toBe(false);
    expect(state.lastError?.code).toBe("HUMAN_REVIEW_REQUIRED");
  });

  it("returns code=126 when command execution is denied by human review", async () => {
    const state = createState();
    const ctx = createCtx(async () => ({ ok: true, code: 0, stdout: "should-not-run", stderr: "" }));
    const middleware = createHumanInTheLoopMiddleware({
      humanReview: async () => false,
      options: { patchTools: ["apply_structured_edits"] }
    });
    await applyMiddlewares({
      middlewares: [middleware],
      ctx,
      state,
      registry: {},
      provider: llm
    });

    const result = await ctx.runCmdImpl("pnpm", ["build"], "/tmp");
    expect(result.ok).toBe(false);
    expect(result.code).toBe(126);
  });

  it("allows command execution when human review approves", async () => {
    const state = createState();
    let called = false;
    const ctx = createCtx(async () => {
      called = true;
      return { ok: true, code: 0, stdout: "ran", stderr: "" };
    });
    const middleware = createHumanInTheLoopMiddleware({
      humanReview: async () => true,
      options: { patchTools: ["apply_structured_edits"] }
    });
    await applyMiddlewares({
      middlewares: [middleware],
      ctx,
      state,
      registry: {},
      provider: llm
    });

    const result = await ctx.runCmdImpl("pnpm", ["build"], "/tmp");
    expect(result.ok).toBe(true);
    expect(result.code).toBe(0);
    expect(called).toBe(true);
  });
});
