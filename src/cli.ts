/**
 * Run examples:
 * - `pnpm dev -- ./spec.json`
 * - `pnpm dev -- --spec ./spec.json`
 * - `pnpm dev -- /mnt/data/NaturalIntelligence__fast-xml-parser.json --out ./generated --plan`
 * - `pnpm dev -- /mnt/data/NaturalIntelligence__fast-xml-parser.json --out ./generated --apply`
 * - `pnpm dev -- /mnt/data/agent-sh__agnix.json --out ./generated --apply`
 * - `pnpm dev --agent --goal "Generate and run the app, ensure DB health check works" --spec /mnt/data/agent-sh__agnix.json --out ./generated --apply --verify --repair`
 * - `pnpm dev --agent --goal "Improve UI: better layout, loading states, error banners" --spec /mnt/data/agent-sh__agnix.json --out ./generated --apply --verify --repair`
 * - `pnpm dev --agent --goal "Implement real lint_config logic and persist results" --spec /mnt/data/agent-sh__agnix.json --out ./generated --apply --verify --repair`
 * - `pnpm dev --agent --goal "Desktop-ready strict validation" --spec /mnt/data/agent-sh__agnix.json --out ./generated --apply --verify --verify-level full --repair`
 *
 * DashScope env:
 * - `export DASHSCOPE_API_KEY=...`
 * - `export DASHSCOPE_BASE_URL=https://dashscope-intl.aliyuncs.com/api/v2/apps/protocols/compatible-mode/v1`
 * - `export DASHSCOPE_MODEL=qwen3-max-2026-01-23`
 *
 * LLM enrich is mandatory in current pipeline:
 * - `DASHSCOPE_API_KEY=... pnpm dev -- /mnt/data/agent-sh__agnix.json --out ./generated --apply`
 *
 * After scaffold generation:
 * - `cd <outDir>/<app-slug>`
 * - `pnpm install`
 * - `pnpm tauri dev`
 * - In the app window, switch Screens navigation and use action Run to execute lint_config/apply_fixes.
 * - Then run list_lint_runs/list_fix_runs from action command selector to verify DB history increases.
 */
import { readFile } from "node:fs/promises";
import process from "node:process";
import { ZodError } from "zod";
import { loadEnvFile } from "./config/loadEnv.js";
import { applyPlan } from "./generator/apply.js";
import { generateScaffold } from "./generator/scaffold/index.js";
import type { Plan, PlanActionType } from "./generator/types.js";
import { runAgent } from "./agent/runtime.js";
import { getProviderFromEnv } from "./llm/index.js";
import { enrichWireSpecWithLLM } from "./spec/enrichWithLLM.js";
import { loadSpec, parseSpecFromRaw } from "./spec/loadSpec.js";

type CliOptions = {
  specPath?: string;
  outDir?: string;
  agent: boolean;
  goal?: string;
  plan: boolean;
  apply: boolean;
  applySpecified: boolean;
  verify: boolean;
  verifySpecified: boolean;
  verifyLevel: "basic" | "full";
  repair: boolean;
  repairSpecified: boolean;
  maxTurns: number;
  maxPatches: number;
};

const printValidationErrors = (error: ZodError): void => {
  console.error("Spec validation failed:");
  error.issues.forEach((issue) => {
    const path = issue.path.length > 0 ? issue.path.join(".") : "<root>";
    console.error(`- ${path}: ${issue.message}`);
  });
};

const parseArgs = (argv: string[]): CliOptions => {
  let specPath: string | undefined;
  let outDir: string | undefined;
  let agent = false;
  let goal: string | undefined;
  let plan = false;
  let apply = false;
  let applySpecified = false;
  let verify = false;
  let verifySpecified = false;
  let verifyLevel: "basic" | "full" = "basic";
  let repair = false;
  let repairSpecified = false;
  let maxTurns = 8;
  let maxPatches = 6;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];

    if (arg === "--spec") {
      specPath = argv[i + 1];
      i += 1;
      continue;
    }
    if (arg === "--out") {
      outDir = argv[i + 1];
      i += 1;
      continue;
    }
    if (arg === "--goal") {
      goal = argv[i + 1];
      i += 1;
      continue;
    }
    if (arg === "--max-turns") {
      const raw = Number(argv[i + 1]);
      const parsed = Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 8;
      maxTurns = Math.max(1, parsed);
      i += 1;
      continue;
    }
    if (arg === "--verify-level") {
      const raw = (argv[i + 1] ?? "basic").toLowerCase();
      verifyLevel = raw === "full" ? "full" : "basic";
      i += 1;
      continue;
    }
    if (arg === "--max-patches") {
      const raw = Number(argv[i + 1]);
      const parsed = Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 6;
      maxPatches = Math.min(8, parsed);
      i += 1;
      continue;
    }
    if (arg === "--plan") {
      plan = true;
      continue;
    }
    if (arg === "--agent") {
      agent = true;
      continue;
    }
    if (arg === "--apply") {
      apply = true;
      applySpecified = true;
      continue;
    }
    if (arg === "--verify") {
      verify = true;
      verifySpecified = true;
      continue;
    }
    if (arg === "--repair") {
      repair = true;
      repairSpecified = true;
      continue;
    }

    if (!arg.startsWith("-") && !specPath) {
      specPath = arg;
    }
  }

  return {
    specPath,
    outDir,
    agent,
    goal,
    plan,
    apply,
    applySpecified,
    verify,
    verifySpecified,
    verifyLevel,
    repair,
    repairSpecified,
    maxTurns,
    maxPatches,
  };
};

