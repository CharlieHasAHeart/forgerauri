import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { ImplementTarget } from "./types.js";

export type SnapshotFile = {
  path: string;
  content: string;
  truncated: boolean;
};

export type ProjectSnapshot = {
  files: SnapshotFile[];
  totalChars: number;
  truncated: boolean;
};

const readMaybe = async (projectRoot: string, relativePath: string): Promise<string | null> => {
  try {
    return await readFile(join(projectRoot, relativePath), "utf8");
  } catch {
    return null;
  }
};

const targetFiles = (target: ImplementTarget): string[] => {
  if (target.kind === "ui") {
    return [
      "src/lib/components/generated/ActionRunner.svelte",
      "src/lib/components/generated/FieldForm.svelte",
      "src/lib/screens/generated/index.ts"
    ];
  }

  if (target.kind === "business") {
    return [
      "src-tauri/src/db/lint_repo.rs",
      "src-tauri/src/db/fix_repo.rs",
      "src-tauri/src/services/lint_service.rs",
      "src-tauri/src/services/fix_service.rs",
      "src-tauri/migrations/0004_business.sql"
    ];
  }

  return [
    `src-tauri/src/commands/generated/${target.name}.rs`,
    `src-tauri/src/models/generated/${target.name}.rs`,
    `src-tauri/src/services/generated/${target.name}.rs`
  ];
};

export const snapshotProject = async (
  projectRoot: string,
  target: ImplementTarget,
  maxChars = 120000
): Promise<ProjectSnapshot> => {
  const baseFiles = [
    "src/lib/generated/AppShell.svelte",
    "src/lib/screens/generated/index.ts",
    "src/lib/api/generated/commands.ts",
    "src/App.svelte",
    "src-tauri/src/main.rs"
  ];

  const ordered = Array.from(new Set([...baseFiles, ...targetFiles(target)])).sort((a, b) => a.localeCompare(b));

  const files: SnapshotFile[] = [];
  let totalChars = 0;
  let truncated = false;

  for (const path of ordered) {
    const content = await readMaybe(projectRoot, path);
    if (content == null) continue;

    if (totalChars >= maxChars) {
      truncated = true;
      break;
    }

    const remain = maxChars - totalChars;
    if (content.length <= remain) {
      files.push({ path, content, truncated: false });
      totalChars += content.length;
    } else {
      files.push({ path, content: `${content.slice(0, remain)}\n/* ...truncated... */\n`, truncated: true });
      totalChars += remain;
      truncated = true;
      break;
    }
  }

  return { files, totalChars, truncated };
};
