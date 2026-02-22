import { spawn } from "node:child_process";

export type CmdResult = {
  ok: boolean;
  code: number;
  stdout: string;
  stderr: string;
};

const clamp = (value: string, max = 200000): string =>
  value.length > max ? `${value.slice(0, max)}...<truncated>` : value;

export const runCmd = async (cmd: string, args: string[], cwd: string): Promise<CmdResult> =>
  new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd, shell: false });
    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });

    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });

    child.on("close", (code) => {
      const finalCode = code ?? 1;
      resolve({
        ok: finalCode === 0,
        code: finalCode,
        stdout: clamp(stdout),
        stderr: clamp(stderr)
      });
    });

    child.on("error", (error) => {
      resolve({ ok: false, code: 1, stdout: clamp(stdout), stderr: clamp(`${stderr}\n${error.message}`) });
    });
  });
