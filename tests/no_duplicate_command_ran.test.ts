import { mkdtemp, mkdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { EvidenceLogger } from "../src/agent/core/evidence/logger.js";
import { toolPackage } from "../src/agent/tools/core/verify_project/index.js";
import { MockProvider } from "./helpers/mockProvider.js";

describe("verify_project command evidence uniqueness", () => {
  test("writes command_ran once per executed pipeline command and includes command_id", async () => {
    const outDir = await mkdtemp(join(tmpdir(), "forgetauri-no-dup-cmd-ran-"));
    const appDir = join(outDir, "app");
    await mkdir(join(appDir, "src-tauri"), { recursive: true });
    const evidenceFilePath = join(outDir, "run_evidence.jsonl");
    const logger = new EvidenceLogger({ filePath: evidenceFilePath });

    const ctx = {
      provider: new MockProvider([]),
      runCmdImpl: async () => ({ ok: true, code: 0, stdout: "ok", stderr: "", cmd: "", args: [], cwd: appDir }),
      flags: { apply: true, verify: true, repair: false, maxPatchesPerTurn: 8 },
      memory: {
        outDir,
        appDir,
        runtimePaths: {
          repoRoot: outDir.replace(/\\/g, "/"),
          appDir: appDir.replace(/\\/g, "/"),
          tauriDir: `${appDir.replace(/\\/g, "/")}/src-tauri`
        },
        patchPaths: [],
        touchedPaths: [],
        evidenceRunId: "run-no-dup",
        evidenceTurn: 1,
        evidenceTaskId: "t_verify",
        evidenceLogger: logger
      }
    };

    const result = await toolPackage.runtime.run({ projectRoot: appDir }, ctx);
    await logger.close();
    expect(result.ok).toBe(true);

    const lines = (await readFile(evidenceFilePath, "utf8"))
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    const events = lines.map((line) => JSON.parse(line) as Record<string, unknown>);
    const commandRan = events.filter((event) => event.event_type === "command_ran");
    const commandIds = commandRan.map((event) => String(event.command_id ?? ""));

    expect(commandRan.length).toBe(5);
    expect(commandIds.every((value) => value.length > 0)).toBe(true);
    const uniqueCallIds = new Set(commandRan.map((event) => String(event.call_id ?? "")));
    expect(uniqueCallIds.size).toBe(commandRan.length);
  });
});
