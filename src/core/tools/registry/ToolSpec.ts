import type { ToolDocPack as CoreToolDocPack, ToolSpec as CoreToolSpec } from "../../contracts/tools.js";

export type ToolSpec<TInput = unknown> = CoreToolSpec<TInput>;
export type ToolDocPack = CoreToolDocPack;
