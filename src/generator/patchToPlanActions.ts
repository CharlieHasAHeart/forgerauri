import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { assertPathInside } from "../runtime/policy.js";
import { makeUnifiedDiff } from "./diff.js";
import type { PlanAction } from "./types.js";
import { classifyPath } from "./zones.js";

export type TextPatchProposal = {
  filePath: string;
  newContent: string;
  reason: string;
};

const readOldText = async (absolutePath: string): Promise<string> => {
  try {
    return await readFile(absolutePath, "utf8");
  } catch {
    return "";
  }
};

export const toPlanActionsFromPatches = async (
  projectRoot: string,
  patches: TextPatchProposal[]
): Promise<PlanAction[]> => {
  const actions: PlanAction[] = [];

  for (const patch of patches) {
    const absolutePath = resolve(projectRoot, patch.filePath);
    assertPathInside(projectRoot, absolutePath);

    const current = await readOldText(absolutePath);
    const zone = classifyPath(patch.filePath);

    if (zone === "generated") {
      actions.push({
        type: current.length === 0 ? "CREATE" : "OVERWRITE",
        path: absolutePath,
        entryType: "file",
        reason: patch.reason,
        safe: true,
        mode: zone,
        content: patch.newContent
      });
      continue;
    }

    actions.push({
      type: "PATCH",
      path: absolutePath,
      entryType: "file",
      reason: zone === "user" ? "user zone; manual merge required" : "unknown zone; review required",
      safe: true,
      mode: zone,
      patchText: makeUnifiedDiff({ oldText: current, newText: patch.newContent, filePath: patch.filePath })
    });
  }

  return actions;
};
