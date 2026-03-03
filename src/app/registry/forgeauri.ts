import { buildForgeAuriRegistry, createToolRegistry, type ToolRegistryDeps } from "../../agent/tools/registry.js";
import type { ToolSpec } from "../../agent/tools/types.js";

export const createForgeAuriRegistry = async (deps?: ToolRegistryDeps): Promise<Record<string, ToolSpec<any>>> => {
  const merged = await createToolRegistry(deps);
  return buildForgeAuriRegistry(merged, deps);
};
