import { existsSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import type { CmdResult } from "../../runner/runCmd.js";
import type { AgentCmdRunner, ErrorKind, VerifyProjectResult, VerifyStepResult } from "../types.js";

export const verifyProjectInputSchema = z.object({
  projectRoot: z.string().min(1)
});

const truncate = (value: string, max = 60000): string => (value.length > max ? `${value.slice(0, max)}...<truncated>` : value);

const isDepsBuildFailure = (stderr: string): boolean => {
  const text = stderr.toLowerCase();
  return (
    text.includes("cannot find module") ||
    text.includes("err_pnpm") ||
    text.includes("module_not_found") ||
    text.includes("node_modules") ||
    text.includes("pnpm install") ||
    text.includes("eai_again") ||
    text.includes("registry.npmjs.org")
  );
};

const classifyError = (step: VerifyStepResult["name"], stderr: string): ErrorKind => {
  const text = stderr.toLowerCase();
  if (step === "install" || step === "install_retry" || isDepsBuildFailure(stderr)) return "Deps";
  if ((step === "build" || step === "build_retry") && (text.includes("ts") || text.includes("type") || text.includes("vite"))) return "TS";
  if (step === "cargo_check" || text.includes("cargo") || text.includes("rustc") || text.includes("rusqlite")) return "Rust";
  if (step === "tauri_check" || step === "tauri_build" || text.includes("tauri")) return "Tauri";
  if (text.includes("config") || text.includes("toml") || text.includes("json")) return "Config";
  return "Unknown";
};

const suggestionFor = (kind: ErrorKind): string => {
  if (kind === "Deps") return "Install dependencies again and check network/proxy/registry access.";
  if (kind === "TS") return "Fix TypeScript/Svelte compile errors first.";
  if (kind === "Rust") return "Fix Rust compile or Cargo dependency errors.";
  if (kind === "Tauri") return "Fix Tauri toolchain/config; ensure tauri cli and Rust targets are available.";
  if (kind === "Config") return "Validate config files (package.json/tauri.conf/Cargo.toml).";
  return "Inspect stderr and apply minimal patch for the first failing step.";
};

const toStep = (name: VerifyStepResult["name"], result: CmdResult, skipped = false): VerifyStepResult => ({
  name,
  ok: result.ok,
  code: result.code,
  stdout: truncate(result.stdout),
  stderr: truncate(result.stderr),
  skipped
});

const okSkipped = (): CmdResult => ({ ok: true, code: 0, stdout: "skipped", stderr: "" });

const remainingSteps = (done: VerifyStepResult["name"][]): VerifyStepResult[] => {
  const ordered: VerifyStepResult["name"][] = ["install", "install_retry", "build", "build_retry", "cargo_check", "tauri_check", "tauri_build"];
  return ordered.filter((step) => !done.includes(step)).map((step) => toStep(step, okSkipped(), true));
};

export const runVerifyProject = async (args: {
  projectRoot: string;
  runCmdImpl: AgentCmdRunner;
}): Promise<VerifyProjectResult> => {
  const steps: VerifyStepResult[] = [];
  const done: VerifyStepResult["name"][] = [];

  const push = (step: VerifyStepResult): void => {
    steps.push(step);
    done.push(step.name);
  };

  const fail = (stepName: VerifyStepResult["name"], stderr: string, summary: string): VerifyProjectResult => {
    const kind = classifyError(stepName, stderr);
    const filled = [...steps, ...remainingSteps(done)];
    return {
      ok: false,
      step: stepName,
      results: filled,
      summary,
      classifiedError: kind,
      suggestion: suggestionFor(kind)
    };
  };

  const nodeModulesPath = join(args.projectRoot, "node_modules");

  if (!existsSync(nodeModulesPath)) {
    const installResult = await args.runCmdImpl("pnpm", ["-C", args.projectRoot, "install"], args.projectRoot);
    const installStep = toStep("install", installResult);
    push(installStep);
    if (!installStep.ok) return fail("install", installStep.stderr, "verify failed at install");
  } else {
    push(toStep("install", okSkipped(), true));
  }

  push(toStep("install_retry", okSkipped(), true));

  const buildResult = await args.runCmdImpl("pnpm", ["-C", args.projectRoot, "build"], args.projectRoot);
  const buildStep = toStep("build", buildResult);
  push(buildStep);

  if (!buildStep.ok && isDepsBuildFailure(buildStep.stderr)) {
    const installRetry = await args.runCmdImpl("pnpm", ["-C", args.projectRoot, "install"], args.projectRoot);
    steps[done.indexOf("install_retry")] = toStep("install_retry", installRetry);

    if (!installRetry.ok) {
      return fail("install_retry", installRetry.stderr, "verify failed at install retry");
    }

    const buildRetry = await args.runCmdImpl("pnpm", ["-C", args.projectRoot, "build"], args.projectRoot);
    const buildRetryStep = toStep("build_retry", buildRetry);
    push(buildRetryStep);
    if (!buildRetryStep.ok) {
      return fail("build_retry", buildRetryStep.stderr, "verify failed at build retry");
    }
  } else {
    if (!buildStep.ok) return fail("build", buildStep.stderr, "verify failed at build");
    push(toStep("build_retry", okSkipped(), true));
  }

  const tauriRoot = join(args.projectRoot, "src-tauri");
  if (existsSync(tauriRoot)) {
    const cargoResult = await args.runCmdImpl("cargo", ["check"], tauriRoot);
    const cargoStep = toStep("cargo_check", cargoResult);
    push(cargoStep);
    if (!cargoStep.ok) return fail("cargo_check", cargoStep.stderr, "verify failed at cargo_check");

    const tauriCheck = await args.runCmdImpl("pnpm", ["-C", args.projectRoot, "tauri", "--help"], args.projectRoot);
    const tauriCheckStep = toStep("tauri_check", tauriCheck);
    push(tauriCheckStep);
    if (!tauriCheckStep.ok) return fail("tauri_check", tauriCheckStep.stderr, "verify failed at tauri_check");

    const tauriBuild = await args.runCmdImpl("pnpm", ["-C", args.projectRoot, "tauri", "build"], args.projectRoot);
    const tauriBuildStep = toStep("tauri_build", tauriBuild);
    push(tauriBuildStep);
    if (!tauriBuildStep.ok) return fail("tauri_build", tauriBuildStep.stderr, "verify failed at tauri_build");
  } else {
    push(toStep("cargo_check", okSkipped(), true));
    push(toStep("tauri_check", okSkipped(), true));
    push(toStep("tauri_build", okSkipped(), true));
  }

  const filled = [...steps, ...remainingSteps(done)];
  return {
    ok: true,
    step: "none",
    results: filled,
    summary: "verify passed",
    classifiedError: "Unknown",
    suggestion: "No action needed."
  };
};
