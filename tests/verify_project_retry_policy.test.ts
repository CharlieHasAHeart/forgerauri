import { mkdtemp, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { runVerifyProject } from "../src/agent/tools/impl/verify_project.js";

describe("verify_project retry policy", () => {
  test("retries pnpm_build once on deps_signal and then succeeds", async () => {
    const root = await mkdtemp(join(tmpdir(), "forgetauri-verify-retry-"));
    await mkdir(join(root, "src-tauri"), { recursive: true });

    let buildAttempts = 0;
    const calls: string[] = [];
    const runCmdImpl = async (cmd: string, args: string[], cwd: string) => {
      void cwd;
      const key = `${cmd} ${args.join(" ")}`;
      calls.push(key);
      if (key === "pnpm build") {
        buildAttempts += 1;
        if (buildAttempts === 1) {
          return { ok: false, code: 1, stdout: "", stderr: "ERR_PNPM Cannot find module" };
        }
      }
      return { ok: true, code: 0, stdout: "ok", stderr: "" };
    };

    const result = await runVerifyProject({
      projectRoot: root,
      runCmdImpl,
      runtimePaths: { repoRoot: root, appDir: root, tauriDir: `${root.replace(/\\/g, "/")}/src-tauri` }
    });

    expect(result.ok).toBe(true);
    expect(calls.filter((item) => item === "pnpm build")).toHaveLength(2);
    expect(result.results.some((step) => step.name === "build_retry" && step.ok)).toBe(true);
  });
});
