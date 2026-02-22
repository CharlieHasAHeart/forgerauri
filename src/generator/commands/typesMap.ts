export type CommandFieldKind = "string" | "boolean" | "number" | "json";

export type ParsedSpecType = {
  raw: string;
  base: string;
  optional: boolean;
  rustType: string;
  tsType: string;
  rustDefault: string;
  kind: CommandFieldKind;
};

const normalizeRawType = (value: unknown): string => {
  if (typeof value !== "string") {
    return "json";
  }

  const trimmed = value.trim().toLowerCase();
  return trimmed.length > 0 ? trimmed : "json";
};

const parseBaseAndOptional = (raw: string): { base: string; optional: boolean } => {
  if (raw.endsWith("?")) {
    return { base: raw.slice(0, -1).trim() || "json", optional: true };
  }
  return { base: raw, optional: false };
};

const rustAndTs = (base: string): { rust: string; ts: string; defaultRust: string; kind: CommandFieldKind } => {
  switch (base) {
    case "string":
      return { rust: "String", ts: "string", defaultRust: '"".to_string()', kind: "string" };
    case "boolean":
      return { rust: "bool", ts: "boolean", defaultRust: "true", kind: "boolean" };
    case "int":
      return { rust: "i64", ts: "number", defaultRust: "0", kind: "number" };
    case "float":
      return { rust: "f64", ts: "number", defaultRust: "0.0", kind: "number" };
    case "timestamp":
      return { rust: "String", ts: "string", defaultRust: '"".to_string()', kind: "string" };
    case "json":
      return { rust: "serde_json::Value", ts: "unknown", defaultRust: "serde_json::json!({})", kind: "json" };
    default:
      return { rust: "serde_json::Value", ts: "unknown", defaultRust: "serde_json::json!({})", kind: "json" };
  }
};

export const parseSpecType = (value: unknown): ParsedSpecType => {
  const raw = normalizeRawType(value);
  const { base, optional } = parseBaseAndOptional(raw);
  const mapped = rustAndTs(base);

  return {
    raw,
    base,
    optional,
    rustType: optional ? `Option<${mapped.rust}>` : mapped.rust,
    tsType: optional ? `${mapped.ts} | undefined` : mapped.ts,
    rustDefault: optional ? "None" : mapped.defaultRust,
    kind: mapped.kind
  };
};

export const toSnakeCase = (value: string): string => {
  const normalized = value
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase();

  return normalized || "field";
};

export const toPascalCase = (value: string): string =>
  toSnakeCase(value)
    .split("_")
    .filter((part) => part.length > 0)
    .map((part) => `${part[0].toUpperCase()}${part.slice(1)}`)
    .join("") || "Generated";

export const toRustIdent = (value: string): string => {
  const snake = toSnakeCase(value);
  const prefixed = /^[a-z_]/.test(snake) ? snake : `f_${snake}`;
  return prefixed || "field";
};
