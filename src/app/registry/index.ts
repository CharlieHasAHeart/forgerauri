import {
  buildForgeAuriRegistry,
  buildFoundationRegistry,
  createToolRegistry,
  type ToolRegistryDeps
} from "../../agent/tools/registry.js";
import { buildToolDocPack } from "../../agent/tools/loader.js";
import type { ToolDocPack, ToolSpec } from "../../agent/tools/types.js";
export { createFoundationRegistry } from "./foundation.js";
export { createForgeAuriRegistry } from "./forgeauri.js";

export type DefaultRegistryLoadResult = {
  registry: Record<string, ToolSpec<any>>;
  docs: ToolDocPack[];
};

export const createDefaultRegistry = async (deps?: ToolRegistryDeps): Promise<Record<string, ToolSpec<any>>> => {
  const merged = await createToolRegistry(deps);
  return {
    ...buildFoundationRegistry(merged, deps),
    ...buildForgeAuriRegistry(merged, deps)
  };
};

export const loadDefaultRegistryWithDocs = async (deps?: ToolRegistryDeps): Promise<DefaultRegistryLoadResult> => {
  const registry = await createDefaultRegistry(deps);
  return {
    registry,
    docs: buildToolDocPack(registry)
  };
};
