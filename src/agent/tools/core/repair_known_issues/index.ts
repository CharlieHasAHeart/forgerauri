import { existsSync, readFileSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { z } from "zod";
import { assertPathInside } from "../../../../runtime/policy.js";
import type { ToolPackage } from "../../types.js";

const ICON_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==";

const inputSchema = z.object({
  projectRoot: z.string().min(1)
});

const outputSchema = z.object({
  ok: z.boolean(),
  changed: z.boolean(),
  fixes: z.array(
    z.object({
      id: z.string(),
      message: z.string(),
      paths: z.array(z.string())
    })
  ),
  summary: z.string()
});

type ToolOutput = z.infer<typeof outputSchema>;

type FixResult = {
  id: string;
  message: string;
  paths: string[];
};

type FixContext = {
  root: string;
  srcTauriDir: string;
  tauriConfPath: string;
  capabilitiesDefaultPath: string;
};

type TauriConf = {
  [key: string]: unknown;
  bundle?: {
    [key: string]: unknown;
    icon?: string[];
  };
};

const ensureInside = (root: string, target: string): void => {
  const rel = relative(resolve(root), resolve(target));
  if (rel === ".." || rel.startsWith(`..${sep}`) || rel.split(sep).includes("..")) {
    throw new Error(`Refusing to write outside project root: ${target}`);
  }
  assertPathInside(root, target);
};

const writeTextIfChanged = async (root: string, filePath: string, content: string): Promise<boolean> => {
  ensureInside(root, filePath);
  if (existsSync(filePath) && readFileSync(filePath, "utf8") === content) {
    return false;
  }
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, content, "utf8");
  return true;
};

const writeBinaryIfChanged = async (root: string, filePath: string, content: Buffer): Promise<boolean> => {
  ensureInside(root, filePath);
  if (existsSync(filePath)) {
    const existing = await readFile(filePath);
    if (existing.equals(content)) return false;
  }
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, content);
  return true;
};

const minimalTauriConf = (): TauriConf => ({
  $schema: "https://schema.tauri.app/config/2",
  productName: "App",
  version: "0.1.0",
  identifier: "com.forgetauri.app",
  build: {
    beforeDevCommand: "pnpm dev",
    beforeBuildCommand: "pnpm build",
    devUrl: "http://localhost:1420",
    frontendDist: "../dist"
  },
  app: {
    windows: [
      {
        title: "App",
        width: 900,
        height: 640
      }
    ]
  },
  bundle: {
    active: true,
    targets: "all",
    icon: ["icons/icon.png"]
  }
});

const normalizeConfDefaults = (conf: TauriConf): { normalized: TauriConf; changed: boolean } => {
  const next: TauriConf = structuredClone(conf);
  let changed = false;

  if (typeof next.$schema !== "string") {
    next.$schema = "https://schema.tauri.app/config/2";
    changed = true;
  }
  if (typeof next.productName !== "string") {
    next.productName = "App";
    changed = true;
  }
  if (typeof next.version !== "string") {
    next.version = "0.1.0";
    changed = true;
  }
  if (typeof next.identifier !== "string") {
    next.identifier = "com.forgetauri.app";
    changed = true;
  }

  const build = typeof next.build === "object" && next.build !== null ? (next.build as Record<string, unknown>) : {};
  const buildDefaults: Record<string, string> = {
    beforeDevCommand: "pnpm dev",
    beforeBuildCommand: "pnpm build",
    devUrl: "http://localhost:1420",
    frontendDist: "../dist"
  };
  for (const [key, value] of Object.entries(buildDefaults)) {
    if (typeof build[key] !== "string") {
      build[key] = value;
      changed = true;
    }
  }
  next.build = build;

  const app = typeof next.app === "object" && next.app !== null ? (next.app as Record<string, unknown>) : {};
  if (!Array.isArray(app.windows) || app.windows.length === 0) {
    app.windows = [
      {
        title: typeof next.productName === "string" ? next.productName : "App",
        width: 900,
        height: 640
      }
    ];
    changed = true;
  }
  next.app = app;

  const bundle = typeof next.bundle === "object" && next.bundle !== null ? (next.bundle as Record<string, unknown>) : {};
  if (typeof bundle.targets !== "string") {
    bundle.targets = "all";
    changed = true;
  }
  if (!Array.isArray(bundle.icon)) {
    bundle.icon = ["icons/icon.png"];
    changed = true;
  }
  next.bundle = bundle as TauriConf["bundle"];

  return { normalized: next, changed };
};

