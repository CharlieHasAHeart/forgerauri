import { z } from "zod";
import type { LlmProvider } from "../../../llm/provider.js";

const patchSchema = z.object({
  filePath: z.string().min(1).refine((value) => !value.startsWith("/") && !value.includes(".."), "relative path only"),
  newContent: z.string(),
  reason: z.string().min(1)
});

const responseSchema = z.object({
  patches: z.array(patchSchema).max(5)
});

export type ProposedPatch = z.infer<typeof patchSchema>;

export const proposeRepairsWithLLM = async (args: {
  projectRoot: string;
  command: string;
  stdout: string;
  stderr: string;
  filesSnapshot: Array<{ path: string; content: string }>;
  provider: LlmProvider;
}): Promise<{ patches: ProposedPatch[]; raw: string }> => {
  const prompt = {
    projectRoot: args.projectRoot,
    command: args.command,
    stdout: args.stdout,
    stderr: args.stderr,
    filesSnapshot: args.filesSnapshot
  };

  const messages = [
    {
      role: "system" as const,
      content:
        "You are a code repair assistant. Return JSON only: { patches:[{filePath,newContent,reason}] }. Max 5 patches, relative paths only, no path traversal."
    },
    { role: "user" as const, content: JSON.stringify(prompt, null, 2) }
  ];

  const { data, raw } = await args.provider.completeJSON(messages, responseSchema, {
    temperature: 0,
    maxOutputTokens: 4000
  });

  return { patches: data.patches, raw };
};
