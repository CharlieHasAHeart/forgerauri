export type PlanActionType = "CREATE" | "OVERWRITE" | "SKIP" | "PATCH";

export type FileWriteMode = "generated" | "user" | "unknown";

export type PlanEntryType = "file" | "dir";

export type PlanAction = {
  type: PlanActionType;
  path: string;
  entryType: PlanEntryType;
  reason: string;
  safe: boolean;
  mode: FileWriteMode;
  content?: string;
  patch?: string;
  patchText?: string;
  patchFilePath?: string;
};

export type Plan = {
  outDir: string;
  appDir: string;
  actions: PlanAction[];
};
