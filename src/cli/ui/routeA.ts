import { readFile } from "node:fs/promises";
import process from "node:process";
import chalk from "chalk";
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
  const isTTY = Boolean(process.stdout.isTTY);
  const MAX_LOG_LINES = 10;
  const recentLines: string[] = [];
  const pushLine = (line: string): void => {
    recentLines.push(line);
    while (recentLines.length > MAX_LOG_LINES) recentLines.shift();
  };

  const panelState: {
    goal: string;
    turn: number;
    maxTurns: number;
    status: string;
    currentTaskId?: string;
    usedPatches: number;
    maxPatches: number;
    replansAttempted: number;
    replansApplied: number;
    maxReplans: number;
    lastError?: string;
  } = {
    goal: args.goal,
    turn: 0,
    maxTurns: args.maxTurns,
    status: "planning",
    usedPatches: 0,
    maxPatches: args.maxPatches,
    replansAttempted: 0,
    replansApplied: 0,
    maxReplans: args.maxReplans
  };

  const renderPanel = (): void => {
    const recent =
      recentLines.length > 0
        ? recentLines.map((line) => `  ${line}`).join("\n")
        : "  -";
    const body = [
      `${chalk.bold("Goal")}: ${panelState.goal}`,
      `${chalk.bold("Turn")}: ${panelState.turn}/${panelState.maxTurns}`,
      `${chalk.bold("Status")}: ${panelState.status}`,
      `${chalk.bold("Current task")}: ${panelState.currentTaskId ?? "-"}`,
      `${chalk.bold("Budget")}: patches ${panelState.usedPatches}/${panelState.maxPatches}, replans applied ${panelState.replansApplied}/${panelState.maxReplans} (attempted ${panelState.replansAttempted})`,
      `${chalk.bold("Last error")}: ${panelState.lastError ?? "-"}`,
      `${chalk.bold("Recent")}:`,
      recent
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
    let nonTtyLine: string | undefined;
    switch (event.type) {
      case "turn_start":
        panelState.turn = event.turn;
        panelState.status = "executing";
        pushLine(`${chalk.gray("→")} turn ${event.turn}/${event.maxTurns}`);
        nonTtyLine = `turn ${event.turn}/${event.maxTurns}`;
        break;
      case "task_selected":
        panelState.currentTaskId = event.taskId;
        panelState.status = "executing";
        pushLine(`${chalk.gray("→")} task ${event.taskId}`);
        nonTtyLine = `task ${event.taskId}`;
        break;
      case "tool_start":
        pushLine(`${chalk.gray("…")} tool ${event.name} started`);
        nonTtyLine = `tool ${event.name} started`;
        break;
      case "tool_end":
        {
          const note = truncate(event.note, 120);
          const prefix = event.ok ? chalk.green("✓") : chalk.red("✗");
          pushLine(`${prefix} ${event.name}${note ? ` ${chalk.gray(note)}` : ""}`);
          nonTtyLine = `${event.ok ? "✓" : "✗"} ${event.name}${note ? ` ${note}` : ""}`;
        }
        break;
      case "criteria_result":
        panelState.status = "reviewing";
        if (event.ok) {
          pushLine(`${chalk.green("✓")} criteria ok`);
          nonTtyLine = "criteria ok";
        } else {
          const text = truncate(event.failures.join("; "), 120) ?? "";
          panelState.lastError = truncate(event.failures.join("; "), 220);
          pushLine(`${chalk.red("✗")} criteria: ${text}`);
          nonTtyLine = `criteria failed: ${text}`;
        }
        break;
      case "patch_generated":
        panelState.usedPatches += event.paths.length;
        pushLine(`${chalk.cyan("+")} patch files: ${event.paths.length}`);
        nonTtyLine = `patch files: ${event.paths.length}`;
        break;
      case "replan_proposed":
        panelState.status = "replanning";
        panelState.replansAttempted += 1;
        pushLine(`${chalk.yellow("↻")} replan proposed`);
        nonTtyLine = "replan proposed";
        break;
      case "replan_gate":
        if (event.status === "denied") {
          panelState.lastError = truncate(`${event.reason}${event.guidance ? ` | ${event.guidance}` : ""}`, 220);
          pushLine(`${chalk.red("✗")} replan gate denied`);
          nonTtyLine = `replan gate denied: ${truncate(event.reason, 120) ?? ""}`;
        }
        break;
      case "replan_review_text":
        pushLine(`${chalk.gray("…")} review text received`);
        nonTtyLine = "review text received";
        break;
      case "replan_applied":
        panelState.status = "executing";
        panelState.replansApplied += 1;
        pushLine(`${chalk.green("↻")} replan applied (v${event.newVersion})`);
        nonTtyLine = `replan applied (v${event.newVersion})`;
        break;
      case "failed":
        panelState.status = "failed";
        panelState.lastError = truncate(event.message, 220);
        pushLine(`${chalk.red("✗")} failed: ${truncate(event.message, 120) ?? ""}`);
        nonTtyLine = `failed: ${truncate(event.message, 120) ?? ""}`;
        break;
      case "done":
        panelState.status = "done";
        pushLine(`${chalk.green("✓")} done`);
        nonTtyLine = "done";
        break;
      default:
        break;
    }
    if (isTTY) {
      renderPanel();
    } else if (nonTtyLine) {
      console.log(nonTtyLine);
    }
  };

  const humanReview: HumanReviewFn = async ({ reason, patchPaths }): Promise<boolean> => {
    if (args.autoApprove) return true;

    if (isTTY) logUpdate.clear();
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

    if (isTTY) logUpdate.clear();
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

  if (isTTY) {
    renderPanel();
  }

  return { onEvent, humanReview, requestPlanChangeReview };
};
