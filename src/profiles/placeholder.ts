import type { CoreRunDeps, CoreRunRequest, CoreRunRuntime } from "../core/agent/flow/runAgent.js";

export type AgentProfile = {
  name: string;
  build: (input: { goal: string; specPath: string }) => {
    request: CoreRunRequest;
    runtime: CoreRunRuntime;
    deps: CoreRunDeps;
  };
};

export const placeholderProfile: AgentProfile = {
  name: "placeholder",
  build: () => {
    throw new Error("placeholderProfile.build not implemented yet");
  }
};
