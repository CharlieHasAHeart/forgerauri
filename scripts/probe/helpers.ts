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

export type ProbeStatus = "supported" | "ignored" | "rejected" | "flaky" | "unknown";

export type ParsedOutput = {
  text: string;
  itemTypes: string[];
  contentTypes: string[];
  refusals: string[];
  functionCalls: Array<{ name: string; arguments: string; call_id: string }>;
};

const truncate = (value: string, max = 500): string => (value.length > max ? `${value.slice(0, max)}...<truncated>` : value);

export const sleep = async (ms: number): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, ms));
};

export const redact = (value: string, apiKey?: string): string => {
  let out = value;
  if (apiKey && apiKey.length > 6) {
    out = out.split(apiKey).join("***REDACTED_API_KEY***");
  }
  out = out.replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer ***REDACTED***");
  return truncate(out, 500);
};

export const extractUsage = (json: unknown): unknown => {
  const root = (json ?? {}) as Record<string, unknown>;
  return root.usage;
};

export const detectError = (result: PostResponsesResult): string | undefined => {
  if (result.error) return truncate(result.error, 500);

  const root = (result.json ?? {}) as Record<string, unknown>;
  const err = (root.error ?? {}) as Record<string, unknown>;
  const code = typeof err.code === "string" ? err.code : "";
  const message = typeof err.message === "string" ? err.message : "";

  if (code || message) {
    return truncate(`${code}${code && message ? ": " : ""}${message}`, 500);
  }

  if (result.status >= 400) return truncate(result.text, 500);
  return undefined;
};

const isRetriableStatus = (status: number): boolean => status === 429 || status >= 500 || status === 0;

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

export const postResponsesWithRetry = async (
  args: PostResponsesArgs,
  retryCount = 1
): Promise<PostResponsesResult> => {
  let result = await postResponses(args);

  for (let i = 0; i < retryCount; i += 1) {
    if (!isRetriableStatus(result.status)) break;
    await sleep(i === 0 ? 500 : 1000);
    result = await postResponses(args);
  }

  return result;
};

export const classifyAcceptability = (result: PostResponsesResult): ProbeStatus => {
  if (result.status === 200) return "supported";
  if (result.status === 0) return "flaky";

  const snippet = detectError(result)?.toLowerCase() ?? "";
  if (result.status >= 400 && /unknown|unsupported|invalid|unexpected|not allowed|unrecognized/.test(snippet)) {
    return "rejected";
  }

  if (result.status >= 400) return "rejected";
  return "unknown";
};

export const parseOutput = (json: unknown): ParsedOutput => {
  const root = (json ?? {}) as Record<string, unknown>;
  const output = Array.isArray(root.output) ? root.output : [];

  const textChunks: string[] = [];
  const itemTypes: string[] = [];
  const contentTypes: string[] = [];
  const refusals: string[] = [];
  const functionCalls: Array<{ name: string; arguments: string; call_id: string }> = [];

  const pushType = (target: string[], type: unknown): void => {
    if (typeof type === "string" && type.length > 0) target.push(type);
  };

  for (const item of output) {
    const obj = item as Record<string, unknown>;
    pushType(itemTypes, obj.type);

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
      pushType(contentTypes, p.type);

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

  const fallback = typeof root.output_text === "string" ? root.output_text : "";

  return {
    text: truncate(textChunks.length > 0 ? textChunks.join("") : fallback, 500),
    itemTypes: Array.from(new Set(itemTypes)),
    contentTypes: Array.from(new Set(contentTypes)),
    refusals,
    functionCalls
  };
};
