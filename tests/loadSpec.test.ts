import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { ZodError } from "zod";
import { loadSpec } from "../src/spec/loadSpec.js";

const writeSpec = async (content: unknown): Promise<string> => {
  const dir = await mkdtemp(join(tmpdir(), "forgetauri-spec-"));
  const filePath = join(dir, "spec.json");
  await writeFile(filePath, JSON.stringify(content, null, 2), "utf8");
  return filePath;
};

describe("loadSpec", () => {
  test("parses and normalizes valid spec", async () => {
    const path = await writeSpec({
      app: { name: "Demo", one_liner: "hello" },
      screens: [{ name: "Home" }],
      rust_commands: [{ name: "fetch_items" }],
      data_model: {
        tables: [
          {
            name: "items",
            columns: [
              { name: "id", type: " INTEGER " },
              { name: "title", type: " TeXT" }
            ]
          }
        ]
      },
      acceptance_tests: ["can list items"],
      mvp_plan: { step_2: "Do B", step_1: "Do A" },
      extra_field: { keep: true }
    });

    const ir = await loadSpec(path);

    expect(ir.screens[0].primary_actions).toEqual([]);
    expect(ir.rust_commands[0].async).toBe(true);
    expect(ir.rust_commands[0].input).toEqual({});
    expect(ir.rust_commands[0].output).toEqual({});
    expect(ir.data_model.tables[0].columns.map((c) => c.type)).toEqual(["integer", "text"]);
    expect(ir.mvp_plan).toEqual(["Do A", "Do B"]);
    expect(ir.raw).toMatchObject({ extra_field: { keep: true } });
  });

  test("throws on duplicate rust command names", async () => {
    const path = await writeSpec({
      app: { name: "Demo", one_liner: "hello" },
      screens: [{ name: "Home" }],
      rust_commands: [{ name: "dup" }, { name: "dup" }],
      data_model: { tables: [{ name: "items", columns: [{ name: "id", type: "integer" }] }] },
      acceptance_tests: [],
      mvp_plan: []
    });

    await expect(loadSpec(path)).rejects.toSatisfy((error: unknown) => {
      if (!(error instanceof ZodError)) return false;
      return error.issues.some(
        (issue) => issue.path.join(".") === "rust_commands.1.name" && issue.message.includes("duplicate")
      );
    });
  });

  test("throws on duplicate column names within a table", async () => {
    const path = await writeSpec({
      app: { name: "Demo", one_liner: "hello" },
      screens: [{ name: "Home" }],
      rust_commands: [{ name: "load" }],
      data_model: {
        tables: [{ name: "items", columns: [{ name: "id", type: "integer" }, { name: "id", type: "text" }] }]
      },
      acceptance_tests: [],
      mvp_plan: []
    });

    await expect(loadSpec(path)).rejects.toSatisfy((error: unknown) => {
      if (!(error instanceof ZodError)) return false;
      return error.issues.some(
        (issue) =>
          issue.path.join(".") === "data_model.tables.0.columns.1.name" && issue.message.includes("duplicate")
      );
    });
  });
});
