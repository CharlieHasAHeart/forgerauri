import { existsSync, readFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { makeUnifiedDiff } from "./diff.js";
import { classifyPath, type Zone } from "./zones.js";
import type { PlanAction } from "./types.js";

export const normalizeNewlines = (text: string): string => text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

export const contentEqual = (left: string, right: string): boolean => normalizeNewlines(left) === normalizeNewlines(right);

const toPosixRelative = (root: string, absolute: string): string => relative(root, absolute).split(sep).join("/");

const createDirAction = (path: string, exists: boolean): PlanAction => ({
  type: exists ? "SKIP" : "CREATE",
  path,
  entryType: "dir",
  reason: exists ? "directory exists" : "new directory",
  safe: true,
  mode: "generated"
});

const createFileAction = (appDir: string, path: string, content: string): PlanAction => {
  const normalizedContent = normalizeNewlines(content);
  const relativePath = toPosixRelative(appDir, path);
  const zone = classifyPath(relativePath);

  if (!existsSync(path)) {
    return {
      type: "CREATE",
      path,
      entryType: "file",
      reason: "new file",
      content: normalizedContent,
      safe: zone !== "user",
      mode: zone
    };
  }

  const current = normalizeNewlines(readFileSync(path, "utf8"));
  if (contentEqual(current, normalizedContent)) {
    return {
      type: "SKIP",
      path,
      entryType: "file",
      reason: "unchanged",
      safe: true,
      mode: zone
    };
  }

  if (zone === "user") {
    return {
      type: "PATCH",
      path,
      entryType: "file",
      reason: "user zone; manual merge required",
      patchText: makeUnifiedDiff({ oldText: current, newText: normalizedContent, filePath: relativePath }),
      safe: true,
      mode: zone
    };
  }

  return {
    type: "OVERWRITE",
    path,
    entryType: "file",
    reason: zone === "generated" ? "generated changed" : "unknown zone changed",
    content: normalizedContent,
    safe: true,
    mode: zone
  };
};

export const buildActionsForFiles = (appDir: string, files: Record<string, string>): PlanAction[] => {
  const dirCandidates = [appDir];
  Object.keys(files).forEach((relativePath) => {
    dirCandidates.push(join(appDir, dirname(relativePath)));
  });

  const actions: PlanAction[] = [];
  Array.from(new Set(dirCandidates))
    .sort((a, b) => a.localeCompare(b))
    .forEach((dirPath) => {
      actions.push(createDirAction(dirPath, existsSync(dirPath)));
    });

  Object.entries(files)
    .sort(([left], [right]) => left.localeCompare(right))
    .forEach(([relativePath, content]) => {
      actions.push(createFileAction(appDir, join(appDir, relativePath), content));
    });

  return actions;
};
