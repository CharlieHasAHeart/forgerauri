import { z } from "zod";
import type { LlmProvider } from "../llm/provider.js";

const typePattern = /^(string|boolean|int|float|timestamp|json)\??$/;
const schemaDict = z.record(z.string(), z.string().regex(typePattern));

const enrichSchema = z.object({
  commands: z.record(z.string(), z.object({ input: schemaDict, output: schemaDict })),
  screens: z.record(z.string(), z.object({ purpose: z.string() })).optional(),
  mvp_plan: z.array(z.string()).optional()
});

const commandSnapshot = (wire: any): Array<{ name: string; purpose?: string; input?: unknown; output?: unknown }> =>
  Array.isArray(wire?.rust_commands)
    ? wire.rust_commands.map((cmd: any) => ({
        name: cmd?.name,
        purpose: cmd?.purpose,
        input: cmd?.input,
        output: cmd?.output
      }))
    : [];

const screenSnapshot = (wire: any): Array<{ name: string; purpose?: string }> =>
  Array.isArray(wire?.screens)
    ? wire.screens.map((screen: any) => ({ name: screen?.name, purpose: screen?.purpose }))
    : [];

export const enrichWireSpecWithLLM = async (args: {
  wire: unknown;
  provider: LlmProvider;
  budget?: { maxAttempts: number };
}): Promise<{ wireEnriched: unknown; used: boolean; raw?: string }> => {
  const wire = args.wire as any;
  const request = {
    commands: commandSnapshot(wire),
    screens: screenSnapshot(wire),
    mvp_plan: wire?.mvp_plan
  };

  const messages = [
    {
      role: "system" as const,
      content:
        "Return JSON only. Fill missing rust command input/output as flat field dictionaries with type strings: string|boolean|int|float|timestamp|json with optional ?. Do not modify command names, screen names, app name, or data_model table/column names."
    },
    {
      role: "user" as const,
      content: JSON.stringify(request, null, 2)
    }
  ];

  const { data, raw } = await args.provider.completeJSON(messages, enrichSchema, {
    maxOutputTokens: 3000,
    temperature: 0
  });

  const enriched = JSON.parse(JSON.stringify(wire));

  const commandMap = new Map<string, { input: Record<string, string>; output: Record<string, string> }>(
    Object.entries(data.commands)
  );

  if (Array.isArray(enriched.rust_commands)) {
    enriched.rust_commands = enriched.rust_commands.map((cmd: any) => {
      const patch = commandMap.get(cmd?.name);
      if (!patch) return cmd;
      return {
        ...cmd,
        input: patch.input,
        output: patch.output
      };
    });
  }

  if (data.screens && Array.isArray(enriched.screens)) {
    const screenMap = new Map<string, { purpose: string }>(Object.entries(data.screens));
    enriched.screens = enriched.screens.map((screen: any) => {
      const patch = screenMap.get(screen?.name);
      if (!patch) return screen;
      return { ...screen, purpose: patch.purpose };
    });
  }

  if (data.mvp_plan && Array.isArray(data.mvp_plan)) {
    enriched.mvp_plan = data.mvp_plan;
  }

  return { wireEnriched: enriched, used: true, raw };
};
