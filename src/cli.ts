/**
 * Run examples:
 * - `pnpm dev --agent --goal "Generate and run the app" --spec ./spec.json --out ./generated --apply --verify --repair`
 * - `pnpm dev --agent --goal "Generate and run the app, ensure DB health check works" --spec /mnt/data/agent-sh__agnix.json --out ./generated --apply --verify --repair`
 * - `pnpm dev --agent --goal "Improve UI: better layout, loading states, error banners" --spec /mnt/data/agent-sh__agnix.json --out ./generated --apply --verify --repair`
 * - `pnpm dev --agent --goal "Implement real lint_config logic and persist results" --spec /mnt/data/agent-sh__agnix.json --out ./generated --apply --verify --repair`
 * - `pnpm dev --agent --goal "Desktop-ready strict validation" --spec /mnt/data/agent-sh__agnix.json --out ./generated --apply --verify --repair`
 *
 * DashScope env:
 * - `export DASHSCOPE_API_KEY=...`
 * - `export DASHSCOPE_BASE_URL=https://dashscope-intl.aliyuncs.com/api/v2/apps/protocols/compatible-mode/v1`
 * - `export DASHSCOPE_MODEL=qwen3-max-2026-01-23`
 *
 * Agent mode is the only supported external workflow.
 */
import { createInterface } from "node:readline/promises";
import { readFile } from "node:fs/promises";
import process from "node:process";
import { ZodError } from "zod";
import { loadEnvFile } from "./config/loadEnv.js";
import { runAgent } from "./agent/runtime.js";
import type { AgentPolicy } from "./agent/policy.js";

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
  repair: boolean;
  repairSpecified: boolean;
  autoApprove: boolean;
  maxTurns: number;
  maxPatches: number;
  policyInput?: string;
  truncation: "auto" | "disabled";
  compactionThreshold?: number;
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
  let repair = false;
  let repairSpecified = false;
  let autoApprove = false;
  let maxTurns = 8;
  let maxPatches = 6;
  let policyInput: string | undefined;
  let truncation: "auto" | "disabled" = "auto";
  let compactionThreshold: number | undefined;

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
    if (arg === "--max-patches") {
      const raw = Number(argv[i + 1]);
      const parsed = Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 6;
      maxPatches = Math.min(8, parsed);
      i += 1;
      continue;
    }
    if (arg === "--truncation") {
      const value = argv[i + 1];
      truncation = value === "disabled" ? "disabled" : "auto";
      i += 1;
      continue;
    }
    if (arg === "--policy") {
      policyInput = argv[i + 1];
      i += 1;
      continue;
    }
    if (arg === "--compaction-threshold") {
      const raw = Number(argv[i + 1]);
      if (Number.isFinite(raw) && raw > 0) {
        compactionThreshold = Math.floor(raw);
      }
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
    if (arg === "--auto-approve") {
      autoApprove = true;
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
    repair,
    repairSpecified,
    autoApprove,
    maxTurns,
    maxPatches,
    policyInput,
    truncation,
    compactionThreshold
  };
};

const usage = (): void => {
  console.error("Usage:");
  console.error("- pnpm dev --agent --goal \"...\" --spec <path> --out <dir> [--policy <json-or-path>] [--plan] [--apply] [--verify] [--repair] [--auto-approve] [--max-turns N] [--max-patches N] [--truncation auto|disabled] [--compaction-threshold N]");
};

const parsePolicy = async (input?: string): Promise<AgentPolicy | undefined> => {
  if (!input) return undefined;
  const trimmed = input.trim();
  const raw = trimmed.startsWith("{") ? trimmed : await readFile(trimmed, "utf8");
  return JSON.parse(raw) as AgentPolicy;
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
  const policy = await parsePolicy(options.policyInput);

  const humanReview = options.autoApprove
    ? undefined
    : async (args: { reason: string; patchPaths: string[]; phase: string }): Promise<boolean> => {
        if (!process.stdin.isTTY || !process.stdout.isTTY) {
          throw new Error("Human review required but no TTY available. Re-run with --auto-approve.");
        }
        console.log(`Human review required at phase=${args.phase}: ${args.reason}`);
        args.patchPaths.forEach((path) => console.log(`- ${path}`));
        const rl = createInterface({ input: process.stdin, output: process.stdout });
        try {
          const answer = (await rl.question("Continue automatic flow? [y/N] ")).trim().toLowerCase();
          return answer === "y" || answer === "yes";
        } finally {
          rl.close();
        }
      };

  const result = await runAgent({
    goal: options.goal,
    specPath: options.specPath,
    outDir: options.outDir,
    apply: finalApply,
    verify: finalVerify,
    repair: finalRepair,
    maxTurns: options.maxTurns,
    maxPatches: options.maxPatches,
    policy,
    truncation: options.truncation,
    compactionThreshold: options.compactionThreshold,
    humanReview
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

const main = async (): Promise<void> => {
  loadEnvFile();
  const options = parseArgs(process.argv.slice(2));

  try {
    if (!options.agent) {
      usage();
      process.exitCode = 1;
      return;
    }
    await runAgentMode(options);
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
