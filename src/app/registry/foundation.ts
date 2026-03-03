import { buildFoundationRegistry, createToolRegistry, type ToolRegistryDeps } from "../../agent/tools/registry.js";
import type { ToolSpec } from "../../agent/tools/types.js";

export const createFoundationRegistry = async (deps?: ToolRegistryDeps): Promise<Record<string, ToolSpec<any>>> => {
  const merged = await createToolRegistry(deps);
  return buildFoundationRegistry(merged, deps);
};
