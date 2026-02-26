import { readFile, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { z } from "zod";
import type { ToolDocPack, ToolPackage, ToolSpec } from "./types.js";
import { wrapToolRunWithOutputValidation } from "./util.js";

const toJsonSchema = (schema: z.ZodTypeAny): unknown => {
  const anyZ = z as unknown as { toJSONSchema?: (s: z.ZodTypeAny) => unknown };
  if (typeof anyZ.toJSONSchema === "function") return anyZ.toJSONSchema(schema);
  return { type: "object" };
};

const compactDoc = (doc: string): string => {
  const keep = new Set([
    "what it does",
    "when to use",
    "inputs",
    "outputs",
    "examples",
    "failure handling",
    "constraints / safety",
    "side effects"
  ]);

  const lines = doc.replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];
  let include = true;

  for (const line of lines) {
    const h = line.match(/^##\s+(.+)$/);
    if (h) {
      const key = h[1].trim().toLowerCase();
      include = keep.has(key);
    }
    if (line.startsWith("# ")) {
      include = true;
    }
    if (include) {
      out.push(line);
    }
  }

  return out.join("\n").trim();
};

const readDocs = async (toolDir: string): Promise<string> => {
  const docPath = join(toolDir, "README.md");
  try {
    const content = await readFile(docPath, "utf8");
    return compactDoc(content);
  } catch {
    return "";
  }
};

const normalizePackage = async (toolDir: string, toolPkg: ToolPackage): Promise<ToolSpec> => {
  const docs = await readDocs(toolDir);
  const inputJsonSchema = toJsonSchema(toolPkg.manifest.inputSchema);
  const outputJsonSchema = toolPkg.manifest.outputSchema ? toJsonSchema(toolPkg.manifest.outputSchema) : undefined;

  const spec: ToolSpec = {
    name: toolPkg.manifest.name,
    description: toolPkg.manifest.description,
    inputSchema: toolPkg.manifest.inputSchema,
    inputJsonSchema,
    outputSchema: toolPkg.manifest.outputSchema,
    outputJsonSchema,
    category: toolPkg.manifest.category,
    capabilities: [...toolPkg.manifest.capabilities],
    safety: { ...toolPkg.manifest.safety, allowlist: toolPkg.manifest.safety.allowlist ? [...toolPkg.manifest.safety.allowlist] : undefined },
    docs,
    run: async () => ({ ok: false, error: { code: "UNINITIALIZED", message: "tool run not initialized" } }),
    examples: toolPkg.runtime.examples ?? []
  };

  spec.run = wrapToolRunWithOutputValidation(spec, toolPkg.runtime.run as ToolSpec["run"]);
  return spec;
};

export const loadToolPackages = async (baseDir?: string): Promise<Record<string, ToolSpec>> => {
  const toolsRoot = baseDir ?? dirname(fileURLToPath(import.meta.url));
  const roots = [join(toolsRoot, "checks"), join(toolsRoot, "core"), toolsRoot];
  const collected = new Set<string>();
  for (const root of roots) {
    try {
      const entries = await readdir(root, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const dir = join(root, entry.name);
        collected.add(dir);
      }
    } catch {
      // ignore missing roots
    }
  }
  const toolDirs = Array.from(collected).sort((a, b) => a.localeCompare(b));

  const tools: ToolSpec[] = [];

  for (const toolDir of toolDirs) {
    const moduleUrl = pathToFileURL(join(toolDir, "index.ts")).href;
    let mod: unknown;
    try {
      mod = await import(moduleUrl);
    } catch {
      const jsUrl = pathToFileURL(join(toolDir, "index.js")).href;
      try {
        mod = await import(jsUrl);
      } catch {
        continue;
      }
    }

    const pkg = (mod as { toolPackage?: ToolPackage }).toolPackage;
    if (!pkg) continue;
    tools.push(await normalizePackage(toolDir, pkg));
  }

  return Object.fromEntries(tools.map((tool) => [tool.name, tool]));
};

export const buildToolDocPack = (registry: Record<string, ToolSpec>): ToolDocPack[] =>
  Object.values(registry)
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((tool) => ({
      name: tool.name,
      category: tool.category,
      summary: tool.description,
      inputJsonSchema: tool.inputJsonSchema,
      outputJsonSchema: tool.outputJsonSchema,
      docs: tool.docs,
      examples: tool.examples ?? [],
      safety: tool.safety
    }));
