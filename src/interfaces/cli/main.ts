import process from "node:process";
import { ZodError } from "zod";
import { createRouteAUiAdapter } from "../../adapters/ui/routeA/RouteAUiAdapter.js";
import type { AgentEvent } from "../../core/agent/events.js";
import { createAgentApp } from "../../app/createAgentApp.js";
import { loadAppEnv } from "../../app/env.js";
import { parseArgs, parsePolicy, printValidationErrors, usage } from "./args.js";

const runAgentMode = async (options: ReturnType<typeof parseArgs>): Promise<void> => {
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

  const useUi = options.ui === "routeA" && !options.noUi && process.stdin.isTTY && process.stdout.isTTY;
  const policyMaxReplans = policy?.budgets?.max_replans ?? 3;
  const ui = useUi
    ? createRouteAUiAdapter({
        goal: options.goal,
        maxTurns: options.maxTurns,
        maxPatches: options.maxPatches,
        maxReplans: policyMaxReplans,
        autoApprove: options.autoApprove
      })
    : undefined;

  const noUiOnEvent =
    !useUi
      ? (event: AgentEvent): void => {
          if (event.type === "tool_end") {
            console.log(`${event.ok ? "✓" : "✗"} ${event.name}${event.note ? ` ${event.note}` : ""}`);
          } else if (event.type === "replan_gate") {
            console.log(`[replan-gate] ${event.status}: ${event.reason}`);
          } else if (event.type === "failed" && event.message) {
            console.log(`[failed] ${event.message}`);
          }
        }
      : undefined;

  const app = createAgentApp();
  const result = await app.runAgent({
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
    humanReview: ui,
    onEvent: ui?.onEvent ?? noUiOnEvent
  });

  console.log(`Agent result: ${result.ok ? "ok" : "failed"}`);
  console.log(result.summary);
  if (result.auditPath) console.log(`Audit log: ${result.auditPath}`);
  if (result.patchPaths && result.patchPaths.length > 0) {
    console.log("Patch files:");
    result.patchPaths.forEach((path) => console.log(`- ${path}`));
  }
  process.exitCode = result.ok ? 0 : 1;
};

export const main = async (): Promise<void> => {
  loadAppEnv();
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
