import { existsSync, readFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { makeUnifiedDiff } from "./diff.js";
import { classifyPath, type Zone } from "./zones.js";
import type { PlanAction } from "./types.js";

const BASE64_PREFIX = "__BASE64__:";

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

const parseContent = (content: string): { encoding: "utf8" | "base64"; value: string } => {
  if (content.startsWith(BASE64_PREFIX)) {
    return {
      encoding: "base64",
      value: content.slice(BASE64_PREFIX.length).replace(/\s+/g, "")
    };
  }
  return {
    encoding: "utf8",
    value: normalizeNewlines(content)
  };
};

const currentContent = (path: string, encoding: "utf8" | "base64"): string => {
  if (encoding === "base64") {
    return readFileSync(path).toString("base64");
  }
  return normalizeNewlines(readFileSync(path, "utf8"));
};

const toStoredContent = (encoding: "utf8" | "base64", value: string): string =>
  encoding === "base64" ? `${BASE64_PREFIX}${value}` : value;

const createFileAction = (appDir: string, path: string, content: string): PlanAction => {
  const parsed = parseContent(content);
  const storedContent = toStoredContent(parsed.encoding, parsed.value);
  const relativePath = toPosixRelative(appDir, path);
  const zone = classifyPath(relativePath);

  if (!existsSync(path)) {
    return {
      type: "CREATE",
      path,
      entryType: "file",
      reason: "new file",
      content: storedContent,
      safe: zone !== "user",
      mode: zone
    };
  }

  const current = currentContent(path, parsed.encoding);
  const same = parsed.encoding === "base64" ? current === parsed.value : contentEqual(current, parsed.value);
  if (same) {
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
    const patchText =
      parsed.encoding === "base64"
        ? `--- a/${relativePath}\n+++ b/${relativePath}\n@@\n-<binary content>\n+<binary content updated (${parsed.value.length} base64 chars)>\n`
        : makeUnifiedDiff({ oldText: current, newText: parsed.value, filePath: relativePath });
    return {
      type: "PATCH",
      path,
      entryType: "file",
      reason: "user zone; manual merge required",
      patchText,
      safe: true,
      mode: zone
    };
  }

  return {
    type: "OVERWRITE",
    path,
    entryType: "file",
    reason: zone === "generated" ? "generated changed" : "unknown zone changed",
    content: storedContent,
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
