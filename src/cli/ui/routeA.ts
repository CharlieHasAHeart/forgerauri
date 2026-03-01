import { readFile } from "node:fs/promises";
import process from "node:process";
import chalk from "chalk";
import ora from "ora";
import logUpdate from "log-update";
import boxen from "boxen";
import prompts from "prompts";
import type { AgentEvent } from "../../agent/runtime/events.js";
import type { HumanReviewFn } from "../../agent/runtime/executor.js";
import type { PlanChangeReviewFn } from "../../agent/runtime/replanner.js";

const truncate = (value: string | undefined, max = 200): string | undefined => {
  if (!value) return value;
  return value.length > max ? `${value.slice(0, max)}...` : value;
};

const summarizePatchActions = (actions: Array<{ action: string }>): string => {
  const counts = new Map<string, number>();
  for (const item of actions) {
    counts.set(item.action, (counts.get(item.action) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([name, count]) => `${name}(${count})`)
    .join(", ");
};

export const createRouteAUI = (args: {
  goal: string;
  maxTurns: number;
  maxPatches: number;
  maxReplans: number;
  autoApprove?: boolean;
}): {
  onEvent: (event: AgentEvent) => void;
  humanReview: HumanReviewFn;
  requestPlanChangeReview: PlanChangeReviewFn;
} => {
  const panelState: {
    goal: string;
    turn: number;
    maxTurns: number;
    status: string;
    currentTaskId?: string;
    usedPatches: number;
    maxPatches: number;
    replans: number;
    maxReplans: number;
    lastError?: string;
  } = {
    goal: args.goal,
    turn: 0,
    maxTurns: args.maxTurns,
    status: "planning",
    usedPatches: 0,
    maxPatches: args.maxPatches,
    replans: 0,
    maxReplans: args.maxReplans
  };

  let activeSpinner: ReturnType<typeof ora> | undefined;

  const renderPanel = (): void => {
    const body = [
      `${chalk.bold("Goal")}: ${panelState.goal}`,
      `${chalk.bold("Turn")}: ${panelState.turn}/${panelState.maxTurns}`,
      `${chalk.bold("Status")}: ${panelState.status}`,
      `${chalk.bold("Current task")}: ${panelState.currentTaskId ?? "-"}`,
      `${chalk.bold("Budget")}: patches ${panelState.usedPatches}/${panelState.maxPatches}, replans ${panelState.replans}/${panelState.maxReplans}`,
      `${chalk.bold("Last error")}: ${panelState.lastError ?? "-"}`
    ].join("\n");

    logUpdate(
      boxen(body, {
        borderColor: "cyan",
        padding: { left: 1, right: 1, top: 0, bottom: 0 },
        margin: { top: 0, bottom: 1 },
        title: "RouteA Status",
        titleAlignment: "left"
      })
    );
  };

  const onEvent = (event: AgentEvent): void => {
    switch (event.type) {
      case "turn_start":
        panelState.turn = event.turn;
        panelState.status = "executing";
        break;
      case "task_selected":
        panelState.currentTaskId = event.taskId;
        panelState.status = "executing";
        break;
      case "tool_start":
        if (activeSpinner?.isSpinning) {
          activeSpinner.stop();
        }
        activeSpinner = ora(`tool ${event.name}`).start();
        break;
      case "tool_end":
        if (activeSpinner?.isSpinning) {
          const note = truncate(event.note, 200);
          if (event.ok) {
            activeSpinner.succeed(`${event.name} ✓${note ? ` ${note}` : ""}`);
          } else {
            activeSpinner.fail(`${event.name} ✗${note ? ` ${note}` : ""}`);
          }
          activeSpinner = undefined;
        } else {
          const note = truncate(event.note, 200);
          console.log(`${event.ok ? "✓" : "✗"} ${event.name}${note ? ` ${note}` : ""}`);
        }
        break;
      case "criteria_result":
        panelState.status = "reviewing";
        if (!event.ok) {
          panelState.lastError = truncate(event.failures.join("; "), 220);
        }
        break;
      case "patch_generated":
        panelState.usedPatches += event.paths.length;
        break;
      case "replan_proposed":
        panelState.status = "replanning";
        panelState.replans += 1;
        break;
      case "replan_gate":
        if (event.status === "denied") {
          panelState.lastError = truncate(`${event.reason}${event.guidance ? ` | ${event.guidance}` : ""}`, 220);
        }
        break;
      case "replan_applied":
        panelState.status = "executing";
        break;
      case "failed":
        panelState.status = "failed";
        panelState.lastError = truncate(event.message, 220);
        break;
      case "done":
        panelState.status = "done";
        break;
      default:
        break;
    }
    renderPanel();
  };

  const humanReview: HumanReviewFn = async ({ reason, patchPaths }): Promise<boolean> => {
    if (args.autoApprove) return true;

    console.log(chalk.yellow(`\nPATCH review required: ${reason}`));
    patchPaths.forEach((path) => console.log(`- ${path}`));

    while (true) {
      const answer = await prompts({
        type: "select",
        name: "choice",
        message: "Patch review",
        choices: [
          { title: "Approve", value: "approve" },
          { title: "Reject", value: "reject" },
          { title: "Show diff", value: "show_diff" }
        ]
      });

      if (answer.choice === "approve") return true;
      if (answer.choice === "reject") return false;
      if (answer.choice === "show_diff") {
        for (const path of patchPaths) {
          console.log(chalk.cyan(`\n--- ${path} ---`));
          try {
            const content = await readFile(path, "utf8");
            console.log(content);
          } catch (error) {
            console.log(`Unable to read patch file: ${path} (${error instanceof Error ? error.message : "unknown error"})`);
          }
        }
      }
    }
  };

  const requestPlanChangeReview: PlanChangeReviewFn = async ({ request, gateResult, policySummary, promptHint }) => {
    if (args.autoApprove) return "Approve. Apply the proposed patch.";

    console.log(chalk.yellow("\nReplan review required."));
    console.log(`Gate: ${gateResult.status} - ${gateResult.reason}`);
    if (gateResult.guidance) {
      console.log(`Guidance: ${gateResult.guidance}`);
    }
    console.log(`Policy: acceptanceLocked=${policySummary.acceptanceLocked}, techStackLocked=${policySummary.techStackLocked}`);
    console.log(`Patch summary: ${summarizePatchActions(request.patch) || "-"}`);

    const answer = await prompts({
      type: "text",
      name: "text",
      message: promptHint ?? "Provide natural-language review (approve/reject + guidance).",
      initial: "Approve. Apply the proposed patch."
    });
    return String(answer.text ?? "").trim() || "I reject this change. Please propose a safer patch.";
  };

  if (process.stdout.isTTY) {
    renderPanel();
  }

  return { onEvent, humanReview, requestPlanChangeReview };
};