const summarizePlan = (plan: Plan): Record<PlanActionType, number> => {
  const counts: Record<PlanActionType, number> = { CREATE: 0, OVERWRITE: 0, SKIP: 0, PATCH: 0 };
  plan.actions.forEach((action) => {
    counts[action.type] += 1;
  });
  return counts;
};

const printPlan = (plan: Plan): void => {
  const sorted = [...plan.actions].sort((left, right) => left.path.localeCompare(right.path));
  console.log(`Plan for: ${plan.appDir}`);
  sorted.forEach((action) => {
    console.log(`${action.type.padEnd(9)} ${action.path} (${action.reason})`);
  });

  const counts = summarizePlan(plan);
  console.log(
    `Plan summary: create=${counts.CREATE}, overwrite=${counts.OVERWRITE}, patch=${counts.PATCH}, skip=${counts.SKIP}`
  );

  const patchTargets = sorted.filter((action) => action.type === "PATCH");
  if (patchTargets.length > 0) {
    console.log("Patch targets:");
    patchTargets.forEach((action) => {
      console.log(`- ${action.path}`);
    });
    console.log("Manual merge required for user-zone files.");
  }
};

const usage = (): void => {
  console.error("Usage:");
  console.error("- Recommended: pnpm dev --agent --goal \"...\" --spec <path> --out <dir> [--plan] [--apply] [--verify] [--verify-level basic|full] [--repair] [--max-turns N] [--max-patches N]");
  console.error("- Optional basic scaffold: pnpm dev -- <spec.json> --out <dir> --plan|--apply");
};

const runAgentMode = async (options: CliOptions): Promise<void> => {
  if (!options.goal || !options.specPath || !options.outDir) {
    throw new Error("--agent requires --goal, --spec and --out");
  }

  const apply = options.applySpecified ? options.apply : true;
  const verify = options.verifySpecified ? options.verify : true;
  const repair = options.repairSpecified ? options.repair : true;
  const finalApply = options.plan ? false : apply;
  const finalVerify = options.plan ? false : verify;
  const finalRepair = options.plan ? false : repair;

  const result = await runAgent({
    goal: options.goal,
    specPath: options.specPath,
    outDir: options.outDir,
    apply: finalApply,
    verify: finalVerify,
    repair: finalRepair,
    verifyLevel: options.verifyLevel,
    maxTurns: options.maxTurns,
    maxPatches: options.maxPatches
  });

  console.log(`Agent result: ${result.ok ? "ok" : "failed"}`);
  console.log(result.summary);
  if (result.auditPath) {
    console.log(`Audit log: ${result.auditPath}`);
  }
  if (result.patchPaths && result.patchPaths.length > 0) {
    console.log("Patch files:");
    result.patchPaths.forEach((path) => console.log(`- ${path}`));
  }

  process.exitCode = result.ok ? 0 : 1;
};

const runGenerate = async (options: CliOptions): Promise<void> => {
  if (!options.specPath) {
    usage();
    process.exitCode = 1;
    return;
  }

  await loadSpec(options.specPath);
  const rawText = await readFile(options.specPath, "utf8");
  const rawJson = JSON.parse(rawText) as unknown;
  const provider = getProviderFromEnv();
  const enriched = await enrichWireSpecWithLLM({ wire: rawJson, provider });
  const ir = parseSpecFromRaw(enriched.wireEnriched);
  console.log(`Spec enrich: used=${enriched.used}`);

  console.log("Validation summary: OK");

  if (!options.outDir) {
    console.log(JSON.stringify(ir, null, 2));
    return;
  }

  const plan = await generateScaffold(ir, options.outDir);
  if (options.plan || !options.apply) {
    printPlan(plan);
  }

  const applied = await applyPlan(plan, { apply: options.apply });
  if (options.apply) {
    const counts = summarizePlan(plan);
    console.log(`Apply summary: wrote=${counts.CREATE + counts.OVERWRITE}, skipped=${counts.SKIP}, patched=${counts.PATCH}`);
    if (applied.patchFiles.length > 0) {
      console.log("Patch files:");
      applied.patchFiles.forEach((patchPath) => console.log(`- ${patchPath}`));
      console.log("Manual merge required for user-zone files listed in patch files.");
    }
  } else {
    console.log("Apply summary: dry-run (no files written). Use --apply to write files.");
  }
};

const main = async (): Promise<void> => {
  loadEnvFile();
  const options = parseArgs(process.argv.slice(2));

  try {
    if (options.agent) {
      await runAgentMode(options);
      return;
    }

    await runGenerate(options);
  } catch (error) {
    if (error instanceof ZodError) {
      printValidationErrors(error);
      process.exitCode = 1;
      return;
    }

    if (error instanceof Error) {
      console.error(error.message);
      process.exitCode = 2;
      return;
    }

    console.error("Unknown error");
    process.exitCode = 2;
  }
};

void main();
