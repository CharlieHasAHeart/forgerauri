import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { loadEnvFile } from "../src/config/loadEnv.js";
import { parseOutput, postResponses, redact } from "./probe/helpers.js";

type ProbeStatus = "supported" | "ignored" | "rejected" | "flaky" | "unknown";

type ProbeEvidence = {
  httpStatus?: number;
  errorSnippet?: string;
  responseId?: string;
  notes?: string;
  sampleOutputText?: string;
  outputItemTypes?: string[];
  runs?: Array<{ status: number; responseId?: string; outputItemTypes: string[]; note?: string }>;
};

type ProbeResult = {
  name: string;
  status: ProbeStatus;
  evidence: ProbeEvidence;
};

type CallOutcome = {
  status: number;
  json?: unknown;
  text: string;
  error?: string;
  parsed: ReturnType<typeof parseOutput>;
  responseId?: string;
};

const now = (): string => new Date().toISOString();

const truncate = (value: string, max = 500): string => (value.length > max ? `${value.slice(0, max)}...<truncated>` : value);

const getErrorSnippet = (outcome: CallOutcome): string | undefined => {
  if (outcome.error) return truncate(outcome.error, 300);
  if (outcome.status >= 400) return truncate(outcome.text, 300);
  return undefined;
};

const isUnknownFieldError = (snippet?: string): boolean =>
  !!snippet && /unknown|unsupported|invalid\s*(field|param|parameter)|unexpected/i.test(snippet);