const readConf = async (ctx: FixContext): Promise<{ conf: TauriConf; raw: string | null }> => {
  if (!existsSync(ctx.tauriConfPath)) {
    return { conf: minimalTauriConf(), raw: null };
  }

  const raw = await readFile(ctx.tauriConfPath, "utf8");
  try {
    const parsed = JSON.parse(raw) as TauriConf;
    if (!parsed || typeof parsed !== "object") {
      return { conf: minimalTauriConf(), raw };
    }
    return { conf: parsed, raw };
  } catch {
    return { conf: minimalTauriConf(), raw };
  }
};

const fixEnsureTauriConfExists = async (ctx: FixContext): Promise<FixResult | null> => {
  const { conf, raw } = await readConf(ctx);
  const { normalized, changed } = normalizeConfDefaults(conf);
  const serialized = `${JSON.stringify(normalized, null, 2)}\n`;

  if (raw === null) {
    await writeTextIfChanged(ctx.root, ctx.tauriConfPath, serialized);
    return {
      id: "ensure_tauri_conf_exists",
      message: "Created missing src-tauri/tauri.conf.json with minimal defaults.",
      paths: [ctx.tauriConfPath]
    };
  }

  if (changed || raw !== serialized) {
    const didWrite = await writeTextIfChanged(ctx.root, ctx.tauriConfPath, serialized);
    if (didWrite) {
      return {
        id: "ensure_tauri_conf_fields",
        message: "Normalized missing/invalid tauri.conf.json fields.",
        paths: [ctx.tauriConfPath]
      };
    }
  }

  return null;
};

