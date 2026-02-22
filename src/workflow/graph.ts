import { END, START, StateGraph } from "@langchain/langgraph";
import {
  node_apply_plan,
  node_build_plan,
  node_llm_enrich_spec,
  node_load_spec,
  node_repair,
  node_verify
} from "./nodes.js";
import { WorkflowStateAnnotation, type WorkflowState } from "./state.js";

const routeAfterLoad = (state: WorkflowState): "llm_enrich_spec" | "build_plan" =>
  state.flags.llmEnrich ? "llm_enrich_spec" : "build_plan";

const routeAfterBuild = (state: WorkflowState): "apply_plan" | typeof END => {
  if (state.errors.length > 0) return END;
  return state.flags.apply ? "apply_plan" : END;
};

const routeAfterApply = (state: WorkflowState): "verify" | typeof END => {
  if (state.errors.length > 0) return END;
  return state.flags.verify ? "verify" : END;
};

const routeAfterVerify = (state: WorkflowState): "repair" | typeof END => {
  if (state.errors.length > 0) return END;
  if (state.flags.repair && state.verifyResult && !state.verifyResult.ok) {
    return "repair";
  }
  return END;
};

const compiled = new StateGraph(WorkflowStateAnnotation)
  .addNode("load_spec", node_load_spec)
  .addNode("llm_enrich_spec", node_llm_enrich_spec)
  .addNode("build_plan", node_build_plan)
  .addNode("apply_plan", node_apply_plan)
  .addNode("verify", node_verify)
  .addNode("repair", node_repair)
  .addEdge(START, "load_spec")
  .addConditionalEdges("load_spec", routeAfterLoad)
  .addEdge("llm_enrich_spec", "build_plan")
  .addConditionalEdges("build_plan", routeAfterBuild)
  .addConditionalEdges("apply_plan", routeAfterApply)
  .addConditionalEdges("verify", routeAfterVerify)
  .addEdge("repair", END)
  .compile();

export const invokeGraph = async (initialState: WorkflowState): Promise<WorkflowState> => {
  const result = await compiled.invoke(initialState);
  return result;
};
