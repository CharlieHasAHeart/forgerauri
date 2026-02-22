import type { SpecIR } from "../../spec/schema.js";
import { toSnakeCase } from "../commands/typesMap.js";

export type BusinessDomain = "lint" | "apply" | "other";

export type ResolvedBusinessTargets = {
  lintCommand: string | null;
  applyCommand: string | null;
};

export const resolveCommandDomain = (commandName: string): BusinessDomain => {
  const normalized = toSnakeCase(commandName);

  if (normalized.startsWith("lint_")) {
    return "lint";
  }
  if (normalized.startsWith("apply_") || normalized.startsWith("fix_")) {
    return "apply";
  }
  return "other";
};

export const resolveBusinessTargets = (ir: SpecIR): ResolvedBusinessTargets => {
  const sortedNames = [...ir.rust_commands].map((command) => toSnakeCase(command.name)).sort((a, b) => a.localeCompare(b));

  const lint = sortedNames.find((name) => resolveCommandDomain(name) === "lint") ?? null;
  const apply = sortedNames.find((name) => resolveCommandDomain(name) === "apply") ?? null;

  return {
    lintCommand: lint,
    applyCommand: apply
  };
};
