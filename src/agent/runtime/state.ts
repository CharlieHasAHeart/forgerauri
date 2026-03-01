import type { AgentState } from "../types.js";
import { summarizePlan } from "../plan/selectors.js";

export const summarizeState = (state: AgentState): unknown => ({
  status: state.status,
  goal: state.goal,
  projectRoot: state.projectRoot,
  appDir: state.appDir,
  contractPath: state.contractPath,
  uxPath: state.uxPath,
  implPath: state.implPath,
  deliveryPath: state.deliveryPath,
  lastResponseId: state.lastResponseId,
  designValidation: state.designValidation,
  lastDeterministicFixes: state.lastDeterministicFixes,
  repairKnownChecked: state.repairKnownChecked,
  codegenSummary: state.codegenSummary,
  planVersion: state.planVersion,
  currentTaskId: state.currentTaskId,
  completedTasks: state.completedTasks,
  planSummary: state.planData ? summarizePlan(state.planData) : undefined,
  counts: {
    contractCommands: state.contract?.commands.length ?? 0,
    uxScreens: state.ux?.screens.length ?? 0,
    implServices: state.impl?.rust.services.length ?? 0,
    deliveryChecks: state.delivery?.preflight.checks.length ?? 0
  },
  flags: state.flags,
  budgets: state.budgets,
  verifyHistory: state.verifyHistory.map((item) => ({ ok: item.ok, step: item.step, summary: item.summary })),
  lastError: state.lastError,
  patchPaths: state.patchPaths,
  humanReviews: state.humanReviews,
  touchedFiles: state.touchedFiles.slice(-30)
});
