/**
 * @deprecated Compatibility shim.
 * Use `src/agent/planning/planner.ts` (or `src/agent/index.ts` for public API) directly.
 */
export {
  proposeNextActions,
  proposePlan,
  proposePlanChange,
  proposeTaskActionPlan
} from "./planning/planner.js";
export { renderToolIndex } from "./planning/tool_index.js";