const runProbe = async (): Promise<void> => {
  loadEnvFile();

  const apiKey = process.env.DASHSCOPE_API_KEY;
  if (!apiKey) {
    throw new Error("DASHSCOPE_API_KEY is required");
  }

  const baseUrl = process.env.DASHSCOPE_BASE_URL || "https://dashscope.aliyuncs.com/api/v2/apps/protocols/compatible-mode/v1";
  const model = process.env.DASHSCOPE_MODEL || "qwen3-max-2026-01-23";
  const timeoutMs = Number(process.env.PROBE_TIMEOUT_MS || "30000");
  const outFile = process.env.PROBE_OUTFILE || "generated/dashscope_capabilities.json";

  const call = async (body: Record<string, unknown>): Promise<CallOutcome> => {
    const result = await postResponses({ baseUrl, apiKey, body, timeoutMs });
    const parsed = parseOutput(result.json);
    const responseId = result.json && typeof (result.json as Record<string, unknown>).id === "string"
      ? ((result.json as Record<string, unknown>).id as string)
      : undefined;

    return {
      ...result,
      parsed,
      responseId
    };
  };

  const withFlaky = async (runner: () => Promise<ProbeResult>, repeats = 3): Promise<ProbeResult> => {
    const runs: ProbeResult[] = [];
    for (let i = 0; i < repeats; i += 1) {
      runs.push(await runner());
    }

    const first = runs[0]!;
    const uniqueStatuses = new Set(runs.map((r) => r.status));
    const hasFailure = runs.some((r) => r.evidence.httpStatus === 0 || (r.evidence.httpStatus ?? 200) >= 500);

    if (uniqueStatuses.size > 1 || hasFailure) {
      return {
        ...first,
        status: "flaky",
        evidence: {
          ...first.evidence,
          notes: `${first.evidence.notes ? `${first.evidence.notes}; ` : ""}inconsistent results across retries`,
          runs: runs.map((r) => ({
            status: r.evidence.httpStatus ?? 0,
            responseId: r.evidence.responseId,
            outputItemTypes: r.evidence.outputItemTypes ?? [],
            note: r.evidence.notes
          }))
        }
      };
    }

    return first;
  };

  const results: ProbeResult[] = [];

  results.push(
    await withFlaky(async () => {
      const outcome = await call({ model, input: "ping" });
      if (outcome.status === 200) {
        return {
          name: "smoke_minimal",
          status: "supported",
          evidence: {
            httpStatus: outcome.status,
            responseId: outcome.responseId,
            sampleOutputText: outcome.parsed.text,
            outputItemTypes: outcome.parsed.itemTypes
          }
        };
      }
      return {
        name: "smoke_minimal",
        status: "rejected",
        evidence: {
          httpStatus: outcome.status,
          errorSnippet: getErrorSnippet(outcome)
        }
      };
    }, 1)
  );

  results.push(
    await withFlaky(async () => {
      const outcome = await call({
        model,
        input: [{ type: "message", role: "user", content: [{ type: "input_text", text: "ping" }] }]
      });

      return {
        name: "input_message_array_supported",
        status: outcome.status === 200 ? "supported" : "rejected",
        evidence: {
          httpStatus: outcome.status,
          errorSnippet: getErrorSnippet(outcome),
          responseId: outcome.responseId,
          sampleOutputText: outcome.parsed.text,
          outputItemTypes: outcome.parsed.itemTypes
        }
      };
    })
  );

  results.push(
    await withFlaky(async () => {
      const control = await call({ model, input: "请输出 EXACTLY: OK_INSTR_A" });
      const test = await call({
        model,
        instructions: "你必须只输出 OK_INSTR_B",
        input: "请输出一个随机句子"
      });

      const snippet = getErrorSnippet(test);
      if (test.status >= 400 && isUnknownFieldError(snippet)) {
        return {
          name: "instructions_supported",
          status: "rejected",
          evidence: { httpStatus: test.status, errorSnippet: snippet, notes: "instructions appears unsupported" }
        };
      }

      if (test.status === 200) {
        const supported = /OK_INSTR_B/.test(test.parsed.text);
        return {
          name: "instructions_supported",
          status: supported ? "supported" : "ignored",
          evidence: {
            httpStatus: test.status,
            responseId: test.responseId,
            notes: supported ? "instructions influenced output" : "no clear instructions effect",
            sampleOutputText: test.parsed.text,
            outputItemTypes: test.parsed.itemTypes,
            runs: [
              {
                status: control.status,
                responseId: control.responseId,
                outputItemTypes: control.parsed.itemTypes,
                note: `control:${control.parsed.text}`
              }
            ]
          }
        };
      }

      return {
        name: "instructions_supported",
        status: "unknown",
        evidence: { httpStatus: test.status, errorSnippet: snippet }
      };
    })
  );

  results.push(
    await withFlaky(async () => {
      const first = await call({ model, input: "记住数字 7，只回答 OK_REMEMBER" });
      const prev = first.responseId;
      if (!prev) {
        return {
          name: "previous_response_id_supported",
          status: "unknown",
          evidence: { httpStatus: first.status, notes: "response.id missing in first call" }
        };
      }

      const second = await call({
        model,
        previous_response_id: prev,
        input: "刚才记住的数字是什么？只输出那个数字"
      });

      const snippet = getErrorSnippet(second);
      if (second.status >= 400 && isUnknownFieldError(snippet)) {
        return {
          name: "previous_response_id_supported",
          status: "rejected",
          evidence: { httpStatus: second.status, errorSnippet: snippet }
        };
      }

      if (second.status === 200) {
        return {
          name: "previous_response_id_supported",
          status: /\b7\b/.test(second.parsed.text) ? "supported" : "ignored",
          evidence: {
            httpStatus: second.status,
            responseId: second.responseId,
            notes: `second output: ${second.parsed.text}`,
            sampleOutputText: second.parsed.text,
            outputItemTypes: second.parsed.itemTypes
          }
        };
      }

      return {
        name: "previous_response_id_supported",
        status: "unknown",
        evidence: { httpStatus: second.status, errorSnippet: snippet }
      };
    })
  );

  results.push(
    await withFlaky(async () => {
      const outcome = await call({
        model,
        input: "输出符合 schema 的 JSON，a=1",
        text: {
          format: {
            type: "json_schema",
            name: "probe",
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

      const snippet = getErrorSnippet(outcome);
      if (outcome.status >= 400 && isUnknownFieldError(snippet)) {
        return {
          name: "structured_outputs_json_schema_supported",
          status: "rejected",
          evidence: { httpStatus: outcome.status, errorSnippet: snippet }
        };
      }

      if (outcome.status === 200) {
        try {
          const parsed = JSON.parse(outcome.parsed.text) as { a?: number };
          return {
            name: "structured_outputs_json_schema_supported",
            status: parsed.a === 1 ? "supported" : "ignored",
            evidence: {
              httpStatus: outcome.status,
              responseId: outcome.responseId,
              sampleOutputText: outcome.parsed.text,
              outputItemTypes: outcome.parsed.itemTypes,
              notes: parsed.a === 1 ? "strict json schema appears effective" : "returned text not matching schema"
            }
          };
        } catch {
          return {
            name: "structured_outputs_json_schema_supported",
            status: "ignored",
            evidence: {
              httpStatus: outcome.status,
              responseId: outcome.responseId,
              sampleOutputText: outcome.parsed.text,
              outputItemTypes: outcome.parsed.itemTypes,
              notes: "200 response but output not parseable JSON"
            }
          };
        }
      }

      return {
        name: "structured_outputs_json_schema_supported",
        status: "unknown",
        evidence: { httpStatus: outcome.status, errorSnippet: snippet }
      };
    })
  );

  results.push(
    await withFlaky(async () => {
      const longInput = "x".repeat(8000);
      const plain = await call({ model, input: longInput });
      const trunc = await call({ model, input: longInput, truncation: "auto" });

      const truncSnippet = getErrorSnippet(trunc);
      if (trunc.status >= 400 && isUnknownFieldError(truncSnippet)) {
        return {
          name: "truncation_supported",
          status: "rejected",
          evidence: { httpStatus: trunc.status, errorSnippet: truncSnippet }
        };
      }

      if (plain.status >= 400 && trunc.status === 200) {
        return {
          name: "truncation_supported",
          status: "supported",
          evidence: {
            httpStatus: trunc.status,
            responseId: trunc.responseId,
            notes: `plain=${plain.status}, truncation=200`,
            sampleOutputText: trunc.parsed.text,
            outputItemTypes: trunc.parsed.itemTypes
          }
        };
      }

      return {
        name: "truncation_supported",
        status: plain.status === trunc.status ? "ignored" : "unknown",
        evidence: {
          httpStatus: trunc.status,
          notes: `plain=${plain.status}, trunc=${trunc.status}`,
          errorSnippet: truncSnippet
        }
      };
    })
  );

  results.push(
    await withFlaky(async () => {
      const outcome = await call({
        model,
        input: "请简短回答：什么是向量数据库？",
        context_management: [{ type: "compaction", compact_threshold: 2000 }]
      });

      const snippet = getErrorSnippet(outcome);
      if (outcome.status >= 400 && isUnknownFieldError(snippet)) {
        return {
          name: "context_management_compaction_supported",
          status: "rejected",
          evidence: { httpStatus: outcome.status, errorSnippet: snippet }
        };
      }

      if (outcome.status === 200) {
        const hasCompactionMarker = outcome.parsed.itemTypes.some((t) => /compaction/i.test(t));
        return {
          name: "context_management_compaction_supported",
          status: hasCompactionMarker ? "supported" : "unknown",
          evidence: {
            httpStatus: outcome.status,
            responseId: outcome.responseId,
            sampleOutputText: outcome.parsed.text,
            outputItemTypes: outcome.parsed.itemTypes,
            notes: hasCompactionMarker ? "compaction marker observed" : "accepted but no explicit compaction marker"
          }
        };
      }

      return {
        name: "context_management_compaction_supported",
        status: "unknown",
        evidence: { httpStatus: outcome.status, errorSnippet: snippet }
      };
    })
  );

  results.push(
    await withFlaky(async () => {
      const off = await call({ model, input: "用一句话解释二分查找的核心思想", enable_thinking: false });
      const on = await call({ model, input: "用一句话解释二分查找的核心思想", enable_thinking: true });

      const snippet = getErrorSnippet(on);
      if (on.status >= 400 && isUnknownFieldError(snippet)) {
        return {
          name: "enable_thinking_supported",
          status: "rejected",
          evidence: { httpStatus: on.status, errorSnippet: snippet }
        };
      }

      const onUsage = (on.json as Record<string, unknown> | undefined)?.usage as Record<string, unknown> | undefined;
      const offUsage = (off.json as Record<string, unknown> | undefined)?.usage as Record<string, unknown> | undefined;
      const changedText = on.parsed.text !== off.parsed.text;
      const hasReasoningField = JSON.stringify(onUsage ?? {}).includes("reason");

      return {
        name: "enable_thinking_supported",
        status: on.status === 200 && off.status === 200 && (changedText || hasReasoningField) ? "supported" : "unknown",
        evidence: {
          httpStatus: on.status,
          responseId: on.responseId,
          notes:
            on.status === 200 && off.status === 200
              ? changedText || hasReasoningField
                ? "enable_thinking accepted with observable difference"
                : "enable_thinking accepted but no stable observable difference"
              : `off=${off.status}, on=${on.status}`,
          sampleOutputText: on.parsed.text,
          outputItemTypes: on.parsed.itemTypes
        }
      };
    })
  );

  results.push(
    await withFlaky(async () => {
      const outcome = await call({
        model,
        input: "调用 get_weather，city=Beijing",
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

      const snippet = getErrorSnippet(outcome);
      if (outcome.status >= 400 && isUnknownFieldError(snippet)) {
        return {
          name: "tools_function_call_supported",
          status: "rejected",
          evidence: { httpStatus: outcome.status, errorSnippet: snippet }
        };
      }

      const hasFnCall = outcome.parsed.functionCalls.some((fc) => fc.name === "get_weather") || outcome.parsed.itemTypes.includes("function_call");
      return {
        name: "tools_function_call_supported",
        status: outcome.status === 200 ? (hasFnCall ? "supported" : "ignored") : "unknown",
        evidence: {
          httpStatus: outcome.status,
          responseId: outcome.responseId,
          sampleOutputText: outcome.parsed.text,
          outputItemTypes: outcome.parsed.itemTypes,
          notes: hasFnCall ? "function_call observed" : "200 but no function_call item"
        }
      };
    })
  );

  results.push(
    await withFlaky(async () => {
      const toolTypes = ["web_search", "web_extractor", "code_interpreter"] as const;
      const perTool: Array<{ tool: string; status: number; itemTypes: string[]; error?: string }> = [];

      for (const toolType of toolTypes) {
        const outcome = await call({
          model,
          input: "使用工具完成任务",
          tools: [{ type: toolType }],
          tool_choice: "required"
        });
        perTool.push({
          tool: toolType,
          status: outcome.status,
          itemTypes: outcome.parsed.itemTypes,
          error: getErrorSnippet(outcome)
        });
      }

      const rejected = perTool.find((item) => item.status >= 400 && isUnknownFieldError(item.error));
      if (rejected) {
        return {
          name: "tools_builtin_types_acceptance",
          status: "rejected",
          evidence: {
            httpStatus: rejected.status,
            errorSnippet: rejected.error,
            notes: JSON.stringify(perTool)
          }
        };
      }

      const all200 = perTool.every((item) => item.status === 200);
      return {
        name: "tools_builtin_types_acceptance",
        status: all200 ? "supported" : "unknown",
        evidence: {
          httpStatus: all200 ? 200 : perTool[0]?.status,
          notes: JSON.stringify(perTool)
        }
      };
    })
  );

  const report = {
    meta: {
      baseUrl,
      model,
      timestamp: now()
    },
    results
  };

  const outPath = resolve(outFile);
  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  console.log(`Probe finished: ${outPath}`);
  for (const result of results) {
    console.log(`${result.name}: ${result.status}`);
  }
};

runProbe().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Probe failed: ${redact(message)}`);
  process.exitCode = 1;
});
