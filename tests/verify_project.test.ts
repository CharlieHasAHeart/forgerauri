import { mkdtemp, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { runVerifyProject } from "../src/agent/tools/verifyProject.js";

describe("tool_verify_project", () => {
  test("runs gates in fixed order and returns structured result", async () => {
    const root = await mkdtemp(join(tmpdir(), "forgetauri-verify-"));
    await mkdir(join(root, "src-tauri"), { recursive: true });

    const calls: Array<{ cmd: string; args: string[]; cwd: string }> = [];
    const runCmdImpl = async (cmd: string, args: string[], cwd: string) => {
      calls.push({ cmd, args, cwd });
      return { ok: true, code: 0, stdout: "ok", stderr: "" };
    };

    const result = await runVerifyProject({
      projectRoot: root,
      runCmdImpl
    });

    expect(result.ok).toBe(true);
    expect(result.step).toBe("none");
    expect(result.results.map((s) => s.name)).toEqual(["install", "build", "cargo_check", "tauri_check"]);
    expect(calls.map((c) => `${c.cmd} ${c.args.join(" ")}`)).toEqual([
      `pnpm -C ${root} install`,
      `pnpm -C ${root} build`,
      "cargo check",
      `pnpm -C ${root} tauri --help`
    ]);
  });
});
