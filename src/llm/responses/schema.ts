import { z } from "zod";

export type ResponseJsonSchemaFormat = {
  type: "json_schema";
  name: string;
  schema: unknown;
  strict: true;
};

const sanitizeName = (name: string): string => {
  const trimmed = name.trim().toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "");
  return trimmed.length > 0 ? trimmed : "response_schema";
};

const toJsonSchema = (schema: z.ZodTypeAny): unknown => {
  const anyZ = z as unknown as { toJSONSchema?: (s: z.ZodTypeAny) => unknown };
  if (typeof anyZ.toJSONSchema === "function") {
    return anyZ.toJSONSchema(schema);
  }
  return { type: "object" };
};

export const zodToResponseJsonSchema = <T>(schema: z.ZodType<T>, name: string): ResponseJsonSchemaFormat => {
  const jsonSchema = toJsonSchema(schema);
  return {
    type: "json_schema",
    name: sanitizeName(name),
    schema: jsonSchema,
    strict: true
  };
};
