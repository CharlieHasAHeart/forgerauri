export type PostResponsesArgs = {
  baseUrl: string;
  apiKey: string;
  body: Record<string, unknown>;
  timeoutMs: number;
};

export type PostResponsesResult = {
  status: number;
  json?: unknown;
  text: string;
  error?: string;
};

const truncate = (value: string, max = 500): string => (value.length > max ? `${value.slice(0, max)}...<truncated>` : value);

export const redact = (value: string, apiKey?: string): string => {
  let out = value;
  if (apiKey && apiKey.length > 6) {
    out = out.split(apiKey).join("***REDACTED_API_KEY***");
  }
  out = out.replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer ***REDACTED***");
  return truncate(out, 500);
};

export const postResponses = async (args: PostResponsesArgs): Promise<PostResponsesResult> => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), args.timeoutMs);

  try {
    const response = await fetch(`${args.baseUrl.replace(/\/$/, "")}/responses`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${args.apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(args.body),
      signal: controller.signal
    });

    const text = await response.text();
    let json: unknown | undefined;
    try {
      json = JSON.parse(text) as unknown;
    } catch {
      json = undefined;
    }

    return {
      status: response.status,
      json,
      text: redact(text, args.apiKey)
    };
  } catch (error) {
    return {
      status: 0,
      text: "",
      error: error instanceof Error ? redact(error.message, args.apiKey) : "request failed"
    };
  } finally {
    clearTimeout(timeout);
  }
};

export const parseOutput = (json: unknown): {
  text: string;
  itemTypes: string[];
  refusals: string[];
  functionCalls: Array<{ name: string; arguments: string; call_id: string }>;
} => {
  const root = (json ?? {}) as Record<string, unknown>;
  const output = Array.isArray(root.output) ? root.output : [];

  const textChunks: string[] = [];
  const itemTypes: string[] = [];
  const refusals: string[] = [];
  const functionCalls: Array<{ name: string; arguments: string; call_id: string }> = [];

  const pushType = (type: unknown): void => {
    if (typeof type === "string" && type.length > 0) itemTypes.push(type);
  };

  for (const item of output) {
    const obj = item as Record<string, unknown>;
    pushType(obj.type);

    if (obj.type === "function_call") {
      const name = typeof obj.name === "string" ? obj.name : "";
      if (name) {
        functionCalls.push({
          name,
          arguments: typeof obj.arguments === "string" ? obj.arguments : "",
          call_id: typeof obj.call_id === "string" ? obj.call_id : typeof obj.id === "string" ? obj.id : ""
        });
      }
    }

    if (obj.type === "refusal") {
      const refusal = typeof obj.refusal === "string" ? obj.refusal : typeof obj.text === "string" ? obj.text : "";
      if (refusal) refusals.push(refusal);
    }

    const content = obj.content;
    if (!Array.isArray(content)) continue;

    for (const part of content) {
      const p = part as Record<string, unknown>;
      pushType(p.type);

      if (p.type === "output_text" && typeof p.text === "string") {
        textChunks.push(p.text);
      }

      if (p.type === "refusal") {
        const refusal = typeof p.refusal === "string" ? p.refusal : typeof p.text === "string" ? p.text : "";
        if (refusal) refusals.push(refusal);
      }

      if (p.type === "function_call") {
        const name = typeof p.name === "string" ? p.name : "";
        if (name) {
          functionCalls.push({
            name,
            arguments: typeof p.arguments === "string" ? p.arguments : "",
            call_id: typeof p.call_id === "string" ? p.call_id : typeof p.id === "string" ? p.id : ""
          });
        }
      }
    }
  }

  return {
    text: truncate(textChunks.join(""), 500),
    itemTypes: Array.from(new Set(itemTypes)),
    refusals,
    functionCalls
  };
};
