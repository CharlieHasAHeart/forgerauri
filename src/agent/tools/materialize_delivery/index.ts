import { existsSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { z } from "zod";
import { deliveryDesignV1Schema } from "../../design/delivery/schema.js";
import type { ToolPackage } from "../types.js";

const ICON_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==";

const inputSchema = z.object({
  delivery: deliveryDesignV1Schema,
  projectRoot: z.string().min(1),
  apply: z.boolean().default(true)
});

const outputSchema = z.object({
  deliveryPath: z.string(),
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

const writeIfChangedText = async (path: string, content: string, apply: boolean): Promise<"wrote" | "skipped"> => {
  if (!apply) return "skipped";
  if (existsSync(path) && readFileSync(path, "utf8") === content) return "skipped";
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content, "utf8");
  return "wrote";
};

const writeIfChangedBinary = async (path: string, data: Buffer, apply: boolean): Promise<"wrote" | "skipped"> => {
  if (!apply) return "skipped";
  if (existsSync(path) && readFileSync(path).equals(data)) return "skipped";
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, data);
  return "wrote";
};

const tsModule = (deliveryJson: string): string => `// Auto-generated delivery design artifact
export const deliveryDesign = ${deliveryJson} as const;
`;

const shellScript = (checks: Array<{ id: string; description: string; cmd?: string; required: boolean }>): string => {
  const lines: string[] = [
    "#!/usr/bin/env bash",
    "set -u",
    "",
    "echo \"ForgeTauri preflight checks\""
  ];

  for (const check of checks) {
    lines.push("", `echo \"- ${check.id}: ${check.description}\"`);
    if (check.cmd) {
      lines.push(`${check.cmd} >/dev/null 2>&1`);
      lines.push("if [ $? -eq 0 ]; then");
      lines.push(`  echo \"  ok: ${check.id}\"`);
      lines.push("else");
      lines.push(
        check.required
          ? `  echo \"  required check failed: ${check.id}\"`
          : `  echo \"  optional check failed: ${check.id}\"`
      );
      lines.push("fi");
    }
  }

  lines.push("", "echo \"Preflight checks complete\"");
  return `${lines.join("\n")}\n`;
};

export const runMaterializeDelivery = async (args: {
  delivery: z.infer<typeof deliveryDesignV1Schema>;
  projectRoot: string;
  apply: boolean;
}): Promise<z.infer<typeof outputSchema>> => {
  const root = resolve(args.projectRoot);
  const deliveryPath = join(root, "src/lib/design/delivery.json");
  const deliveryTsPath = join(root, "src/lib/design/delivery.ts");
  const preflightPath = join(root, "scripts/preflight.sh");
  const iconPath = join(root, "src-tauri/icons/icon.png");

  [deliveryPath, deliveryTsPath, preflightPath, iconPath].forEach((path) => ensureInside(root, path));

  const deliveryJson = `${JSON.stringify(args.delivery, null, 2)}\n`;
  const deliveryTs = tsModule(deliveryJson.trim());
  const preflight = shellScript(args.delivery.preflight.checks);

  const results: Array<"wrote" | "skipped"> = [];
  results.push(await writeIfChangedText(deliveryPath, deliveryJson, args.apply));
  results.push(await writeIfChangedText(deliveryTsPath, deliveryTs, args.apply));
  results.push(await writeIfChangedText(preflightPath, preflight, args.apply));

  if (args.delivery.assets.icons.required) {
    const iconData = Buffer.from(ICON_PNG_BASE64, "base64");
    results.push(await writeIfChangedBinary(iconPath, iconData, args.apply));
  }

  const wrote = results.filter((value) => value === "wrote").length;

  return {
    deliveryPath,
    summary: {
      wrote: args.apply ? wrote : 0,
      skipped: args.apply ? results.length - wrote : results.length
    }
  };
};

export const toolPackage: ToolPackage<z.infer<typeof inputSchema>, z.infer<typeof outputSchema>> = {
  manifest: {
    name: "tool_materialize_delivery",
    version: "1.0.0",
    category: "high",
    description: "Materializes delivery policy artifacts and required placeholder assets.",
    capabilities: ["materialize", "delivery", "assets", "fs"],
    inputSchema,
    outputSchema,
    safety: {
      sideEffects: "fs"
    }
  },
  runtime: {
    run: async (input) => {
      try {
        const data = await runMaterializeDelivery({
          delivery: input.delivery,
          projectRoot: input.projectRoot,
          apply: input.apply
        });

        const touchedPaths = [
          data.deliveryPath,
          join(resolve(input.projectRoot), "src/lib/design/delivery.ts"),
          join(resolve(input.projectRoot), "scripts/preflight.sh")
        ];
        if (input.delivery.assets.icons.required) {
          touchedPaths.push(join(resolve(input.projectRoot), "src-tauri/icons/icon.png"));
        }

        return {
          ok: true,
          data,
          meta: { touchedPaths }
        };
      } catch (error) {
        return {
          ok: false,
          error: {
            code: "MATERIALIZE_DELIVERY_FAILED",
            message: error instanceof Error ? error.message : "delivery materialization failed"
          }
        };
      }
    },
    examples: [
      {
        title: "Materialize delivery outputs",
        toolCall: {
          name: "tool_materialize_delivery",
          input: { delivery: { version: "v1" }, projectRoot: "./generated/app", apply: true }
        },
        expected: "Writes delivery artifacts and optional placeholder icon."
      }
    ]
  }
};
