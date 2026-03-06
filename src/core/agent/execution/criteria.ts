import { access, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { AgentPolicy } from "../../contracts/policy.js";
import type { SuccessCriterion } from "../../contracts/planning.js";
import type { AgentState } from "../../contracts/state.js";
import type { ToolRunContext } from "../../contracts/tools.js";
import { setStateError } from "./errors.js";

const evaluateSingleCriterion = async (args: {
  criterion: SuccessCriterion;
  ctx: ToolRunContext;
  state: AgentState;
  policy: AgentPolicy;
}): Promise<{ ok: boolean; note?: string }> => {
  const c = args.criterion;

  if (c.type === "tool_result") {
    const matched = args.state.toolResults.filter((result) => result.name === c.tool_name);
    if (matched.length === 0) {
      return { ok: false, note: `criteria check failed: ${c.tool_name}` };
    }
    const expected = c.expected_ok ?? true;
    const ok = matched.some((item) => item.ok === expected);
    return ok ? { ok: true } : { ok: false, note: `criteria check failed: ${c.tool_name}` };
  }

  if (c.type === "file_exists") {
    const base = args.state.appDir ?? args.ctx.memory.appDir ?? args.state.runDir;
    const target = join(base, c.path);
    try {
      await access(target);
      return { ok: true };
    } catch {
      return { ok: false, note: "criteria check failed: tool_check_file_exists" };
    }
  }

  if (c.type === "file_contains") {
    const base = args.state.appDir ?? args.ctx.memory.appDir ?? args.state.runDir;
    const target = join(base, c.path);
    try {
      const content = await readFile(target, "utf8");
      if (content.includes(c.contains)) return { ok: true };
      return { ok: false, note: "criteria check failed: tool_check_file_contains" };
    } catch {
      return { ok: false, note: "criteria check failed: tool_check_file_contains" };
    }
  }

  if (c.type === "command") {
    if (!args.policy.safety.allowed_commands.includes(c.cmd)) {
      const failure = `criteria check failed: command ${c.cmd} blocked by policy`;
      setStateError(args.state, "Config", failure);
      return { ok: false, note: failure };
    }
    const cwd = c.cwd ?? args.state.appDir ?? args.ctx.memory.appDir ?? args.state.runDir;
    const result = await args.ctx.runCmdImpl(c.cmd, c.args ?? [], cwd);
    const expected = c.expect_exit_code ?? 0;
    if (result.code === expected && result.ok) return { ok: true };
    return {
      ok: false,
      note: `criteria check failed: command ${c.cmd}${result.stderr ? ` (${result.stderr.trim()})` : ""}`
    };
  }

  return { ok: false, note: "criteria check failed: unknown criterion" };
};

export const evaluateCriteriaSet = async (args: {
  criteria: SuccessCriterion[];
  ctx: ToolRunContext;
  state: AgentState;
  policy: AgentPolicy;
}): Promise<{
  ok: boolean;
  results: Array<{ criterion: SuccessCriterion; ok: boolean; note?: string }>;
  failures: Array<{ criterion: SuccessCriterion; note: string }>;
}> => {
  const results: Array<{ criterion: SuccessCriterion; ok: boolean; note?: string }> = [];
  const failures: Array<{ criterion: SuccessCriterion; note: string }> = [];

  for (const criterion of args.criteria) {
    const verdict = await evaluateSingleCriterion({
      criterion,
      ctx: args.ctx,
      state: args.state,
      policy: args.policy
    });
    results.push({ criterion, ok: verdict.ok, note: verdict.note });
    if (!verdict.ok) {
      failures.push({ criterion, note: verdict.note ?? "criteria check failed" });
    }
  }

  return {
    ok: failures.length === 0,
    results,
    failures
  };
};
