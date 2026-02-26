import type { AgentState, ErrorKind, VerifyProjectResult } from "../types.js";

export const truncate = (value: string, max = 4000): string => (value.length > max ? `${value.slice(0, max)}...<truncated>` : value);

export const classifyFromVerify = (result: VerifyProjectResult): ErrorKind => result.classifiedError;

export const setStateError = (state: AgentState, kind: ErrorKind, message: string): void => {
  state.lastError = { kind, message };
};
