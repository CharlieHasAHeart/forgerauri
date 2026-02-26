import { existsSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { z } from "zod";
import { implementationDesignV1Schema } from "../../../design/implementation/schema.js";
import type { ToolPackage } from "../../types.js";

const inputSchema = z.object({
  impl: implementationDesignV1Schema,
  projectRoot: z.string().min(1),
  apply: z.boolean().default(true)
});

const outputSchema = z.object({
  implPath: z.string(),
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

const tsModule = (implJson: string): string => `// Auto-generated implementation design artifact
export const implementationDesign = ${implJson} as const;
`;

export const runMaterializeImplementation = async (args: {
  impl: z.infer<typeof implementationDesignV1Schema>;
  projectRoot: string;
  apply: boolean;
}): Promise<z.infer<typeof outputSchema>> => {
  const root = resolve(args.projectRoot);
  const implPath = join(root, "src/lib/design/implementation.json");
  const implTsPath = join(root, "src/lib/design/implementation.ts");

  ensureInside(root, implPath);
  ensureInside(root, implTsPath);

  const implJson = `${JSON.stringify(args.impl, null, 2)}\n`;
  const implTs = tsModule(implJson.trim());

  const results = await Promise.all([
    writeIfChanged(implPath, implJson, args.apply),
    writeIfChanged(implTsPath, implTs, args.apply)
  ]);

  const wrote = results.filter((v) => v === "wrote").length;
  return {
    implPath,
    summary: {
      wrote: args.apply ? wrote : 0,
      skipped: args.apply ? results.length - wrote : results.length
    }
  };
};

export const toolPackage: ToolPackage<z.infer<typeof inputSchema>, z.infer<typeof outputSchema>> = {
  manifest: {
    name: "tool_materialize_implementation",
    version: "1.0.0",
    category: "high",
    description: "Materializes implementation design artifacts into project files.",
    capabilities: ["materialize", "implementation", "fs"],
    inputSchema,
    outputSchema,
    safety: {
      sideEffects: "fs"
    }
  },
  runtime: {
    run: async (input) => {
      try {
        const data = await runMaterializeImplementation({
          impl: input.impl,
          projectRoot: input.projectRoot,
          apply: input.apply
        });

        return {
          ok: true,
          data,
          meta: { touchedPaths: [data.implPath, join(resolve(input.projectRoot), "src/lib/design/implementation.ts")] }
        };
      } catch (error) {
        return {
          ok: false,
          error: {
            code: "MATERIALIZE_IMPLEMENTATION_FAILED",
            message: error instanceof Error ? error.message : "implementation materialization failed"
          }
        };
      }
    },
    examples: [
      {
        title: "Materialize implementation files",
        toolCall: {
          name: "tool_materialize_implementation",
          input: { impl: { version: "v1" }, projectRoot: "./generated/app", apply: true }
        },
        expected: "Writes implementation.json and implementation.ts in src/lib/design."
      }
    ]
  }
};
