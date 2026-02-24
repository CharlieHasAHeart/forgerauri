import { existsSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import type { CmdResult } from "../../runner/runCmd.js";
import type { AgentCmdRunner, ErrorKind, VerifyProjectResult, VerifyStepResult } from "../types.js";

export const verifyProjectInputSchema = z.object({
  projectRoot: z.string().min(1)
});

const truncate = (value: string, max = 60000): string => (value.length > max ? `${value.slice(0, max)}...<truncated>` : value);

const classifyError = (step: VerifyStepResult["name"], stderr: string): ErrorKind => {
  const text = stderr.toLowerCase();
  if (step === "install" || text.includes("eai_again") || text.includes("registry.npmjs.org")) return "Deps";
  if (step === "build" && (text.includes("ts") || text.includes("type") || text.includes("vite"))) return "TS";
  if (step === "cargo_check" || text.includes("cargo") || text.includes("rustc") || text.includes("rusqlite")) return "Rust";
  if (step === "tauri_check" || text.includes("tauri")) return "Tauri";
  if (text.includes("config") || text.includes("toml") || text.includes("json")) return "Config";
  return "Unknown";
};

const suggestionFor = (kind: ErrorKind): string => {
  if (kind === "Deps") return "Check network/proxy/registry access and lockfile consistency.";
  if (kind === "TS") return "Fix TypeScript/Svelte compile errors first.";
  if (kind === "Rust") return "Fix Rust compile or Cargo dependency errors.";
  if (kind === "Tauri") return "Fix Tauri config/capability or CLI invocation issues.";
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

export const runVerifyProject = async (args: {
  projectRoot: string;
  runCmdImpl: AgentCmdRunner;
}): Promise<VerifyProjectResult> => {
  const steps: VerifyStepResult[] = [];
  const nodeModulesPath = join(args.projectRoot, "node_modules");

  if (!existsSync(nodeModulesPath)) {
    const installResult = await args.runCmdImpl("pnpm", ["-C", args.projectRoot, "install"], args.projectRoot);
    const step = toStep("install", installResult);
    steps.push(step);
    if (!step.ok) {
      const kind = classifyError("install", step.stderr);
      return {
        ok: false,
        step: "install",
        results: steps,
        summary: "verify failed at install",
        classifiedError: kind,
        suggestion: suggestionFor(kind)
      };
    }
  } else {
    steps.push(toStep("install", okSkipped(), true));
  }

  const buildResult = await args.runCmdImpl("pnpm", ["-C", args.projectRoot, "build"], args.projectRoot);
  const buildStep = toStep("build", buildResult);
  steps.push(buildStep);
  if (!buildStep.ok) {
    const kind = classifyError("build", buildStep.stderr);
    return {
      ok: false,
      step: "build",
      results: steps,
      summary: "verify failed at build",
      classifiedError: kind,
      suggestion: suggestionFor(kind)
    };
  }

  const tauriRoot = join(args.projectRoot, "src-tauri");
  if (existsSync(tauriRoot)) {
    const cargoResult = await args.runCmdImpl("cargo", ["check"], tauriRoot);
    const cargoStep = toStep("cargo_check", cargoResult);
    steps.push(cargoStep);
    if (!cargoStep.ok) {
      const kind = classifyError("cargo_check", cargoStep.stderr);
      return {
        ok: false,
        step: "cargo_check",
        results: steps,
        summary: "verify failed at cargo_check",
        classifiedError: kind,
        suggestion: suggestionFor(kind)
      };
    }

    const tauriCheck = await args.runCmdImpl("pnpm", ["-C", args.projectRoot, "tauri", "--help"], args.projectRoot);
    const tauriStep = toStep("tauri_check", tauriCheck);
    steps.push(tauriStep);
    if (!tauriStep.ok) {
      const kind = classifyError("tauri_check", tauriStep.stderr);
      return {
        ok: false,
        step: "tauri_check",
        results: steps,
        summary: "verify failed at tauri_check",
        classifiedError: kind,
        suggestion: suggestionFor(kind)
      };
    }
  } else {
    steps.push(toStep("cargo_check", okSkipped(), true));
    steps.push(toStep("tauri_check", okSkipped(), true));
  }

  return {
    ok: true,
    step: "none",
    results: steps,
    summary: "verify passed",
    classifiedError: "Unknown",
    suggestion: "No action needed."
  };
};
