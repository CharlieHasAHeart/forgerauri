import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import { z } from "zod";
import { applyPlan } from "../../../generator/apply.js";
import { toPlanActionsFromPatches } from "../../../generator/patchToPlanActions.js";
import type { Plan } from "../../../generator/types.js";
import { getProviderFromEnv } from "../../../llm/index.js";
import type { LlmProvider } from "../../../llm/provider.js";
import { repairOnce } from "../repair/repairLoop.js";
import { runCmd, type CmdResult } from "../../../runner/runCmd.js";
import { loadSpec } from "../../../spec/loadSpec.js";
import { buildImplementPrompt } from "./prompt.js";
import { snapshotProject } from "./snapshot.js";
import type { ImplementRequest, ImplementResult, PatchFile } from "./types.js";

const truncate = (value: string, max = 50000): string => (value.length > max ? `${value.slice(0, max)}...<truncated>` : value);

const isSafeRelativePath = (projectRoot: string, filePath: string): boolean => {
  if (filePath.length === 0 || filePath.startsWith("/") || filePath.includes("\\")) {
    return false;
  }
  const target = resolve(projectRoot, filePath);
  const rel = relative(resolve(projectRoot), target);
  if (rel === ".." || rel.startsWith(`..${sep}`) || rel.split(sep).includes("..")) {
    return false;
  }
  return true;
};

const patchSchema = (maxPatches: number): z.ZodType<{ patches: PatchFile[] }> =>
  z.object({
    patches: z
      .array(
        z.object({
          filePath: z.string().min(1),
          newContent: z.string(),
          reason: z.string().min(1)
        })
      )
      .max(maxPatches)
  });

const createActions = async (projectRoot: string, patches: PatchFile[]) => {
  for (const patch of patches) {
    if (!isSafeRelativePath(projectRoot, patch.filePath)) {
      throw new Error(`Invalid patch path: ${patch.filePath}`);
    }
  }
  return toPlanActionsFromPatches(projectRoot, patches);
};

const readPackageScripts = async (projectRoot: string): Promise<Record<string, unknown>> => {
  try {
    const text = await readFile(join(projectRoot, "package.json"), "utf8");
    const json = JSON.parse(text) as { scripts?: Record<string, unknown> };
    return json.scripts ?? {};
  } catch {
    return {};
  }
};

const runVerify = async (
  projectRoot: string,
  runImpl: (cmd: string, args: string[], cwd: string) => Promise<CmdResult>
): Promise<CmdResult> => {
  const scripts = await readPackageScripts(projectRoot);

  if (typeof scripts.test === "string") {
    const testResult = await runImpl("pnpm", ["-C", projectRoot, "test"], projectRoot);
    if (testResult.ok) return testResult;
    if (!/missing script|ERR_PNPM_NO_SCRIPT|None of the selected packages has a "test" script/i.test(testResult.stderr)) {
      return testResult;
    }
  }

  if (typeof scripts.build === "string") {
    return runImpl("pnpm", ["-C", projectRoot, "build"], projectRoot);
  }

  const tauriRoot = join(projectRoot, "src-tauri");
  if (existsSync(tauriRoot)) {
    return runImpl("cargo", ["check"], tauriRoot);
  }

  return {
    ok: true,
    code: 0,
    stdout: "verify skipped: no test/build script and no src-tauri",
    stderr: ""
  };
};

const nextAuditCounter = async (logsDir: string): Promise<number> => {
  try {
    const files = await readdir(logsDir);
    const nums = files
      .map((name) => {
        const m = name.match(/^(\d+)\.json$/);
        return m ? Number(m[1]) : -1;
      })
      .filter((num) => num >= 0);
    if (nums.length === 0) return 1;
    return Math.max(...nums) + 1;
  } catch {
    return 1;
  }
};

const writeAudit = async (projectRoot: string, payload: unknown): Promise<string> => {
  const logsDir = join(projectRoot, "generated/llm_logs");
  await mkdir(logsDir, { recursive: true });
  const next = await nextAuditCounter(logsDir);
  const filePath = join(logsDir, `${String(next).padStart(4, "0")}.json`);
  await writeFile(filePath, JSON.stringify(payload, null, 2), "utf8");
  return filePath;
};

export const implementOnce = async (
  args: ImplementRequest & {
    apply: boolean;
    verify: boolean;
    repair: boolean;
    provider?: LlmProvider;
    runImpl?: (cmd: string, argv: string[], cwd: string) => Promise<CmdResult>;
  }
): Promise<ImplementResult> => {
  if (args.maxPatches <= 0 || args.maxPatches > 8) {
    throw new Error("maxPatches must be between 1 and 8");
  }

  const provider = args.provider ?? getProviderFromEnv();
  const runImpl = args.runImpl ?? runCmd;

  const projectRoot = resolve(args.projectRoot);
  const ir = await loadSpec(args.specPath);
  const snapshot = await snapshotProject(projectRoot, args.target);
  const messages = buildImplementPrompt({ target: args.target, ir, snapshot, maxPatches: args.maxPatches });

  const { data, raw, attempts } = await provider.completeJSON(messages, patchSchema(args.maxPatches), {
    temperature: 0,
    maxOutputTokens: 6000
  });

  const actions = await createActions(projectRoot, data.patches);
  const plan: Plan = {
    outDir: projectRoot,
    appDir: projectRoot,
    actions
  };

  const changedPaths = data.patches.map((patch) => patch.filePath);
  let patchPaths: string[] = [];

  if (args.apply) {
    const applied = await applyPlan(plan, { apply: true });
    patchPaths = applied.patchFiles;
  }

  let verify: ImplementResult["verify"] | undefined;
  let repairSummary: string | undefined;

  if (args.verify) {
    let first = await runVerify(projectRoot, runImpl);

    if (!first.ok && args.repair) {
      const repair = await repairOnce({
        projectRoot,
        cmd: "pnpm",
        args: ["-C", projectRoot, "test"],
        provider,
        budget: { maxPatches: 5 },
        apply: args.apply,
        runImpl
      });
      if (repair.patchPaths && repair.patchPaths.length > 0) {
        patchPaths = Array.from(new Set([...patchPaths, ...repair.patchPaths]));
      }
      repairSummary = repair.summary;
      first = await runVerify(projectRoot, runImpl);
    }

    verify = {
      ok: first.ok,
      code: first.code,
      stdout: first.stdout,
      stderr: first.stderr
    };
  }

  const actionSummary = actions.map((action) => ({ type: action.type, path: action.path, reason: action.reason }));
  await writeAudit(projectRoot, {
    kind: "implement_once",
    target: args.target,
    modelProvider: provider.name,
    input: {
      specPath: args.specPath,
      maxPatches: args.maxPatches,
      apply: args.apply,
      verify: args.verify,
      repair: args.repair
    },
    snapshot: {
      totalChars: snapshot.totalChars,
      truncated: snapshot.truncated,
      fileCount: snapshot.files.length,
      files: snapshot.files.map((file) => ({ path: file.path, truncated: file.truncated, size: file.content.length }))
    },
    llm: {
      attempts,
      raw: truncate(raw)
    },
    actions: actionSummary,
    changedPaths,
    patchPaths,
    verify,
    repairSummary
  });

  const verifyFailed = Boolean(verify && !verify.ok);
  const ok = !verifyFailed;

  const summary = verifyFailed
    ? "implementation applied but verify failed; inspect stderr and patches"
    : args.apply
      ? "implementation applied successfully"
      : "plan generated (dry-run)";

  return {
    ok,
    applied: args.apply,
    patchPaths,
    changedPaths,
    summary,
    verify
  };
};
