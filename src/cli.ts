/**
 * Run examples:
 * - `pnpm dev -- ./spec.json`
 * - `pnpm dev -- --spec ./spec.json`
 * - `pnpm dev -- /mnt/data/NaturalIntelligence__fast-xml-parser.json --out ./generated --plan`
 * - `pnpm dev -- /mnt/data/NaturalIntelligence__fast-xml-parser.json --out ./generated --apply`
 *
 * After scaffold generation:
 * - `cd <outDir>/<app-slug>`
 * - `pnpm install`
 * - `pnpm tauri dev`
 */
import process from "node:process";
import { ZodError } from "zod";
import { applyPlan } from "./generator/apply.js";
import { generateScaffold } from "./generator/scaffold/index.js";
import type { Plan, PlanActionType } from "./generator/types.js";
import { loadSpec } from "./spec/loadSpec.js";

type CliOptions = {
  specPath?: string;
  outDir?: string;
  plan: boolean;
  apply: boolean;
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

    if (arg === "--plan") {
      plan = true;
      continue;
    }

    if (arg === "--apply") {
      apply = true;
      continue;
    }

    if (!arg.startsWith("-") && !specPath) {
      specPath = arg;
    }
  }

  return { specPath, outDir, plan, apply };
};

const summarizePlan = (plan: Plan): Record<PlanActionType, number> => {
  const counts: Record<PlanActionType, number> = {
    CREATE: 0,
    OVERWRITE: 0,
    SKIP: 0,
    PATCH: 0
  };

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

  const skipped = sorted.filter((action) => action.type === "SKIP");
  if (skipped.length > 0) {
    console.log("Skipped items:");
    skipped.forEach((action) => {
      console.log(`- ${action.path}: ${action.reason}`);
    });
  }
};

const usage = (): void => {
  console.error("Usage:");
  console.error("- pnpm dev -- <spec.json>");
  console.error("- pnpm dev -- <spec.json> --out <dir> --plan");
  console.error("- pnpm dev -- <spec.json> --out <dir> --apply");
};

const main = async (): Promise<void> => {
  const args = process.argv.slice(2);
  const options = parseArgs(args);

  if (!options.specPath) {
    usage();
    process.exitCode = 1;
    return;
  }

  try {
    const ir = await loadSpec(options.specPath);
    console.log("Validation summary: OK");

    if (!options.outDir) {
      console.log(JSON.stringify(ir, null, 2));
      return;
    }

    const plan = await generateScaffold(ir, options.outDir);

    if (options.plan || !options.apply) {
      printPlan(plan);
    }

    await applyPlan(plan, { apply: options.apply });

    if (options.apply) {
      const counts = summarizePlan(plan);
      console.log(
        `Apply summary: wrote=${counts.CREATE + counts.OVERWRITE}, skipped=${counts.SKIP}, patched=${counts.PATCH}`
      );
    } else {
      console.log("Apply summary: dry-run (no files written). Use --apply to write files.");
    }
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
