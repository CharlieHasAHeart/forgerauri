import { existsSync } from "node:fs";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { z } from "zod";
import { describe, expect, test } from "vitest";
import { runAgent } from "../src/agent/runtime.js";
import { defaultAgentPolicy } from "../src/agent/policy.js";
import type { ToolSpec } from "../src/agent/tools/types.js";
import { MockProvider } from "./helpers/mockProvider.js";

describe("agent plan replan integration (stub toolchain)", () => {
  test("covers multi-task dependency and fail->replan->patch apply", async () => {
    const root = await mkdtemp(join(tmpdir(), "forgetauri-plan-replan-"));
    const outDir = join(root, "generated");

    const executed: Array<{ name: string; detail?: string }> = [];

    const registry: Record<string, ToolSpec<any>> = {
      tool_prepare_workspace: {
        name: "tool_prepare_workspace",
        description: "prepare appDir for checks",
        inputSchema: z.object({}).passthrough(),
        inputJsonSchema: {},
        category: "low",
        capabilities: ["fs"],
        safety: { sideEffects: "fs" },
        docs: "",
        run: async (_input, ctx) => {
          const appDir = ctx.memory.outDir ?? outDir;
          await mkdir(appDir, { recursive: true });
          ctx.memory.appDir = appDir;
          executed.push({ name: "tool_prepare_workspace" });
          return { ok: true, data: { appDir }, meta: { touchedPaths: [appDir] } };
        },
        examples: []
      },
      tool_write_file: {
        name: "tool_write_file",
        description: "write file",
        inputSchema: z.object({ path: z.string(), content: z.string() }),
        inputJsonSchema: {},
        category: "low",
        capabilities: ["fs"],
        safety: { sideEffects: "fs" },
        docs: "",
        run: async (input, ctx) => {
          const base = ctx.memory.appDir ?? ctx.memory.outDir ?? outDir;
          await mkdir(base, { recursive: true });
          const abs = resolve(base, input.path);
          await mkdir(resolve(abs, ".."), { recursive: true });
          await writeFile(abs, input.content, "utf8");
          executed.push({ name: "tool_write_file", detail: input.path });
          return { ok: true, data: { path: abs }, meta: { touchedPaths: [abs] } };
        },
        examples: []
      },
      tool_noop: {
        name: "tool_noop",
        description: "noop",
        inputSchema: z.object({}).passthrough(),
        inputJsonSchema: {},
        category: "low",
        capabilities: [],
        safety: { sideEffects: "none" },
        docs: "",
        run: async () => {
          executed.push({ name: "tool_noop" });
          return { ok: true, data: {}, meta: { touchedPaths: [] } };
        },
        examples: []
      },
      tool_check_file_exists: {
        name: "tool_check_file_exists",
        description: "check exists",
        inputSchema: z.object({ base: z.enum(["appDir", "outDir"]), path: z.string() }),
        inputJsonSchema: {},
        outputSchema: z.object({ ok: z.boolean(), exists: z.boolean(), absolutePath: z.string() }),
        outputJsonSchema: {},
        category: "low",
        capabilities: ["check"],
        safety: { sideEffects: "none" },
        docs: "",
        run: async (input, ctx) => {
          const base = input.base === "appDir" ? ctx.memory.appDir : ctx.memory.outDir;
          if (!base) {
            return { ok: false, error: { code: "BASE_MISSING", message: "base missing" }, meta: { touchedPaths: [] } };
          }
          const abs = resolve(base, input.path);
          const ok = existsSync(abs);
          executed.push({ name: "tool_check_file_exists", detail: input.path });
          return {
            ok,
            data: { ok, exists: ok, absolutePath: abs },
            error: ok ? undefined : { code: "FILE_NOT_FOUND", message: `${input.path} missing` },
            meta: { touchedPaths: [] }
          };
        },
        examples: []
      }
    };

    const provider = new MockProvider([
      JSON.stringify({
        version: "v1",
        goal: "multi task",
        acceptance_locked: true,
        tech_stack_locked: true,
        milestones: [{ id: "m1", title: "main", task_ids: ["t1", "t2"] }],
        tasks: [
          {
            id: "t1",
            title: "setup and write a",
            description: "prepare workspace and write a.txt",
            dependencies: [],
            task_type: "build",
            success_criteria: [{ type: "file_exists", path: "a.txt" }]
          },
          {
            id: "t2",
            title: "write b",
            description: "should fail initially",
            dependencies: ["t1"],
            task_type: "debug",
            success_criteria: [{ type: "file_exists", path: "b.txt" }]
          }
        ]
      }),
      JSON.stringify({
        version: "v1",
        task_id: "t1",
        rationale: "prepare and write a",
        actions: [
          { name: "tool_prepare_workspace", input: {} },
          { name: "tool_write_file", input: { path: "a.txt", content: "a" } }
        ]
      }),
      JSON.stringify({ version: "v1", task_id: "t2", rationale: "first try", actions: [{ name: "tool_noop", input: {} }] }),
      JSON.stringify({ version: "v1", task_id: "t2", rationale: "second try", actions: [{ name: "tool_noop", input: {} }] }),
      JSON.stringify({ version: "v1", task_id: "t2", rationale: "third try", actions: [{ name: "tool_noop", input: {} }] }),
      JSON.stringify({
        version: "v2",
        reason: "switch t2 check to tool_result after file write action",
        change_type: "edit_task",
        evidence: ["b file missing after 3 retries", "noop action has no effect"],
        impact: { steps_delta: 0, risk: "low impact" },
        requested_tools: ["tool_write_file"],
        patch: [
          {
            op: "edit_task",
            task_id: "t2",
            changes: {
              description: "write b and check tool_result",
              success_criteria: [{ type: "tool_result", tool_name: "tool_write_file", expected_ok: true }]
            }
          }
        ]
      }),
      JSON.stringify({
        version: "v1",
        task_id: "t2",
        rationale: "after patch write b",
        actions: [{ name: "tool_write_file", input: { path: "b.txt", content: "b" } }]
      })
    ]);

    const policy = defaultAgentPolicy({
      maxSteps: 12,
      maxActionsPerTask: 4,
      maxRetriesPerTask: 3,
      maxReplans: 2,
      allowedTools: Object.keys(registry)
    });

    const result = await runAgent({
      goal: "multi task dependency with replan",
      specPath: join(root, "spec.json"),
      outDir,
      apply: true,
      verify: false,
      repair: false,
      provider,
      registry,
      policy,
      maxTurns: 10,
      maxToolCallsPerTurn: 4
    });

    expect(result.ok).toBe(true);
    expect(result.state.status).toBe("done");
    expect(result.state.completedTasks).toEqual(["t1", "t2"]);
    expect(result.state.planVersion).toBeGreaterThan(1);

    const changeRequestEvent = result.state.planHistory?.find((item) => item.type === "change_request");
    const changeDecisionEvent = result.state.planHistory?.find((item) => item.type === "change_decision");
    expect(changeRequestEvent).toBeTruthy();
    expect(changeDecisionEvent).toBeTruthy();
    if (changeDecisionEvent?.type === "change_decision") {
      expect(changeDecisionEvent.decision.decision).toBe("approved");
    }

    const firstNoopIndex = executed.findIndex((item) => item.name === "tool_noop");
    const writeAIndex = executed.findIndex((item) => item.name === "tool_write_file" && item.detail === "a.txt");
    const writeBIndex = executed.findLastIndex((item) => item.name === "tool_write_file" && item.detail === "b.txt");
    expect(writeAIndex).toBeGreaterThan(-1);
    expect(firstNoopIndex).toBeGreaterThan(writeAIndex);
    expect(writeBIndex).toBeGreaterThan(firstNoopIndex);
  });
});
