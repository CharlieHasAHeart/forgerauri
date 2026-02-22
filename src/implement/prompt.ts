import type { LlmMessage } from "../llm/provider.js";
import type { SpecIR } from "../spec/schema.js";
import type { ProjectSnapshot } from "./snapshot.js";
import type { ImplementTarget } from "./types.js";

const describeTarget = (target: ImplementTarget): string => {
  if (target.kind === "ui") {
    return "ui: improve complexity through better component structure, loading/empty/error states, and clearer interactions. Do not add external UI frameworks.";
  }
  if (target.kind === "business") {
    return "business: improve migrations, constraints, indexes, repo SQL quality, and service transaction boundaries.";
  }
  return `commands:${target.name}: implement or enhance real command logic with proper command -> service -> repo layering.`;
};

const specSummary = (ir: SpecIR): string => {
  const commands = ir.rust_commands
    .map((command) => `${command.name}(input=${Object.keys(command.input).join(",")}; output=${Object.keys(command.output).join(",")})`)
    .sort();
  const screens = ir.screens.map((screen) => screen.name).sort();
  const tables = ir.data_model.tables.map((table) => table.name).sort();

  return JSON.stringify(
    {
      app: ir.app,
      screens,
      commands,
      tables
    },
    null,
    2
  );
};

export const buildImplementPrompt = (args: {
  target: ImplementTarget;
  ir: SpecIR;
  snapshot: ProjectSnapshot;
  maxPatches: number;
}): LlmMessage[] => {
  const rules = [
    "Return JSON only. No markdown.",
    'Output format: {"patches":[{"filePath":"relative/path","newContent":"full file content","reason":"..."}]}',
    `Do not output more than ${args.maxPatches} patches.`,
    "filePath must be project-root relative, never absolute, never containing ..",
    "newContent must be full file content, not a diff.",
    "Generated zone can be directly modified:",
    "- src/lib/**/generated/**",
    "- src-tauri/src/**/generated/**",
    "- src-tauri/migrations/generated/**",
    "- generated/**",
    "User zone should be treated as manual-merge candidates:",
    "- src/lib/custom/**",
    "- src-tauri/src/custom/**",
    "- src/App.svelte",
    "- src-tauri/src/main.rs",
    "TypeScript/Svelte constraints: no new dependencies, robust error handling, keep code readable.",
    "Rust constraints: no unwrap in non-test code, ApiResponse contract unchanged, SQL in repo modules, transactions in service layer."
  ].join("\n");

  const target = describeTarget(args.target);

  const snapshotText = JSON.stringify(
    {
      meta: { totalChars: args.snapshot.totalChars, truncated: args.snapshot.truncated, files: args.snapshot.files.length },
      files: args.snapshot.files
    },
    null,
    2
  );

  return [
    {
      role: "system",
      content: `${rules}\n\nYou are implementing production code under strict engineering guardrails.`
    },
    {
      role: "user",
      content:
        `Implementation target:\n${target}\n\n` +
        `Spec summary:\n${specSummary(args.ir)}\n\n` +
        `Project snapshot:\n${snapshotText}\n\n` +
        "Return only the JSON object with patches."
    }
  ];
};
