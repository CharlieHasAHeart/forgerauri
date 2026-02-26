import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { loadEnvFile } from "../src/config/loadEnv.js";
import { acceptabilityCatalog, behavioralCatalog } from "./probe/catalog.js";
import {
  classifyAcceptability,
  detectError,
  extractUsage,
  parseOutput,
  postResponsesWithRetry,
  redact,
  sleep,
  type ParsedOutput,
  type ProbeStatus
} from "./probe/helpers.js";

type Evidence = {
  httpStatus?: number;
  errorSnippet?: string;
  responseId?: string;
  notes?: string;
  sampleText?: string;
  outputItemTypes?: string[];
  contentTypes?: string[];
  usage?: unknown;
  rawSnippet?: string;
  runs?: Array<{ status: number; note?: string }>;
};

type FieldResult = {
  name: string;
  category: string;
  kind: "acceptability" | "behavioral";
  status: ProbeStatus;
  evidence: Evidence;
};

type ModelResult = {
  fields: FieldResult[];
  observedOutputItemTypes: string[];
  observedContentTypes: string[];
  documentedCoverage: Array<{ parameter: string; status: ProbeStatus; source: string }>;
};

type CallOutcome = {
  status: number;
  json?: unknown;
  text: string;
  error?: string;
  parsed: ParsedOutput;
  responseId?: string;
  usage?: unknown;
  errorSnippet?: string;
};

const MAX_TEXT = 500;

const truncate = (value: string, max = MAX_TEXT): string => (value.length > max ? `${value.slice(0, max)}...<truncated>` : value);

const now = (): string => new Date().toISOString();

const DOC_PATH = "docs/openai_responses_create_api.md";

const parseModels = (): string[] => {
  const fromList = process.env.PROBE_MODELS?.split(",").map((v) => v.trim()).filter(Boolean) ?? [];
  if (fromList.length > 0) return fromList;
  const single = process.env.DASHSCOPE_MODEL || "qwen3-max-2026-01-23";
  return [single];
};

const extractResponseId = (json: unknown): string | undefined => {
  const root = (json ?? {}) as Record<string, unknown>;
  return typeof root.id === "string" ? root.id : undefined;
};

