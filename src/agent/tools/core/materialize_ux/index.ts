import { existsSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { z } from "zod";
import { uxDesignV1Schema } from "../../../design/ux/schema.js";
import type { ToolPackage } from "../../types.js";

const inputSchema = z.object({
  ux: uxDesignV1Schema,
  projectRoot: z.string().min(1),
  apply: z.boolean().default(true)
});

const outputSchema = z.object({
  uxPath: z.string(),
  summary: z.object({
    wrote: z.number(),
    skipped: z.number()
  })
});

const ensureInside = (root: string, target: string): void => {
  const rel = relative(resolve(root), resolve(target));
  if (rel === ".." || rel.startsWith(`..${sep}`) || rel.split(sep).includes("..")) {
    throw new Error(`Refusing to write outside project root: ${target}`);
  }
};

const writeIfChanged = async (path: string, content: string, apply: boolean): Promise<"wrote" | "skipped"> => {
  if (!apply) return "skipped";
  if (existsSync(path) && readFileSync(path, "utf8") === content) {
    return "skipped";
  }
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content, "utf8");
  return "wrote";
};

const tsModule = (uxJson: string): string => `// Auto-generated UX design artifact
export const uxDesign = ${uxJson} as const;
`;

export const runMaterializeUx = async (args: {
  ux: z.infer<typeof uxDesignV1Schema>;
  projectRoot: string;
  apply: boolean;
}): Promise<z.infer<typeof outputSchema>> => {
  const root = resolve(args.projectRoot);
  const uxPath = join(root, "src/lib/design/ux.json");
  const uxTsPath = join(root, "src/lib/design/ux.ts");

  ensureInside(root, uxPath);
  ensureInside(root, uxTsPath);

  const uxJson = `${JSON.stringify(args.ux, null, 2)}\n`;
  const uxTs = tsModule(uxJson.trim());

  const results = await Promise.all([
    writeIfChanged(uxPath, uxJson, args.apply),
    writeIfChanged(uxTsPath, uxTs, args.apply)
  ]);

  const wrote = results.filter((v) => v === "wrote").length;
  return {
    uxPath,
    summary: {
      wrote: args.apply ? wrote : 0,
      skipped: args.apply ? results.length - wrote : results.length
    }
  };
};

export const toolPackage: ToolPackage<z.infer<typeof inputSchema>, z.infer<typeof outputSchema>> = {
  manifest: {
    name: "tool_materialize_ux",
    version: "1.0.0",
    category: "high",
    description: "Materializes UX design artifacts into project files.",
    capabilities: ["materialize", "ux", "fs"],
    inputSchema,
    outputSchema,
    safety: {
      sideEffects: "fs"
    }
  },
  runtime: {
    run: async (input) => {
      try {
        const data = await runMaterializeUx({
          ux: input.ux,
          projectRoot: input.projectRoot,
          apply: input.apply
        });
        return {
          ok: true,
          data,
          meta: {
            touchedPaths: [data.uxPath, join(resolve(input.projectRoot), "src/lib/design/ux.ts")]
          }
        };
      } catch (error) {
        return {
          ok: false,
          error: {
            code: "MATERIALIZE_UX_FAILED",
            message: error instanceof Error ? error.message : "ux materialization failed"
          }
        };
      }
    },
    examples: [
      {
        title: "Materialize UX files",
        toolCall: {
          name: "tool_materialize_ux",
          input: { ux: { version: "v1" }, projectRoot: "./generated/app", apply: true }
        },
        expected: "Writes ux.json and ux.ts in src/lib/design."
      }
    ]
  }
};
