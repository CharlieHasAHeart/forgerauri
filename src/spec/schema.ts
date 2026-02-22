import { z } from "zod";

const screenSchema = z
  .object({
    name: z.string().min(1, "screen name is required"),
    purpose: z.string().optional(),
    primary_actions: z.array(z.string()).default([])
  })
  .passthrough();

const rustCommandSchema = z
  .object({
    name: z.string().min(1, "rust command name is required"),
    purpose: z.string().optional(),
    async: z.boolean().default(true),
    input: z.record(z.string(), z.unknown()).default({}),
    output: z.record(z.string(), z.unknown()).default({})
  })
  .passthrough();

const columnSchema = z
  .object({
    name: z.string().min(1, "column name is required"),
    type: z.string().transform((value) => value.trim().toLowerCase())
  })
  .passthrough();

const tableSchema = z
  .object({
    name: z.string().min(1, "table name is required"),
    columns: z.array(columnSchema)
  })
  .passthrough();

const specCoreSchema = z
  .object({
    app: z
      .object({
        name: z.string().min(1, "app.name is required"),
        one_liner: z.string().min(1, "app.one_liner is required")
      })
      .passthrough(),
    screens: z.array(screenSchema),
    rust_commands: z.array(rustCommandSchema),
    data_model: z
      .object({
        tables: z.array(tableSchema)
      })
      .passthrough(),
    acceptance_tests: z.array(z.string()),
    mvp_plan: z.union([z.array(z.string()), z.record(z.string(), z.unknown())])
  })
  .passthrough();

const stableString = (value: unknown): string => {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (value === null) return "null";
  if (Array.isArray(value)) {
    return value.map((item) => stableString(item)).join(" ").trim();
  }
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
      a.localeCompare(b)
    );
    return entries
      .map(([key, val]) => `${key}: ${stableString(val)}`)
      .join(" | ")
      .trim();
  }
  return "";
};

const normalizeMvpPlan = (input: string[] | Record<string, unknown>): string[] => {
  if (Array.isArray(input)) return input;
  return Object.keys(input)
    .sort((a, b) => a.localeCompare(b))
    .map((key) => stableString(input[key]))
    .filter((item) => item.length > 0);
};

const ensureUnique = (
  values: string[],
  pathPrefix: (index: number) => (string | number)[],
  ctx: z.RefinementCtx,
  entity: string
): void => {
  const seen = new Map<string, number>();
  values.forEach((value, index) => {
    const firstIndex = seen.get(value);
    if (firstIndex !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: pathPrefix(index),
        message: `duplicate ${entity} name \"${value}\" (first seen at index ${firstIndex})`
      });
      return;
    }
    seen.set(value, index);
  });
};

export const specSchema = specCoreSchema
  .transform((spec) => ({
    app: spec.app,
    screens: spec.screens,
    rust_commands: spec.rust_commands,
    data_model: spec.data_model,
    acceptance_tests: spec.acceptance_tests,
    mvp_plan: normalizeMvpPlan(spec.mvp_plan)
  }))
  .superRefine((spec, ctx) => {
    ensureUnique(
      spec.screens.map((s) => s.name),
      (index) => ["screens", index, "name"],
      ctx,
      "screen"
    );

    ensureUnique(
      spec.rust_commands.map((cmd) => cmd.name),
      (index) => ["rust_commands", index, "name"],
      ctx,
      "rust command"
    );

    ensureUnique(
      spec.data_model.tables.map((table) => table.name),
      (index) => ["data_model", "tables", index, "name"],
      ctx,
      "table"
    );

    spec.data_model.tables.forEach((table, tableIndex) => {
      ensureUnique(
        table.columns.map((column) => column.name),
        (columnIndex) => ["data_model", "tables", tableIndex, "columns", columnIndex, "name"],
        ctx,
        `column in table \"${table.name}\"`
      );
    });
  });

export type SpecIR = {
  app: { name: string; one_liner: string };
  screens: Array<{ name: string; purpose?: string; primary_actions: string[] }>;
  rust_commands: Array<{
    name: string;
    purpose?: string;
    async: boolean;
    input: Record<string, unknown>;
    output: Record<string, unknown>;
  }>;
  data_model: { tables: Array<{ name: string; columns: Array<{ name: string; type: string }> }> };
  acceptance_tests: string[];
  mvp_plan: string[];
  raw: unknown;
};

export type ParsedSpec = z.infer<typeof specSchema>;
