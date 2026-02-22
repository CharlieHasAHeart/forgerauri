export type Zone = "generated" | "user" | "unknown";

const isUnder = (path: string, prefix: string): boolean => path === prefix || path.startsWith(`${prefix}/`);

export const classifyPath = (relativePath: string): Zone => {
  const normalized = relativePath.replace(/\\/g, "/").replace(/^\//, "");

  if (
    isUnder(normalized, "src/lib/generated") ||
    isUnder(normalized, "src-tauri/src/generated") ||
    isUnder(normalized, "src-tauri/migrations/generated") ||
    isUnder(normalized, "src/lib/screens/generated") ||
    isUnder(normalized, "src/lib/components/generated") ||
    isUnder(normalized, "src/lib/api/generated")
  ) {
    return "generated";
  }

  if (
    isUnder(normalized, "src/lib/custom") ||
    isUnder(normalized, "src-tauri/src/custom") ||
    normalized === "src/App.svelte" ||
    normalized === "src-tauri/src/main.rs"
  ) {
    return "user";
  }

  return "unknown";
};
