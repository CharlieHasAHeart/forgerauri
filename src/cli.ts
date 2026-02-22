/**
 * Run examples:
 * - `pnpm dev -- ./spec.json`
 * - `pnpm dev -- --spec ./spec.json`
 * - `pnpm dev -- /mnt/data/NaturalIntelligence__fast-xml-parser.json --out ./generated --plan`
 * - `pnpm dev -- /mnt/data/NaturalIntelligence__fast-xml-parser.json --out ./generated --apply`
 * - `pnpm dev -- /mnt/data/NaturalIntelligence__fast-xml-parser.json --out ./generated --plan --use-langgraph`
 * - `pnpm dev -- /mnt/data/NaturalIntelligence__fast-xml-parser.json --out ./generated --apply --verify --repair --use-langgraph`
 * - `pnpm dev -- /mnt/data/agent-sh__agnix.json --out ./generated --apply`
 *
 * LLM enrich:
 * - `OPENAI_API_KEY=... OPENAI_MODEL=... pnpm dev -- /mnt/data/agent-sh__agnix.json --out ./generated --apply --llm-enrich-spec`
 *
 * Repair:
 * - `OPENAI_API_KEY=... OPENAI_MODEL=... pnpm dev --repair --project ./generated/<appSlug> --cmd pnpm --args "tauri,dev" --apply`
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
import { getProviderFromEnv } from "./llm/index.js";
import { repairOnce } from "./repair/repairLoop.js";
import { enrichWireSpecWithLLM } from "./spec/enrichWithLLM.js";
import { loadSpec, parseSpecFromRaw } from "./spec/loadSpec.js";
import { runGraphWithOptions } from "./workflow/runGraph.js";

type CliOptions = {
  specPath?: string;
  outDir?: string;
  plan: boolean;
  apply: boolean;
  llmEnrichSpec: boolean;
  verify: boolean;
  useLanggraph: boolean;
  repair: boolean;
  project?: string;
  cmd?: string;
  cmdArgs: string[];
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
  let plan = false;
  let apply = false;
  let llmEnrichSpec = false;
  let verify = false;
  let useLanggraph = false;
  let repair = false;
  let project: string | undefined;
  let cmd: string | undefined;
  let cmdArgs: string[] = [];

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
    if (arg === "--project") {
      project = argv[i + 1];
      i += 1;
      continue;
    }
    if (arg === "--cmd") {
      cmd = argv[i + 1];
      i += 1;
      continue;
    }
    if (arg === "--args") {
      const raw = argv[i + 1] ?? "";
      cmdArgs = raw
        .split(",")
        .map((part) => part.trim())
        .filter((part) => part.length > 0);
      i += 1;
      continue;
    }
    if (arg === "--plan") {
      plan = true;
      continue;
    }
    if (arg === "--apply") {
      apply = true;
      continue;
    }
    if (arg === "--llm-enrich-spec") {
      llmEnrichSpec = true;
      continue;
    }
    if (arg === "--verify") {
      verify = true;
      continue;
    }
    if (arg === "--use-langgraph") {
      useLanggraph = true;
      continue;
    }
    if (arg === "--repair") {
      repair = true;
      continue;
    }

    if (!arg.startsWith("-") && !specPath) {
      specPath = arg;
    }
  }

  return { specPath, outDir, plan, apply, llmEnrichSpec, verify, useLanggraph, repair, project, cmd, cmdArgs };
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
  console.error("- pnpm dev -- <spec.json>");
  console.error("- pnpm dev -- <spec.json> --out <dir> --plan");
  console.error("- pnpm dev -- <spec.json> --out <dir> --apply");
  console.error("- pnpm dev -- <spec.json> --out <dir> --apply --verify --repair --use-langgraph");
  console.error("- pnpm dev --repair --project <path> --cmd <cmd> --args \"a,b,c\" --apply");
};

const runRepair = async (options: CliOptions): Promise<void> => {
  if (!options.project || !options.cmd) {
    throw new Error("--repair requires --project and --cmd");
  }

  const provider = getProviderFromEnv();
  const result = await repairOnce({
    projectRoot: options.project,
    cmd: options.cmd,
    args: options.cmdArgs,
    provider,
    apply: options.apply
  });

  console.log(`Repair result: ${result.ok ? "ok" : "failed"}`);
  console.log(result.summary);
  if (result.patchPaths && result.patchPaths.length > 0) {
    console.log("Patch files:");
    result.patchPaths.forEach((path) => console.log(`- ${path}`));
  }
};

const runGenerate = async (options: CliOptions): Promise<void> => {
  if (!options.specPath) {
    usage();
    process.exitCode = 1;
    return;
  }

  let ir;

  if (options.llmEnrichSpec) {
    const rawText = await readFile(options.specPath, "utf8");
    const rawJson = JSON.parse(rawText) as unknown;

    try {
      const provider = getProviderFromEnv();
      const enriched = await enrichWireSpecWithLLM({ wire: rawJson, provider });
      ir = parseSpecFromRaw(enriched.wireEnriched);
      console.log(`Spec enrich: used=${enriched.used}`);
    } catch (error) {
      ir = parseSpecFromRaw(rawJson);
      console.log("Spec enrich: used=false (fallback to deterministic parse)");
      if (error instanceof Error) {
        console.log(`Spec enrich note: ${error.message}`);
      }
    }
  } else {
    ir = await loadSpec(options.specPath);
  }

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
    if (options.useLanggraph) {
      const result = await runGraphWithOptions({
        specPath: options.specPath,
        outDir: options.outDir,
        plan: options.plan,
        apply: options.apply,
        llmEnrichSpec: options.llmEnrichSpec,
        verify: options.verify,
        repair: options.repair
      });
      process.exitCode = result.code;
      return;
    }

    if (options.repair) {
      await runRepair(options);
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
