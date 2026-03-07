// Protocol-layer version definitions for boundary contract compatibility.
export const PROTOCOL_VERSION = "1.0.0";

export interface ProtocolVersionInfo {
  version: string;
  major: number;
  minor: number;
  patch: number;
}

export const PROTOCOL_VERSION_INFO: ProtocolVersionInfo = {
  version: "1.0.0",
  major: 1,
  minor: 0,
  patch: 0
};

export function isProtocolVersionInfo(value: unknown): value is ProtocolVersionInfo {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const version = Reflect.get(value, "version");
  const major = Reflect.get(value, "major");
  const minor = Reflect.get(value, "minor");
  const patch = Reflect.get(value, "patch");

  return (
    typeof version === "string" &&
    typeof major === "number" &&
    Number.isInteger(major) &&
    typeof minor === "number" &&
    Number.isInteger(minor) &&
    typeof patch === "number" &&
    Number.isInteger(patch)
  );
}

export function isCurrentProtocolVersion(value: unknown): boolean {
  return value === PROTOCOL_VERSION;
}
