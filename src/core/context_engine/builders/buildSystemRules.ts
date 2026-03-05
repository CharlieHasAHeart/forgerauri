export const buildSystemRules = (): string =>
  [
    "Use only available tools and their schemas.",
    "Do not assume file contents or command results without evidence.",
    "If latest evidence is missing for verification-critical work, request a verification tool first.",
    "Prefer minimal deterministic edits with explicit file targets.",
    "Return machine-checkable outputs only."
  ].join(" ");