const extractDocumentedParams = async (): Promise<string[]> => {
  try {
    const doc = await readFile(DOC_PATH, "utf8");
    const matches = [...doc.matchAll(/^- `([a-zA-Z0-9_]+):/gm)];
    return Array.from(new Set(matches.map((m) => m[1]))).sort();
  } catch {
    return [];
  }
};

const makeCaller = (baseUrl: string, apiKey: string, timeoutMs: number) => {
  return async (body: Record<string, unknown>): Promise<CallOutcome> => {
    const result = await postResponsesWithRetry({ baseUrl, apiKey, body, timeoutMs }, 1);
    const parsed = parseOutput(result.json);
    return {
      ...result,
      parsed,
      responseId: extractResponseId(result.json),
      usage: extractUsage(result.json),
      errorSnippet: detectError(result)
    };
  };
};

const mergeStatus = (statuses: ProbeStatus[]): ProbeStatus => {
  const set = new Set(statuses);
  if (set.size > 1) return "flaky";
  return statuses[0] ?? "unknown";
};

const deriveDocCoverage = (
  documentedParams: string[],
  fields: FieldResult[]
): Array<{ parameter: string; status: ProbeStatus; source: string }> => {
  const statusByProbe = new Map<string, ProbeStatus>();
  for (const field of fields) {
    statusByProbe.set(field.name, field.status);
  }

  const probePriority: Record<string, string[]> = {
    background: ["background"],
    context_management: ["context_management_compaction", "context_management_behavior"],
    conversation: ["conversation", "previous_response_id_behavior"],
    include: [
      "include_logprobs",
      "include_reasoning_encrypted_content",
      "include_web_search_sources",
      "include_file_search_results"
    ],
    input: ["input_string", "input_message_array_easy", "input_message_array_content_list"],
    instructions: ["instructions_behavior", "instructions_acceptability"],
    max_output_tokens: ["max_output_tokens"],
    max_tool_calls: ["max_tool_calls"],
    metadata: ["metadata"],
    model: ["model"],
    parallel_tool_calls: ["parallel_tool_calls"],
    previous_response_id: ["previous_response_id_behavior", "previous_response_id_acceptability"],
    prompt: ["prompt"],
    prompt_cache_key: ["prompt_cache_key"],
    prompt_cache_retention: ["prompt_cache_retention"],
    reasoning: ["reasoning"],
    safety_identifier: ["safety_identifier"],
    service_tier: ["service_tier"],
    store: ["store"],
    stream: ["stream_behavior", "stream_true", "stream_false"],
    stream_options: ["stream_options", "stream_behavior"],
    temperature: ["temperature"],
    text: ["text_format_text", "text_format_json_object_behavior", "text_format_json_schema_behavior"],
    tool_choice: ["tool_choice_auto", "tool_choice_none", "tool_choice_required"],
    tools: [
      "tools_function_call_behavior",
      "tools_builtin_behavior",
      "tools_builtin_web_search",
      "tools_builtin_web_extractor",
      "tools_builtin_code_interpreter"
    ],
    top_logprobs: ["top_logprobs"],
    top_p: ["top_p"],
    truncation: ["truncation_behavior", "truncation_auto", "truncation_disabled"],
    user: ["user"]
  };

  const rank: Record<ProbeStatus, number> = {
    supported: 5,
    flaky: 4,
    ignored: 3,
    unknown: 2,
    rejected: 1
  };

  return documentedParams.map((parameter) => {
    const probeNames = probePriority[parameter] ?? [];
    let best: { status: ProbeStatus; source: string } = { status: "unknown", source: "not_tested" };
    for (const probeName of probeNames) {
      const status = statusByProbe.get(probeName);
      if (!status) continue;
      if (rank[status] > rank[best.status]) {
        best = { status, source: probeName };
      }
    }
    return { parameter, status: best.status, source: best.source };
  });
};

const runAcceptability = async (
  model: string,
  repeat: number,
  call: (body: Record<string, unknown>) => Promise<CallOutcome>
): Promise<FieldResult[]> => {
  const results: FieldResult[] = [];

  for (const entry of acceptabilityCatalog) {
    if (!entry.makeBody) continue;
    const runs: CallOutcome[] = [];

    for (let i = 0; i < repeat; i += 1) {
      runs.push(await call(entry.makeBody({ model, baseBody: { model, input: "ping" } })));
      await sleep(120);
    }

    const statuses = runs.map((run) => classifyAcceptability(run));
    const status = mergeStatus(statuses);
    const first = runs[0]!;

    results.push({
      name: entry.name,
      category: entry.category,
      kind: "acceptability",
      status,
      evidence: {
        httpStatus: first.status,
        responseId: first.responseId,
        errorSnippet: first.errorSnippet,
        sampleText: first.parsed.text,
        outputItemTypes: first.parsed.itemTypes,
        contentTypes: first.parsed.contentTypes,
        usage: first.usage,
        notes: entry.description,
        runs: runs.map((r) => ({ status: r.status, note: r.errorSnippet }))
      }
    });
  }

  return results;
};

const behavioralInstructions = async (model: string, call: (body: Record<string, unknown>) => Promise<CallOutcome>): Promise<FieldResult> => {
  const base = await call({ model, input: "请输出 EXACTLY: OK_BASE" });
  const test = await call({
    model,
    instructions: "你必须只输出 OK_INSTR",
    input: "请输出一段随机中文"
  });

  if (test.status >= 400) {
    return {
      name: "instructions_behavior",
      category: "instructions",
      kind: "behavioral",
      status: "rejected",
      evidence: {
        httpStatus: test.status,
        errorSnippet: test.errorSnippet,
        notes: "instructions request rejected"
      }
    };
  }

  const supported = /OK_INSTR/.test(test.parsed.text);
  return {
    name: "instructions_behavior",
    category: "instructions",
    kind: "behavioral",
    status: supported ? "supported" : "ignored",
    evidence: {
      httpStatus: test.status,
      responseId: test.responseId,
      sampleText: test.parsed.text,
      outputItemTypes: test.parsed.itemTypes,
      contentTypes: test.parsed.contentTypes,
      notes: supported ? "instructions overrode prompt" : `control=${base.parsed.text}`
    }
  };
};

const behavioralPreviousResponse = async (
  model: string,
  call: (body: Record<string, unknown>) => Promise<CallOutcome>
): Promise<FieldResult> => {
  const first = await call({ model, input: "记住数字 7，只回答 OK_REMEMBER" });
  const prev = first.responseId;
  if (!prev) {
    return {
      name: "previous_response_id_behavior",
      category: "conversation",
      kind: "behavioral",
      status: "unknown",
      evidence: { httpStatus: first.status, notes: "response.id missing" }
    };
  }

  const second = await call({
    model,
    previous_response_id: prev,
    input: "刚才记住的数字是什么？只输出数字"
  });

  if (second.status >= 400) {
    return {
      name: "previous_response_id_behavior",
      category: "conversation",
      kind: "behavioral",
      status: "rejected",
      evidence: { httpStatus: second.status, errorSnippet: second.errorSnippet }
    };
  }

  return {
    name: "previous_response_id_behavior",
    category: "conversation",
    kind: "behavioral",
    status: /\b7\b/.test(second.parsed.text) ? "supported" : "ignored",
    evidence: {
      httpStatus: second.status,
      responseId: second.responseId,
      sampleText: second.parsed.text,
      outputItemTypes: second.parsed.itemTypes,
      contentTypes: second.parsed.contentTypes,
      notes: "checked recall via previous_response_id"
    }
  };
};

const behavioralJsonSchema = async (model: string, call: (body: Record<string, unknown>) => Promise<CallOutcome>): Promise<FieldResult> => {
  const run = await call({
    model,
    input: "输出符合 schema 的 JSON，a=1",
    text: {
      format: {
        type: "json_schema",
        name: "probe_schema",
        strict: true,
        schema: {
          type: "object",
          properties: { a: { type: "number" } },
          required: ["a"],
          additionalProperties: false
        }
      }
    }
  });

  if (run.status >= 400) {
    return {
      name: "text_format_json_schema_behavior",
      category: "text_format",
      kind: "behavioral",
      status: "rejected",
      evidence: { httpStatus: run.status, errorSnippet: run.errorSnippet }
    };
  }

  let status: ProbeStatus = "ignored";
  let notes = "response not strict json schema";
  try {
    const parsed = JSON.parse(run.parsed.text) as { a?: unknown };
    if (typeof parsed === "object" && parsed !== null && parsed.a === 1) {
      status = "supported";
      notes = "json_schema output validated";
    }
  } catch {
    notes = "text not parseable as JSON";
  }

  return {
    name: "text_format_json_schema_behavior",
    category: "text_format",
    kind: "behavioral",
    status,
    evidence: {
      httpStatus: run.status,
      responseId: run.responseId,
      sampleText: run.parsed.text,
      outputItemTypes: run.parsed.itemTypes,
      contentTypes: run.parsed.contentTypes,
      notes
    }
  };
};

const behavioralJsonObject = async (model: string, call: (body: Record<string, unknown>) => Promise<CallOutcome>): Promise<FieldResult> => {
  const run = await call({
    model,
    input: "输出合法 JSON 对象：{\"a\":1}",
    text: { format: { type: "json_object" } }
  });

  if (run.status >= 400) {
    return {
      name: "text_format_json_object_behavior",
      category: "text_format",
      kind: "behavioral",
      status: "rejected",
      evidence: { httpStatus: run.status, errorSnippet: run.errorSnippet }
    };
  }

  let status: ProbeStatus = "ignored";
  let notes = "json_object accepted but output not valid JSON object";
  try {
    const parsed = JSON.parse(run.parsed.text) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      status = "supported";
      notes = "json_object output parsed as object";
    }
  } catch {
    notes = "output not parseable JSON";
  }

  return {
    name: "text_format_json_object_behavior",
    category: "text_format",
    kind: "behavioral",
    status,
    evidence: {
      httpStatus: run.status,
      responseId: run.responseId,
      sampleText: run.parsed.text,
      outputItemTypes: run.parsed.itemTypes,
      contentTypes: run.parsed.contentTypes,
      notes
    }
  };
};

const behavioralTruncation = async (model: string, call: (body: Record<string, unknown>) => Promise<CallOutcome>): Promise<FieldResult> => {
  const sizes = [4000, 8000, 16000, 32000];

  for (const size of sizes) {
    const content = "x".repeat(size);
    const plain = await call({ model, input: content });
    const auto = await call({ model, input: content, truncation: "auto" });

    if (auto.status >= 400 && /unknown|invalid|unsupported/i.test(auto.errorSnippet ?? "")) {
      return {
        name: "truncation_behavior",
        category: "context",
        kind: "behavioral",
        status: "rejected",
        evidence: { httpStatus: auto.status, errorSnippet: auto.errorSnippet }
      };
    }

    if (plain.status >= 400 && auto.status === 200) {
      return {
        name: "truncation_behavior",
        category: "context",
        kind: "behavioral",
        status: "supported",
        evidence: {
          httpStatus: auto.status,
          responseId: auto.responseId,
          sampleText: auto.parsed.text,
          outputItemTypes: auto.parsed.itemTypes,
          contentTypes: auto.parsed.contentTypes,
          notes: `plain failed at size=${size}, truncation auto succeeded`
        }
      };
    }

    if (plain.status >= 400 && auto.status >= 400) {
      return {
        name: "truncation_behavior",
        category: "context",
        kind: "behavioral",
        status: "ignored",
        evidence: {
          httpStatus: auto.status,
          errorSnippet: auto.errorSnippet,
          notes: `both plain and truncation failed at size=${size}`
        }
      };
    }
  }

  return {
    name: "truncation_behavior",
    category: "context",
    kind: "behavioral",
    status: "unknown",
    evidence: {
      notes: "did not observe plain failure threshold within tested sizes"
    }
  };
};

const behavioralFunctionTool = async (model: string, call: (body: Record<string, unknown>) => Promise<CallOutcome>): Promise<FieldResult> => {
  const run = await call({
    model,
    input: "必须调用 get_weather，city=Beijing",
    tools: [
      {
        type: "function",
        name: "get_weather",
        description: "Get weather by city",
        parameters: {
          type: "object",
          properties: { city: { type: "string" } },
          required: ["city"],
          additionalProperties: false
        },
        strict: true
      }
    ],
    tool_choice: "required"
  });

  if (run.status >= 400) {
    return {
      name: "tools_function_call_behavior",
      category: "tools",
      kind: "behavioral",
      status: "rejected",
      evidence: { httpStatus: run.status, errorSnippet: run.errorSnippet }
    };
  }

  const matched = run.parsed.functionCalls.some((fc) => fc.name === "get_weather") || run.parsed.itemTypes.includes("function_call");

  return {
    name: "tools_function_call_behavior",
    category: "tools",
    kind: "behavioral",
    status: matched ? "supported" : "ignored",
    evidence: {
      httpStatus: run.status,
      responseId: run.responseId,
      sampleText: run.parsed.text,
      outputItemTypes: run.parsed.itemTypes,
      contentTypes: run.parsed.contentTypes,
      notes: matched ? "function_call observed" : "required tool accepted but no function_call observed"
    }
  };
};

const behavioralEnableThinking = async (model: string, call: (body: Record<string, unknown>) => Promise<CallOutcome>): Promise<FieldResult> => {
  const off = await call({ model, input: "用一句话解释二分查找", enable_thinking: false });
  const on = await call({ model, input: "用一句话解释二分查找", enable_thinking: true });

  if (on.status >= 400) {
    return {
      name: "enable_thinking_behavior",
      category: "thinking",
      kind: "behavioral",
      status: "rejected",
      evidence: { httpStatus: on.status, errorSnippet: on.errorSnippet }
    };
  }

  const onUsageString = JSON.stringify(on.usage ?? {});
  const offUsageString = JSON.stringify(off.usage ?? {});
  const hasReasoning = /reason/i.test(onUsageString) || on.parsed.itemTypes.some((t) => /reason/i.test(t));
  const changed = on.parsed.text !== off.parsed.text || onUsageString !== offUsageString;

  return {
    name: "enable_thinking_behavior",
    category: "thinking",
    kind: "behavioral",
    status: hasReasoning || changed ? "supported" : "unknown",
    evidence: {
      httpStatus: on.status,
      responseId: on.responseId,
      sampleText: on.parsed.text,
      outputItemTypes: on.parsed.itemTypes,
      contentTypes: on.parsed.contentTypes,
      usage: on.usage,
      notes: hasReasoning || changed ? "accepted with observable difference" : "accepted but no stable observable signal"
    }
  };
};

const behavioralStream = async (model: string, call: (body: Record<string, unknown>) => Promise<CallOutcome>): Promise<FieldResult> => {
  const run = await call({
    model,
    input: "ping",
    stream: true,
    stream_options: { include_obfuscation: false }
  });

  if (run.status >= 400) {
    return {
      name: "stream_behavior",
      category: "streaming",
      kind: "behavioral",
      status: "rejected",
      evidence: { httpStatus: run.status, errorSnippet: run.errorSnippet }
    };
  }

  const looksLikeSse = run.text.includes("data:") || run.text.includes("event:");
  const notes = looksLikeSse
    ? "SSE markers observed"
    : "request accepted but full SSE parsing not implemented; treat as accepted_but_unverified";

  return {
    name: "stream_behavior",
    category: "streaming",
    kind: "behavioral",
    status: looksLikeSse ? "supported" : "unknown",
    evidence: {
      httpStatus: run.status,
      responseId: run.responseId,
      sampleText: run.parsed.text,
      outputItemTypes: run.parsed.itemTypes,
      contentTypes: run.parsed.contentTypes,
      rawSnippet: truncate(run.text, 300),
      notes
    }
  };
};

const behavioralToolsBuiltin = async (model: string, call: (body: Record<string, unknown>) => Promise<CallOutcome>): Promise<FieldResult> => {
  const types = ["web_search", "web_extractor", "code_interpreter"] as const;
  const notes: string[] = [];

  let anyRejected = false;
  let anyObserved = false;

  for (const type of types) {
    const run = await call({
      model,
      input: "使用工具完成任务",
      tools: [{ type }],
      tool_choice: "required"
    });

    if (run.status >= 400) {
      anyRejected = true;
      notes.push(`${type}: ${run.status} ${run.errorSnippet ?? ""}`.trim());
      continue;
    }

    const observed = run.parsed.itemTypes.some((item) => item.includes(type) || item.includes("tool") || item.includes("call"));
    anyObserved = anyObserved || observed;
    notes.push(`${type}: status=${run.status}, observed=${observed}`);
  }

  return {
    name: "tools_builtin_behavior",
    category: "tools",
    kind: "behavioral",
    status: anyRejected ? "rejected" : anyObserved ? "supported" : "unknown",
    evidence: {
      notes: notes.join("; ")
    }
  };
};

const behavioralContextManagement = async (
  model: string,
  call: (body: Record<string, unknown>) => Promise<CallOutcome>
): Promise<FieldResult> => {
  const run = await call({
    model,
    input: "请简要解释上下文压缩",
    context_management: [{ type: "compaction", compact_threshold: 2000 }]
  });

  if (run.status >= 400) {
    return {
      name: "context_management_behavior",
      category: "context",
      kind: "behavioral",
      status: "rejected",
      evidence: { httpStatus: run.status, errorSnippet: run.errorSnippet }
    };
  }

  const marker = run.parsed.itemTypes.some((t) => /compaction/i.test(t));

  return {
    name: "context_management_behavior",
    category: "context",
    kind: "behavioral",
    status: marker ? "supported" : "unknown",
    evidence: {
      httpStatus: run.status,
      responseId: run.responseId,
      sampleText: run.parsed.text,
      outputItemTypes: run.parsed.itemTypes,
      contentTypes: run.parsed.contentTypes,
      notes: marker ? "compaction marker observed" : "accepted but no explicit compaction signal"
    }
  };
};

const behavioralHandlers: Record<string, (model: string, call: (body: Record<string, unknown>) => Promise<CallOutcome>) => Promise<FieldResult>> = {
  instructions_behavior: behavioralInstructions,
  previous_response_id_behavior: behavioralPreviousResponse,
  text_format_json_schema_behavior: behavioralJsonSchema,
  text_format_json_object_behavior: behavioralJsonObject,
  truncation_behavior: behavioralTruncation,
  tools_function_call_behavior: behavioralFunctionTool,
  enable_thinking_behavior: behavioralEnableThinking,
  stream_behavior: behavioralStream,
  tools_builtin_behavior: behavioralToolsBuiltin,
  context_management_behavior: behavioralContextManagement
};

const runBehavioral = async (
  model: string,
  repeat: number,
  call: (body: Record<string, unknown>) => Promise<CallOutcome>
): Promise<FieldResult[]> => {
  const fields: FieldResult[] = [];

  for (const probe of behavioralCatalog) {
    const handler = behavioralHandlers[probe.name];
    if (!handler) continue;

    const runs: FieldResult[] = [];
    for (let i = 0; i < repeat; i += 1) {
      runs.push(await handler(model, call));
      await sleep(120);
    }

    const statuses = runs.map((run) => run.status);
    const mergedStatus = mergeStatus(statuses);
    const first = runs[0]!;

    fields.push({
      ...first,
      status: mergedStatus,
      evidence: {
        ...first.evidence,
        runs: runs.map((r) => ({ status: r.evidence.httpStatus ?? 0, note: r.evidence.notes }))
      }
    });
  }

  return fields;
};

const buildMarkdown = (
  meta: { baseUrl: string; models: string[]; timestamp: string; timeoutMs: number; repeat: number; documentedParams: string[] },
  resultsByModel: Record<string, ModelResult>
): string => {
  const lines: string[] = [];
  lines.push("# Bailian Responses API Compatibility Guide");
  lines.push("");
  lines.push(`- Endpoint: \`${meta.baseUrl}/responses\``);
  lines.push("- Auth: `Authorization: Bearer <DASHSCOPE_API_KEY>`");
  lines.push(`- Generated at: ${meta.timestamp}`);
  lines.push(`- Timeout(ms): ${meta.timeoutMs}`);
  lines.push(`- Repeat: ${meta.repeat}`);
  lines.push(`- OpenAI reference source: \`${DOC_PATH}\``);
  lines.push("");
  lines.push("## Status Criteria");
  lines.push("");
  lines.push("- `supported`: accepted (HTTP 200) and behavior signal verified.");
  lines.push("- `ignored`: accepted (HTTP 200) but behavior signal not observed.");
  lines.push("- `rejected`: invalid/unknown parameter or explicit rejection (typically 4xx).");
  lines.push("- `flaky`: repeated runs gave inconsistent status / transient failures.");
  lines.push("- `unknown`: accepted but no reliable observable signal.");
  lines.push("");

  for (const model of meta.models) {
    const modelResult = resultsByModel[model];
    lines.push(`## Model: \`${model}\``);
    lines.push("");
    lines.push("| Field | Category | Kind | Status | Notes |");
    lines.push("|---|---|---|---|---|");

    const sorted = [...modelResult.fields].sort((a, b) => a.name.localeCompare(b.name));
    for (const field of sorted) {
      const note = (field.evidence.notes ?? "").replace(/\|/g, "\\|");
      lines.push(`| ${field.name} | ${field.category} | ${field.kind} | ${field.status} | ${note} |`);
    }

    lines.push("");
    lines.push("### OpenAI Body Parameter Coverage");
    lines.push("");
    lines.push("| Parameter (OpenAI docs) | Derived Status | Probe Source |");
    lines.push("|---|---|---|");
    for (const item of modelResult.documentedCoverage) {
      lines.push(`| ${item.parameter} | ${item.status} | ${item.source} |`);
    }
    lines.push("");
    lines.push("### Key Findings");
    lines.push("");

    const pick = (name: string): FieldResult | undefined => sorted.find((f) => f.name === name);
    const keyItems = [
      ["instructions", pick("instructions_behavior")],
      ["previous_response_id", pick("previous_response_id_behavior")],
      ["text.format.json_schema", pick("text_format_json_schema_behavior")],
      ["tools/function", pick("tools_function_call_behavior")],
      ["stream", pick("stream_behavior")],
      ["enable_thinking", pick("enable_thinking_behavior")]
    ] as const;

    for (const [label, item] of keyItems) {
      if (!item) continue;
      lines.push(`- ${label}: **${item.status}** — ${item.evidence.notes ?? ""}`);
    }

    lines.push("");
    lines.push("### Output Structure Observed");
    lines.push("");
    lines.push(`- output item types: ${modelResult.observedOutputItemTypes.length > 0 ? modelResult.observedOutputItemTypes.join(", ") : "(none)"}`);
    lines.push(`- message content types: ${modelResult.observedContentTypes.length > 0 ? modelResult.observedContentTypes.join(", ") : "(none)"}`);

    const functionSample = sorted.find((f) => (f.evidence.outputItemTypes ?? []).includes("function_call") || (f.evidence.notes ?? "").includes("function_call"));
    if (functionSample) {
      lines.push(`- function_call sample note: ${truncate(functionSample.evidence.notes ?? "", 300)}`);
    }

    lines.push("");
    lines.push("### Recommended Adapter Strategy");
    lines.push("");
    lines.push("- If `instructions` is not supported, convert instructions into a leading `developer/system` input message.");
    lines.push("- If `json_schema` is ignored/rejected, fallback to plain text + JSON extraction + local schema validation retry.");
    lines.push("- Keep provider-specific tool type mapping (function vs built-in tools) in adapter layer.");
    lines.push("");
  }

  return `${lines.join("\n")}\n`;
};

const run = async (): Promise<void> => {
  loadEnvFile();

  const apiKey = process.env.DASHSCOPE_API_KEY;
  if (!apiKey) throw new Error("DASHSCOPE_API_KEY is required");

  const baseUrl = process.env.DASHSCOPE_BASE_URL || "https://dashscope.aliyuncs.com/api/v2/apps/protocols/compatible-mode/v1";
  const models = parseModels();
  const timeoutMs = Number(process.env.PROBE_TIMEOUT_MS || "30000");
  const repeat = Math.max(1, Number(process.env.PROBE_REPEAT || "2"));
  const outDir = process.env.PROBE_OUTDIR || "generated";
  const documentedParams = await extractDocumentedParams();

  const resultsByModel: Record<string, ModelResult> = {};

  for (const model of models) {
    const call = makeCaller(baseUrl, apiKey, timeoutMs);
    const fields: FieldResult[] = [];

    const acceptability = await runAcceptability(model, repeat, call);
    fields.push(...acceptability);

    const behavioral = await runBehavioral(model, repeat, call);
    fields.push(...behavioral);

    const observedOutputItemTypes = Array.from(new Set(fields.flatMap((f) => f.evidence.outputItemTypes ?? []))).sort();
    const observedContentTypes = Array.from(new Set(fields.flatMap((f) => f.evidence.contentTypes ?? []))).sort();
    const documentedCoverage = deriveDocCoverage(documentedParams, fields);

    resultsByModel[model] = {
      fields,
      observedOutputItemTypes,
      observedContentTypes,
      documentedCoverage
    };
  }

  const report = {
    meta: {
      baseUrl,
      models,
      timestamp: now(),
      timeoutMs,
      repeat,
      documentedParams,
      auth: "Bearer",
      notes: "DASHSCOPE_MODEL should be set to a model your account can access"
    },
    resultsByModel
  };

  const jsonPath = resolve(outDir, "bailian_responses_compatibility.json");
  const mdPath = resolve(outDir, "bailian_responses_compatibility.md");
  const docsMdPath = resolve("docs", "bailian_responses_compatibility.md");

  await mkdir(dirname(jsonPath), { recursive: true });
  await mkdir(dirname(docsMdPath), { recursive: true });

  const markdown = buildMarkdown(report.meta, resultsByModel);

  await writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await writeFile(mdPath, markdown, "utf8");
  await writeFile(docsMdPath, markdown, "utf8");

  console.log(`Compatibility JSON: ${jsonPath}`);
  console.log(`Compatibility MD: ${mdPath}`);
  console.log(`Docs MD: ${docsMdPath}`);

  for (const model of models) {
    console.log(`--- ${model} ---`);
    for (const field of resultsByModel[model]!.fields) {
      console.log(`${field.name}: ${field.status}`);
    }
  }
};

run().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Probe failed: ${redact(message)}`);
  process.exitCode = 1;
});
