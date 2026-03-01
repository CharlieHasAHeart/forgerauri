import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { z } from "zod";
import { describe, expect, test } from "vitest";
import { runAgent } from "../src/agent/index.js";
import type { ToolSpec } from "../src/agent/tools/types.js";
import { MockProvider } from "./helpers/mockProvider.js";

const createSpec = async (root: string): Promise<string> => {
  const specPath = join(root, "spec.json");
  await writeFile(
    specPath,
    JSON.stringify(
      {
        app: { name: "Plan Agent", one_liner: "plan" },
        screens: [],
        rust_commands: [],
        data_model: { tables: [] },
        acceptance_tests: [],
        mvp_plan: []
      },
      null,
      2
    ),
    "utf8"
  );
  return specPath;
};

describe("agent plan mode", () => {
  test("plan mode executes task and marks DONE", async () => {
    const root = await mkdtemp(join(tmpdir(), "forgetauri-plan-"));
    const specPath = await createSpec(root);
    const outDir = join(root, "generated");

    const provider = new MockProvider([
      JSON.stringify({
        version: "v1",
        goal: "create marker",
        acceptance_locked: true,
        tech_stack_locked: true,
        milestones: [{ id: "m1", title: "main", task_ids: ["t1"] }],
        tasks: [
          {
            id: "t1",
            title: "write marker",
            description: "write done file",
            dependencies: [],
            task_type: "build",
            success_criteria: [
              { type: "tool_result", tool_name: "tool_touch_file", expected_ok: true },
              { type: "file_exists", path: "done.txt" }
            ]
          }
        ]
      }),
      JSON.stringify({
        toolCalls: [{ name: "tool_touch_file", input: { path: "done.txt", content: "ok" } }]
      })
    ]);

    const registry: Record<string, ToolSpec<any>> = {
      tool_touch_file: {
        name: "tool_touch_file",
        description: "write a file",
        inputSchema: z.object({ path: z.string(), content: z.string() }),
        inputJsonSchema: {},
        outputSchema: z.object({ written: z.boolean() }),
        outputJsonSchema: {},
        category: "low",
        capabilities: ["fs"],
        safety: { sideEffects: "fs" },
        docs: "",
        run: async (input, ctx) => {
          const target = join(ctx.memory.outDir ?? outDir, input.path);
          await mkdir(dirname(target), { recursive: true });
          await writeFile(target, input.content, "utf8");
          return { ok: true, data: { written: true }, meta: { touchedPaths: [target] } };
        },
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
          const target = join(outDir, input.path);
          try {
            await writeFile(target, "ok", { flag: "a" });
            return { ok: true, data: { ok: true, exists: true, absolutePath: target }, meta: { touchedPaths: [] } };
          } catch {
            return { ok: false, error: { code: "E", message: "missing" }, meta: { touchedPaths: [] } };
          }
        },
        examples: []
      }
    };

    const result = await runAgent({
      goal: "create marker",
      specPath,
      outDir,
      apply: true,
      verify: false,
      repair: false,
      provider,
      registry,
      maxTurns: 4,
      maxToolCallsPerTurn: 2
    });

    expect(result.ok).toBe(true);
    expect(result.state.phase).toBe("DONE");
    expect(result.state.status).toBe("done");
    expect(result.state.completedTasks).toContain("t1");
  });

  test("plan mode rejects forbidden relax_acceptance change", async () => {
    const root = await mkdtemp(join(tmpdir(), "forgetauri-plan-"));
    const specPath = await createSpec(root);
    const outDir = join(root, "generated");

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
            description: "missing file",
            dependencies: [],
            task_type: "debug",
            success_criteria: [{ type: "file_exists", path: "never-created.txt" }]
          }
        ]
      }),
      JSON.stringify({ toolCalls: [{ name: "tool_noop", input: {} }] }),
      JSON.stringify({ toolCalls: [{ name: "tool_noop", input: {} }] }),
      JSON.stringify({ toolCalls: [{ name: "tool_noop", input: {} }] }),
      JSON.stringify({
        version: "v2",
        reason: "let us skip acceptance",
        change_type: "relax_acceptance",
        evidence: ["task failing"],
        impact: { steps_delta: 0, risk: "low" },
        requested_tools: [],
        patch: [{ action: "acceptance.update", changes: { locked: false } }]
      })
    ]);

    const result = await runAgent({
      goal: "failing task",
      specPath,
      outDir,
      apply: true,
      verify: false,
      repair: false,
      provider,
      registry: {
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
        }
      },
      maxTurns: 6,
      maxToolCallsPerTurn: 2
    });

    expect(result.ok).toBe(false);
    expect(result.summary).toContain("relax_acceptance");
  });
});
