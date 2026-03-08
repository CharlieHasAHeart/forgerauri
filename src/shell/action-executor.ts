import { type Action, type ActionResult } from "../protocol/index.js";
import { buildActionResult, canBuildActionResult } from "./build-action-result.js";

export function executeAction(action: Action | undefined): ActionResult {
  return buildActionResult(action);
}

export function executeActions(actions: Action[]): ActionResult[] {
  return actions.map((action) => buildActionResult(action));
}

export function canExecuteAction(action: Action | undefined): boolean {
  return canBuildActionResult(action);
}

export function canExecuteActions(actions: Action[]): boolean {
  return actions.every((action) => canBuildActionResult(action));
}
