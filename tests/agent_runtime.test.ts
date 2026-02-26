import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { describe, expect, test } from "vitest";
import { runAgent } from "../src/agent/index.js";
import { defaultAgentPolicy } from "../src/agent/policy/policy.js";
import type { ToolSpec } from "../src/agent/tools/types.js";
import { MockProvider } from "./helpers/mockProvider.js";

const minimalRegistry = (): Record<string, ToolSpec<any>> => ({
  tool_noop: {
    name: "tool_noop",
    description: "noop",
    inputSchema: z.object({}).passthrough(),
    inputJsonSchema: {},
    category: "low",
    capabilities: [],
    safety: { sideEffects: "none" },
    docs: "",
    run: async () => ({ ok: true, data: {}, meta: { touchedPaths: [] } }),
    examples: []
  },
  tool_check_file_exists: {
    name: "tool_check_file_exists",
    description: "check file exists",
    inputSchema: z.object({ base: z.enum(["appDir", "outDir"]), path: z.string() }),
    inputJsonSchema: {},
    outputSchema: z.object({ ok: z.boolean(), exists: z.boolean(), absolutePath: z.string() }),
    outputJsonSchema: {},
    category: "low",
    capabilities: ["check"],
    safety: { sideEffects: "none" },
    docs: "",
    run: async (input) => {
      const ok = input.path !== "missing.txt";
      return {
        ok,
        data: { ok, exists: ok, absolutePath: "/tmp/done" },
        error: ok ? undefined : { code: "FILE_NOT_FOUND", message: "missing" },
        meta: { touchedPaths: [] }
      };
    },
    examples: []
  }
});

describe("agent runtime (plan mode only)", () => {
  test("completes simple plan", async () => {
    const root = await mkdtemp(join(tmpdir(), "forgetauri-runtime-"));
    const provider = new MockProvider([
      JSON.stringify({
        version: "v1",
        goal: "do one task",
        acceptance_locked: true,
        tech_stack_locked: true,
        milestones: [],
        tasks: [
          {
            id: "t1",
            title: "noop",
            description: "noop",
            dependencies: [],
            success_criteria: [{ type: "tool_result", tool_name: "tool_noop", expected_ok: true }]
          }
        ]
      }),
      JSON.stringify({
        version: "v1",
        task_id: "t1",
        rationale: "run noop",
        actions: [{ name: "tool_noop", input: {} }]
      })
    ]);

    const result = await runAgent({
      goal: "do one task",
      specPath: join(root, "spec.json"),
      outDir: join(root, "generated"),
      apply: true,
      verify: false,
      repair: false,
      provider,
      registry: minimalRegistry(),
      maxTurns: 4,
      maxToolCallsPerTurn: 2
    });

    expect(result.ok).toBe(true);
    expect(result.state.status).toBe("done");
    expect(result.state.completedTasks).toContain("t1");
  });

  test("fails with actionable error when change request denied", async () => {
    const root = await mkdtemp(join(tmpdir(), "forgetauri-runtime-"));
    const provider = new MockProvider([
      JSON.stringify({
        version: "v1",
        goal: "failing task",
        acceptance_locked: true,
        tech_stack_locked: true,
        milestones: [],
        tasks: [
          {
            id: "t1",
            title: "never pass",
            description: "never pass",
            dependencies: [],
            success_criteria: [{ type: "file_exists", path: "missing.txt" }]
          }
        ]
      }),
      JSON.stringify({ version: "v1", task_id: "t1", rationale: "noop", actions: [{ name: "tool_noop", input: {} }] }),
      JSON.stringify({ version: "v1", task_id: "t1", rationale: "noop", actions: [{ name: "tool_noop", input: {} }] }),
      JSON.stringify({ version: "v1", task_id: "t1", rationale: "noop", actions: [{ name: "tool_noop", input: {} }] }),
      JSON.stringify({
        version: "v2",
        reason: "relax acceptance",
        change_type: "relax_acceptance",
        evidence: ["failing"],
        impact: { steps_delta: 0, risk: "low" },
        requested_tools: [],
        patch: [{ op: "edit_acceptance", changes: { locked: false } }]
      })
    ]);

    const result = await runAgent({
      goal: "failing task",
      specPath: join(root, "spec.json"),
      outDir: join(root, "generated"),
      apply: true,
      verify: false,
      repair: false,
      provider,
      registry: minimalRegistry(),
      maxTurns: 6,
      maxToolCallsPerTurn: 2
    });

    expect(result.ok).toBe(false);
    expect(result.summary).toContain("relax_acceptance");
    expect(result.state.status).toBe("failed");
  });

  test("supports injected policy", async () => {
    const root = await mkdtemp(join(tmpdir(), "forgetauri-runtime-"));
    const provider = new MockProvider([
      JSON.stringify({
        version: "v1",
        goal: "policy test",
        acceptance_locked: true,
        tech_stack_locked: true,
        milestones: [],
        tasks: [
          {
            id: "t1",
            title: "noop",
            description: "noop",
            dependencies: [],
            success_criteria: [{ type: "tool_result", tool_name: "tool_noop", expected_ok: true }]
          }
        ]
      }),
      JSON.stringify({
        version: "v1",
        task_id: "t1",
        rationale: "run noop",
        actions: [{ name: "tool_noop", input: {} }]
      })
    ]);

    const registry = minimalRegistry();
    const policy = defaultAgentPolicy({
      maxSteps: 5,
      maxActionsPerTask: 2,
      maxRetriesPerTask: 2,
      maxReplans: 1,
      allowedTools: Object.keys(registry)
    });

    const result = await runAgent({
      goal: "policy test",
      specPath: join(root, "spec.json"),
      outDir: join(root, "generated"),
      apply: true,
      verify: false,
      repair: false,
      provider,
      registry,
      policy,
      maxTurns: 5,
      maxToolCallsPerTurn: 2
    });

    expect(result.ok).toBe(true);
    expect(result.state.budgets.maxTurns).toBe(5);
  });
});
