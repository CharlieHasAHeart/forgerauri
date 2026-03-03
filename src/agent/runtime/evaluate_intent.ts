import { readFile } from "node:fs/promises";
import { z } from "zod";
import { evaluateAcceptance, type EvaluationResult } from "../core/acceptance/engine.js";
import { readEvidenceJsonlWithDiagnostics } from "../core/evidence/reader.js";
import type { Intent } from "../core/acceptance/intent.js";
import { createSnapshot } from "../core/workspace/snapshot.js";

const intentSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("bootstrap"),
    fingerprints: z.array(z.string().min(1))
  }),
  z.object({
    type: z.literal("ensure_paths"),
    expected_paths: z.array(z.string().min(1))
  }),
  z.object({
    type: z.literal("verify_tool_exit"),
    tool_name: z.string().min(1),
    expect_exit_code: z.number().int()
  }),
  z.object({
    type: z.literal("verify_command"),
    cmd: z.string().min(1),
    args: z.array(z.string()),
    cwd: z.string().min(1).optional(),
    expect_exit_code: z.number().int()
  }),
  z.object({
    type: z.literal("verify_acceptance_pipeline"),
    pipeline_id: z.string().min(1),
    strict_order: z.boolean().optional()
  })
]);

const snapshotPathsFromIntent = (intent: Intent): string[] => {
  if (intent.type === "bootstrap") return intent.fingerprints;
  if (intent.type === "ensure_paths") return intent.expected_paths;
  return [];
};

export const evaluateIntent = async (args: {
  goal: string;
  rootDir: string;
  evidenceFilePath: string;
  intent: Intent;
  appDir?: string;
  tauriDir?: string;
}): Promise<EvaluationResult> => {
  const evidenceRead = await readEvidenceJsonlWithDiagnostics(args.evidenceFilePath);
  const snapshot = await createSnapshot(args.rootDir, { paths: snapshotPathsFromIntent(args.intent) });
  const evaluated = evaluateAcceptance({
    goal: args.goal,
    intent: args.intent,
    evidence: evidenceRead.events,
    snapshot,
    runtime: {
      repoRoot: args.rootDir,
      appDir: args.appDir ?? "./generated/app",
      tauriDir: args.tauriDir ?? `${args.appDir ?? "./generated/app"}/src-tauri`
    }
  });

  return {
    ...evaluated,
    diagnostics: [...evidenceRead.diagnostics, ...evaluated.diagnostics]
  };
};

export const evaluateIntentFromJsonInput = async (args: {
  goal: string;
  rootDir: string;
  evidenceFilePath: string;
  intentJsonOrPath: string;
  appDir?: string;
  tauriDir?: string;
}): Promise<EvaluationResult> => {
  const maybeJson = args.intentJsonOrPath.trim();
  const raw =
    maybeJson.startsWith("{") || maybeJson.startsWith("[")
      ? maybeJson
      : await readFile(args.intentJsonOrPath, "utf8");
  const parsed = intentSchema.parse(JSON.parse(raw)) as Intent;
  return evaluateIntent({
    goal: args.goal,
    rootDir: args.rootDir,
    evidenceFilePath: args.evidenceFilePath,
    intent: parsed,
    appDir: args.appDir,
    tauriDir: args.tauriDir
  });
};