const normalizeIconValue = (value: string): string => {
  const cleaned = value.replace(/\\/g, "/").replace(/^\.\//, "");
  if (cleaned === "src-tauri/icons/icon.png" || cleaned === "./src-tauri/icons/icon.png") {
    return "icons/icon.png";
  }
  if (cleaned.startsWith("src-tauri/")) {
    return cleaned.slice("src-tauri/".length);
  }
  return cleaned;
};

const fixNormalizeIconPaths = async (ctx: FixContext): Promise<FixResult | null> => {
  const { conf } = await readConf(ctx);
  const bundle = typeof conf.bundle === "object" && conf.bundle !== null ? conf.bundle : {};

  const iconsRaw = Array.isArray(bundle.icon)
    ? bundle.icon.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : [];

  const nextIcons = iconsRaw.length > 0 ? iconsRaw.map((item) => normalizeIconValue(item)) : ["icons/icon.png"];

  let changed = iconsRaw.length !== nextIcons.length || iconsRaw.some((icon, idx) => icon !== nextIcons[idx]);

  const finalIcons = nextIcons.map((icon) => {
    const absolute = join(ctx.srcTauriDir, icon);
    if (!existsSync(absolute)) {
      if (!icon.endsWith(".png") || !icon.startsWith("icons/")) {
        changed = true;
        return "icons/icon.png";
      }
    }
    return icon;
  });

  if (!finalIcons.some((icon) => icon.endsWith(".png"))) {
    finalIcons.push("icons/icon.png");
    changed = true;
  }

  const deduped: string[] = [];
  for (const icon of finalIcons) {
    if (!deduped.includes(icon)) deduped.push(icon);
  }

  if (deduped.length !== finalIcons.length) changed = true;

  if (!changed) {
    return null;
  }

  const nextConf: TauriConf = {
    ...conf,
    bundle: {
      ...(typeof conf.bundle === "object" && conf.bundle ? conf.bundle : {}),
      icon: deduped
    }
  };

  await writeTextIfChanged(ctx.root, ctx.tauriConfPath, `${JSON.stringify(nextConf, null, 2)}\n`);
  return {
    id: "normalize_icon_paths",
    message: "Normalized bundle.icon paths to existing icons/*.png entries.",
    paths: [ctx.tauriConfPath]
  };
};

const fixEnsureIconPng = async (ctx: FixContext): Promise<FixResult | null> => {
  const { conf } = await readConf(ctx);
  const bundle = typeof conf.bundle === "object" && conf.bundle !== null ? conf.bundle : {};
  const icons = Array.isArray(bundle.icon)
    ? bundle.icon.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : ["icons/icon.png"];

  const iconData = Buffer.from(ICON_PNG_BASE64, "base64");
  const touched: string[] = [];

  for (const icon of icons) {
    const normalized = normalizeIconValue(icon);
    if (!normalized.endsWith(".png") || !normalized.startsWith("icons/")) continue;
    const absolute = join(ctx.srcTauriDir, normalized);
    const wrote = await writeBinaryIfChanged(ctx.root, absolute, iconData);
    if (wrote) touched.push(absolute);
  }

  if (touched.length === 0) {
    return null;
  }

  return {
    id: "ensure_icon_png",
    message: "Created missing icon PNG assets referenced by tauri.conf.json.",
    paths: touched
  };
};

const fixEnsureCapabilitiesDefault = async (ctx: FixContext): Promise<FixResult | null> => {
  const content = `${JSON.stringify(
    {
      $schema: "../gen/schemas/desktop-schema.json",
      identifier: "default",
      description: "Default capability",
      windows: ["main"],
      permissions: ["core:default"]
    },
    null,
    2
  )}\n`;

  const wrote = await writeTextIfChanged(ctx.root, ctx.capabilitiesDefaultPath, content);
  if (!wrote) {
    return null;
  }

  return {
    id: "ensure_capabilities_default",
    message: "Created missing src-tauri/capabilities/default.json.",
    paths: [ctx.capabilitiesDefaultPath]
  };
};

const fixers = [fixEnsureTauriConfExists, fixNormalizeIconPaths, fixEnsureIconPng, fixEnsureCapabilitiesDefault];

export const runRepairKnownIssues = async (args: { projectRoot: string }): Promise<ToolOutput> => {
  const root = resolve(args.projectRoot);
  const ctx: FixContext = {
    root,
    srcTauriDir: join(root, "src-tauri"),
    tauriConfPath: join(root, "src-tauri/tauri.conf.json"),
    capabilitiesDefaultPath: join(root, "src-tauri/capabilities/default.json")
  };

  const fixes: FixResult[] = [];

  for (const fixer of fixers) {
    const result = await fixer(ctx);
    if (result) fixes.push(result);
  }

  return {
    ok: true,
    changed: fixes.length > 0,
    fixes,
    summary: fixes.length > 0 ? `Applied ${fixes.length} deterministic known-issue fix(es)` : "No known deterministic issues found"
  };
};

export const toolPackage: ToolPackage<z.infer<typeof inputSchema>, z.infer<typeof outputSchema>> = {
  manifest: {
    name: "tool_repair_known_issues",
    version: "1.0.0",
    category: "high",
    description: "Deterministically repairs known Tauri packaging/config issues before LLM repair.",
    capabilities: ["repair", "deterministic", "known_issues"],
    inputSchema,
    outputSchema,
    safety: {
      sideEffects: "fs"
    }
  },
  runtime: {
    run: async (input) => {
      try {
        const data = await runRepairKnownIssues({ projectRoot: input.projectRoot });
        const touchedPaths = data.fixes.flatMap((fix) => fix.paths);
        return {
          ok: true,
          data,
          meta: {
            touchedPaths
          }
        };
      } catch (error) {
        return {
          ok: false,
          error: {
            code: "REPAIR_KNOWN_ISSUES_FAILED",
            message: error instanceof Error ? error.message : "known-issues repair failed"
          }
        };
      }
    },
    examples: [
      {
        title: "Repair common Tauri config issues",
        toolCall: {
          name: "tool_repair_known_issues",
          input: { projectRoot: "./generated/app" }
        },
        expected: "Creates missing icon/capabilities/tauri config files and normalizes icon paths when needed."
      }
    ]
  }
};
