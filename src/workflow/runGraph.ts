import process from "node:process";
import { loadEnvFile } from "../config/loadEnv.js";
import { invokeGraph } from "./graph.js";
import { createInitialState, type WorkflowFlags, type WorkflowState } from "./state.js";

export type WorkflowCliOptions = {
  specPath?: string;
  outDir?: string;
  plan: boolean;
  apply: boolean;
  llmEnrichSpec: boolean;
  verify: boolean;
  repair: boolean;
};

export const parseWorkflowArgs = (argv: string[]): WorkflowCliOptions => {
  let specPath: string | undefined;
  let outDir: string | undefined;
  let plan = false;
  let apply = false;
  let llmEnrichSpec = false;
  let verify = false;
  let repair = false;

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
    if (arg === "--llm-enrich-spec") {
      llmEnrichSpec = true;
      continue;
    }
    if (arg === "--verify") {
      verify = true;
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

  return {
    specPath,
    outDir,
    plan,
    apply,
    llmEnrichSpec,
    verify,
    repair
  };
};

const printSummary = (state: WorkflowState): void => {
  if (state.planSummary) {
    console.log(
      `Plan summary: create=${state.planSummary.create}, overwrite=${state.planSummary.overwrite}, patch=${state.planSummary.patch}, skip=${state.planSummary.skip}`
    );
  }

  if (state.applySummary) {
    console.log(
      `Apply summary: create=${state.applySummary.create}, overwrite=${state.applySummary.overwrite}, patch=${state.applySummary.patch}, skip=${state.applySummary.skip}`
    );
    if (state.applySummary.patchPaths.length > 0) {
      console.log("Patch files:");
      state.applySummary.patchPaths.forEach((path) => console.log(`- ${path}`));
    }
  }

  if (state.verifyResult) {
    console.log(`Verify result: ok=${String(state.verifyResult.ok)}, code=${String(state.verifyResult.code)}`);
  }

  if (state.repairResult) {
    console.log(`Repair result: ok=${String(state.repairResult.ok)} ${state.repairResult.summary}`);
    if (state.repairResult.patchPaths && state.repairResult.patchPaths.length > 0) {
      console.log("Repair patch files:");
      state.repairResult.patchPaths.forEach((path) => console.log(`- ${path}`));
    }
  }

  console.log(`LLM enrich used: ${String(state.usedLLM)}`);

  console.log("Audit:");
  state.audit.forEach((item) => {
    const note = item.note ? ` (${item.note})` : "";
    console.log(`- ${item.node}: ${item.ok ? "ok" : "failed"}${note}`);
  });

  if (state.errors.length > 0) {
    console.log("Errors:");
    state.errors.forEach((err) => console.log(`- ${err}`));
  }
};

export const runGraphWithOptions = async (options: WorkflowCliOptions): Promise<{ code: number; state: WorkflowState }> => {
  loadEnvFile();

  if (!options.specPath || !options.outDir) {
    throw new Error("LangGraph workflow requires spec path and --out <dir>");
  }

  const flags: WorkflowFlags = {
    plan: options.plan || !options.apply,
    apply: options.apply,
    llmEnrich: options.llmEnrichSpec,
    verify: options.verify,
    repair: options.repair
  };

  const initial = createInitialState({
    specPath: options.specPath,
    outDir: options.outDir,
    flags
  });

  const state = await invokeGraph(initial);
  printSummary(state);

  const failedAudit = state.audit.some((item) => !item.ok);
  const verifyFailed = Boolean(state.verifyResult && !state.verifyResult.ok && !state.repairResult?.ok);
  const code = state.errors.length > 0 || failedAudit || verifyFailed ? 1 : 0;

  return { code, state };
};

export const runGraphCli = async (argv: string[]): Promise<number> => {
  const options = parseWorkflowArgs(argv);
  const result = await runGraphWithOptions(options);
  return result.code;
};

const main = async (): Promise<void> => {
  try {
    const code = await runGraphCli(process.argv.slice(2));
    process.exitCode = code;
  } catch (error) {
    process.exitCode = 1;
    console.error(error instanceof Error ? error.message : "workflow failed");
  }
};

if (process.argv[1] && /runGraph\.(ts|js)$/.test(process.argv[1])) {
  void main();
}
