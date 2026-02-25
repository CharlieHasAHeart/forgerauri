import { mkdtemp, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { runVerifyProject } from "../src/agent/tools/verifyProject.js";

describe("tool_verify_project", () => {
  test("retries install+build once when build fails with deps signal", async () => {
    const root = await mkdtemp(join(tmpdir(), "forgetauri-verify-"));
    await mkdir(join(root, "src-tauri"), { recursive: true });

    const calls: Array<{ cmd: string; args: string[]; cwd: string }> = [];
    let buildAttempts = 0;

    const runCmdImpl = async (cmd: string, args: string[], cwd: string) => {
      calls.push({ cmd, args, cwd });
      const joined = `${cmd} ${args.join(" ")}`;
      if (joined.includes(" build")) {
        buildAttempts += 1;
        if (buildAttempts === 1) {
          return { ok: false, code: 1, stdout: "", stderr: "ERR_PNPM Cannot find module, try pnpm install" };
        }
      }
      return { ok: true, code: 0, stdout: "ok", stderr: "" };
    };

    const result = await runVerifyProject({
      projectRoot: root,
      runCmdImpl
    });

    expect(result.ok).toBe(true);
    expect(result.results.some((step) => step.name === "install_retry" && !step.skipped)).toBe(true);
    expect(result.results.some((step) => step.name === "build_retry" && !step.skipped)).toBe(true);
    expect(calls.map((c) => `${c.cmd} ${c.args.join(" ")}`)).toEqual([
      `pnpm -C ${root} install`,
      `pnpm -C ${root} build`,
      `pnpm -C ${root} install`,
      `pnpm -C ${root} build`,
      "cargo check",
      `pnpm -C ${root} tauri --help`,
      `pnpm -C ${root} tauri build`
    ]);
  });

  test("always runs tauri build after cargo check", async () => {
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
    expect(result.results.map((s) => s.name)).toEqual([
      "install",
      "install_retry",
      "build",
      "build_retry",
      "cargo_check",
      "tauri_check",
      "tauri_build"
    ]);
    expect(calls.map((c) => `${c.cmd} ${c.args.join(" ")}`)).toEqual([
      `pnpm -C ${root} install`,
      `pnpm -C ${root} build`,
      "cargo check",
      `pnpm -C ${root} tauri --help`,
      `pnpm -C ${root} tauri build`
    ]);
  });
});
