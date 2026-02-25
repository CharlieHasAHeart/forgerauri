import { readFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { applyPlan } from "../generator/apply.js";
import { makeUnifiedDiff } from "../generator/diff.js";
import type { Plan, PlanAction } from "../generator/types.js";
import { classifyPath } from "../generator/zones.js";
import type { LlmProvider } from "../llm/provider.js";
import { runCmd, type CmdResult } from "../runner/runCmd.js";
import { AuditCollector } from "../runtime/audit.js";
import { assertCommandAllowed, assertCwdInside, assertPatchBudget, assertPathInside } from "../runtime/policy.js";
import type { RuntimeResult } from "../runtime/types.js";
import { proposeRepairsWithLLM } from "./proposeRepairsWithLLM.js";

type RunImpl = (cmd: string, args: string[], cwd: string) => Promise<CmdResult>;

const extractPathsFromStderr = (stderr: string): string[] => {
  const regex = /([A-Za-z0-9_./-]+\.(?:ts|tsx|js|svelte|rs|toml|json))/g;
  const found = new Set<string>();
  let match: RegExpExecArray | null = regex.exec(stderr);
  while (match) {
    found.add(match[1]);
    match = regex.exec(stderr);
  }
  return Array.from(found).slice(0, 10);
};

const readSnapshot = async (projectRoot: string, relativePaths: string[]): Promise<Array<{ path: string; content: string }>> => {
  const snapshot: Array<{ path: string; content: string }> = [];

  for (const rel of relativePaths) {
    try {
      const abs = resolve(projectRoot, rel);
      assertPathInside(projectRoot, abs);
      const content = await readFile(abs, "utf8");
      snapshot.push({ path: rel, content });
    } catch {
      continue;
    }
  }

  return snapshot;
};

const toPlanActions = async (
  projectRoot: string,
  patches: Array<{ filePath: string; newContent: string; reason: string }>
): Promise<PlanAction[]> => {
  const actions: PlanAction[] = [];

  for (const patch of patches) {
    const absolute = resolve(projectRoot, patch.filePath);
    assertPathInside(projectRoot, absolute);

    const zone = classifyPath(patch.filePath);
    let oldText = "";
    try {
      oldText = await readFile(absolute, "utf8");
    } catch {
      oldText = "";
    }

    if (zone === "generated") {
      actions.push({
        type: oldText.length === 0 ? "CREATE" : "OVERWRITE",
        path: absolute,
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
      path: absolute,
      entryType: "file",
      reason: zone === "user" ? "user zone; manual merge required" : "unknown zone; review required",
      safe: true,
      mode: zone,
      patchText: makeUnifiedDiff({ oldText, newText: patch.newContent, filePath: patch.filePath })
    });
  }

  return actions;
};

export const repairOnce = async (args: {
  projectRoot: string;
  cmd: string;
  args: string[];
  provider: LlmProvider;
  budget?: { maxPatches: number };
  apply?: boolean;
  runImpl?: RunImpl;
}): Promise<RuntimeResult> => {
  const audit = new AuditCollector();
  const run = args.runImpl ?? runCmd;
  const maxPatches = args.budget?.maxPatches ?? 5;
  const safeRun = (cmd: string, argv: string[], cwd: string): Promise<CmdResult> => {
    assertCommandAllowed(cmd);
    assertCwdInside(args.projectRoot, cwd);
    return run(cmd, argv, cwd);
  };

  const first = await safeRun(args.cmd, args.args, args.projectRoot);
  audit.record("run", { phase: "initial", result: first });

  if (first.ok) {
    await audit.flush(args.projectRoot);
    return { ok: true, summary: "command succeeded; no repair needed", audit: audit.all() };
  }

  const derivedPaths = extractPathsFromStderr(`${first.stdout}\n${first.stderr}`);
  const seedPaths = ["src/lib/generated/AppShell.svelte", "src/App.svelte", "src-tauri/src/lib.rs", ...derivedPaths];
  const snapshot = await readSnapshot(args.projectRoot, seedPaths);

  const proposed = await proposeRepairsWithLLM({
    projectRoot: args.projectRoot,
    command: `${args.cmd} ${args.args.join(" ")}`,
    stdout: first.stdout,
    stderr: first.stderr,
    filesSnapshot: snapshot,
    provider: args.provider
  });
  audit.record("llm_call", { raw: proposed.raw, count: proposed.patches.length });

  assertPatchBudget(proposed.patches.length, maxPatches);

  const actions = await toPlanActions(args.projectRoot, proposed.patches);
  const plan: Plan = {
    outDir: args.projectRoot,
    appDir: args.projectRoot,
    actions
  };

  audit.record("plan", { actions: actions.map((a) => ({ type: a.type, path: a.path, reason: a.reason })) });
  const applyRes = await applyPlan(plan, { apply: args.apply ?? true });
  audit.record("apply", applyRes);

  const second = await safeRun(args.cmd, args.args, args.projectRoot);
  audit.record("run", { phase: "verify", result: second });

  await audit.flush(args.projectRoot);

  return {
    ok: second.ok,
    summary: second.ok ? "repair succeeded" : "repair attempted but command still failing",
    audit: audit.all(),
    patchPaths: applyRes.patchFiles
  };
};
