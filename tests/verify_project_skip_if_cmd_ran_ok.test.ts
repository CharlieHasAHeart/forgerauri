import { mkdtemp, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { runVerifyProject } from "../src/agent/tools/impl/verify_project.js";

describe("verify_project skip_if_cmd_ran_ok", () => {
  test("skips pnpm_install when successful command evidence already exists", async () => {
    const root = await mkdtemp(join(tmpdir(), "forgetauri-precheck-cmd-ok-"));
    await mkdir(join(root, "src-tauri"), { recursive: true });

    const calls: Array<string> = [];
    const events: Array<{ event_type: string; command_id?: string; reason?: string }> = [];
    const result = await runVerifyProject({
      projectRoot: root,
      runCmdImpl: async (cmd, args) => {
        calls.push(`${cmd} ${args.join(" ")}`);
        return { ok: true, code: 0, stdout: "ok", stderr: "" };
      },
      evidence: {
        knownSuccessfulCommandIds: ["pnpm_install"],
        onStepEvent: (event) => events.push(event)
      }
    });

    expect(result.ok).toBe(true);
    expect(calls.includes("pnpm install")).toBe(false);
    const skipped = events.find(
      (event) => event.event_type === "acceptance_step_skipped" && event.command_id === "pnpm_install"
    );
    expect(skipped?.reason).toBe("precheck_skip_if_cmd_ran_ok");
  });
});
