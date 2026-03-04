import type { AgentState, ErrorKind } from "../../contracts/state.js";

export const truncate = (value: string, max = 400): string => (value.length > max ? `${value.slice(0, max)}...` : value);

export const setStateError = (state: AgentState, kind: ErrorKind, message: string, code?: string): void => {
  state.lastError = {
    kind,
    code,
    message
  };
};
