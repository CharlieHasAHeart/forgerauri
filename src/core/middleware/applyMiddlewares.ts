import type { KernelHooks } from "../contracts/hooks.js";
import type { LlmPort } from "../contracts/llm.js";
import type { AgentState } from "../contracts/state.js";
import type { ToolRunContext, ToolSpec } from "../contracts/tools.js";
import type { KernelMiddleware } from "./types.js";

const chainHooks = <TArgs>(handlers: Array<((args: TArgs) => void | Promise<void>) | undefined>): ((args: TArgs) => Promise<void>) | undefined => {
  const active = handlers.filter((item): item is (args: TArgs) => void | Promise<void> => typeof item === "function");
  if (active.length === 0) return undefined;
  return async (args: TArgs): Promise<void> => {
    for (const handler of active) {
      await handler(args);
    }
  };
};

export const applyMiddlewares = async (args: {
  middlewares?: KernelMiddleware[];
  ctx: ToolRunContext;
  state: AgentState;
  registry: Record<string, ToolSpec<any>>;
  provider: LlmPort;
  hooks?: KernelHooks;
}): Promise<{ registry: Record<string, ToolSpec<any>>; provider: LlmPort; hooks?: KernelHooks }> => {
  const middlewares = args.middlewares ?? [];
  if (middlewares.length === 0) {
    return {
      registry: args.registry,
      provider: args.provider,
      hooks: args.hooks
    };
  }

  for (const middleware of middlewares) {
    if (middleware.init) {
      await middleware.init({ ctx: args.ctx, state: args.state });
    }
  }

  let registry = args.registry;
  for (const middleware of middlewares) {
    if (!middleware.tools) continue;
    const extra = middleware.tools();
    if (!extra || typeof extra !== "object") continue;

    if (registry === args.registry) {
      registry = { ...args.registry };
    }

    for (const [name, spec] of Object.entries(extra)) {
      const existing = registry[name];
      if (existing && existing !== spec) {
        throw new Error(`Tool collision: ${name} from middleware ${middleware.name} already exists`);
      }
      registry[name] = spec;
    }
  }

  let provider = args.provider;
  for (const middleware of middlewares) {
    if (middleware.wrapProvider) {
      provider = middleware.wrapProvider(provider);
    }
  }

  const onToolResult = chainHooks([
    args.hooks?.onToolResult,
    ...middlewares.map((mw) => mw.hooks?.onToolResult)
  ]);
  const onPatchPathsChanged = chainHooks([
    args.hooks?.onPatchPathsChanged,
    ...middlewares.map((mw) => mw.hooks?.onPatchPathsChanged)
  ]);

  const hooks: KernelHooks | undefined = onToolResult || onPatchPathsChanged ? { onToolResult, onPatchPathsChanged } : undefined;

  return { registry, provider, hooks };
};
