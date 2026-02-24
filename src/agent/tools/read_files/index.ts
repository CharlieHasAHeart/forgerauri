import { readFile, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { z } from "zod";
import type { ToolPackage } from "../types.js";

const inputSchema = z.object({
  projectRoot: z.string().min(1),
  globs: z.array(z.string()).min(1),
  maxChars: z.number().int().positive().max(200000).optional()
});

const outputSchema = z.object({
  files: z.array(z.object({ path: z.string(), content: z.string(), truncated: z.boolean() })),
  total: z.number(),
  totalChars: z.number()
});

const globToRegex = (glob: string): RegExp => {
  const escaped = glob
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, "::DOUBLE_STAR::")
    .replace(/\*/g, "[^/]*")
    .replace(/::DOUBLE_STAR::/g, ".*");
  return new RegExp(`^${escaped}$`);
};

const listFiles = async (root: string): Promise<string[]> => {
  const stack = [root];
  const out: string[] = [];
  while (stack.length > 0) {
    const current = stack.pop() as string;
    try {
      const entries = await readdir(current, { withFileTypes: true });
      entries.forEach((entry) => {
        const full = join(current, entry.name);
        if (entry.isDirectory()) stack.push(full);
        else out.push(full.replace(`${root}/`, "").replace(/\\/g, "/"));
      });
    } catch {
      continue;
    }
  }
  return out.sort((a, b) => a.localeCompare(b));
};

export const toolPackage: ToolPackage<z.infer<typeof inputSchema>, z.infer<typeof outputSchema>> = {
  manifest: {
    name: "tool_read_files",
    version: "1.0.0",
    category: "low",
    description: "Read project files using glob patterns for additional context.",
    capabilities: ["fs", "context", "read-only"],
    inputSchema,
    outputSchema,
    safety: {
      sideEffects: "none"
    }
  },
  runtime: {
    run: async (input) => {
      try {
        const root = resolve(input.projectRoot);
        const files = await listFiles(root);
        const regexes = input.globs.map(globToRegex);
        const picked = files.filter((path) => regexes.some((regex) => regex.test(path)));

        const maxChars = input.maxChars ?? 100000;
        let used = 0;
        const out: Array<{ path: string; content: string; truncated: boolean }> = [];

        for (const rel of picked) {
          if (used >= maxChars) break;
          const text = await readFile(join(root, rel), "utf8");
          const remain = maxChars - used;
          if (text.length <= remain) {
            out.push({ path: rel, content: text, truncated: false });
            used += text.length;
          } else {
            out.push({ path: rel, content: `${text.slice(0, remain)}\n/* ...truncated... */\n`, truncated: true });
            used += remain;
            break;
          }
        }

        return {
          ok: true,
          data: { files: out, total: out.length, totalChars: used },
          meta: { touchedPaths: out.map((item) => item.path) }
        };
      } catch (error) {
        return {
          ok: false,
          error: {
            code: "READ_FILES_FAILED",
            message: error instanceof Error ? error.message : "read files failed"
          }
        };
      }
    },
    examples: [
      {
        title: "Read generated screen files",
        toolCall: { name: "tool_read_files", input: { projectRoot: "./generated/app", globs: ["src/lib/screens/generated/**"], maxChars: 20000 } },
        expected: "Returns file snippets for model context."
      }
    ]
  }
};
