export type ParsedResponseFunctionCall = {
  name: string;
  arguments: string;
  call_id: string;
};

export type ParsedResponsesOutput = {
  text: string;
  refusals: string[];
  functionCalls: ParsedResponseFunctionCall[];
  output: unknown[];
};

const toString = (value: unknown): string => (typeof value === "string" ? value : "");

const parseMessageContent = (
  content: unknown,
  acc: { textChunks: string[]; refusals: string[]; functionCalls: ParsedResponseFunctionCall[] }
): void => {
  if (!Array.isArray(content)) return;

  for (const part of content) {
    const partObj = part as Record<string, unknown>;
    const type = toString(partObj.type);

    if (type === "output_text") {
      const text = toString(partObj.text);
      if (text.length > 0) acc.textChunks.push(text);
      continue;
    }

    if (type === "refusal") {
      const refusal = toString(partObj.refusal) || toString(partObj.text);
      if (refusal.length > 0) acc.refusals.push(refusal);
      continue;
    }

    if (type === "function_call") {
      const name = toString(partObj.name);
      const args = toString(partObj.arguments);
      const callId = toString(partObj.call_id) || toString(partObj.id);
      if (name.length > 0) {
        acc.functionCalls.push({ name, arguments: args, call_id: callId });
      }
      continue;
    }
  }
};

export const parseResponsesOutput = (raw: unknown): ParsedResponsesOutput => {
  const res = (raw ?? {}) as Record<string, unknown>;
  const output = Array.isArray(res.output) ? res.output : [];

  const acc = {
    textChunks: [] as string[],
    refusals: [] as string[],
    functionCalls: [] as ParsedResponseFunctionCall[]
  };

  for (const item of output) {
    const itemObj = item as Record<string, unknown>;
    const itemType = toString(itemObj.type);

    if (itemType === "function_call") {
      const name = toString(itemObj.name);
      if (name.length > 0) {
        acc.functionCalls.push({
          name,
          arguments: toString(itemObj.arguments),
          call_id: toString(itemObj.call_id) || toString(itemObj.id)
        });
      }
      continue;
    }

    if (itemType === "refusal") {
      const refusal = toString(itemObj.refusal) || toString(itemObj.text);
      if (refusal.length > 0) acc.refusals.push(refusal);
      continue;
    }

    parseMessageContent(itemObj.content, acc);
  }

  return {
    text: acc.textChunks.join("").trim(),
    refusals: acc.refusals,
    functionCalls: acc.functionCalls,
    output
  };
};
