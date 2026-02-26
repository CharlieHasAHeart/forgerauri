import type { AgentState } from "../types.js";

export const setUsedTurn = (state: AgentState, turn: number): void => {
  state.budgets.usedTurns = turn;
};

export const canRetryTask = (state: AgentState): boolean => state.budgets.usedTurns <= state.budgets.maxTurns;
