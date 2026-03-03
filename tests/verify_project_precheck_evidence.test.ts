import { mkdtemp, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { runVerifyProject } from "../src/agent/tools/impl/verify_project.js";

describe("verify_project precheck evidence", () => {
  test("emits acceptance_step_skipped when skip_if_exists precheck triggers", async () => {
    const root = await mkdtemp(join(tmpdir(), "forgetauri-precheck-evidence-"));
    await mkdir(join(root, "src-tauri"), { recursive: true });
    await mkdir(join(root, "node_modules"), { recursive: true });

    const events: Array<{ event_type: string; command_id?: string; reason?: string }> = [];
    const result = await runVerifyProject({
      projectRoot: root,
      runCmdImpl: async () => ({ ok: true, code: 0, stdout: "ok", stderr: "" }),
      evidence: {
        onStepEvent: (event) => {
          events.push(event);
        }
      }
    });

    expect(result.ok).toBe(true);
    const skipped = events.find(
      (event) => event.event_type === "acceptance_step_skipped" && event.command_id === "pnpm_install"
    );
    expect(skipped?.reason).toBe("precheck_skip_if_exists");
  });
});
