export type ParsedError = {
  file: string;
  line: number;
  col?: number;
  code?: string;
  message: string;
};

export type Evidence = {
  command: string;
  exitCode: number;
  ok: boolean;
  parsedErrors: ParsedError[];
  stdoutRef?: string;
  stderrRef?: string;
  timestamp: string;
  platform?: string;
  versions?: Record<string, string>;
};

export type CodeExcerpt = {
  path: string;
  startLine: number;
  endLine: number;
  textRef?: string;
  textPreview?: string;
};

export type ContextBudget = {
  projectSnapshotChars?: number;
  latestEvidenceChars?: number;
  relevantCodeChars?: number;
  changesSoFarChars?: number;
  memoryChars?: number;
  nextActionChars?: number;
};

export type ContextPacket = {
  systemRules: string;
  runGoal: string;
  projectSnapshot: string;
  milestone?: string;
  latestEvidence: string;
  relevantCode: CodeExcerpt[];
  changesSoFar: string;
  memoryDecisions: string[];
  nextActionRequest: string;
};

const formatCodeExcerpt = (excerpt: CodeExcerpt): string => {
  const header = `- ${excerpt.path}:${excerpt.startLine}-${excerpt.endLine}`;
  if (excerpt.textPreview) {
    return `${header}\n${excerpt.textPreview}`;
  }
  if (excerpt.textRef) {
    return `${header}\n(ref: ${excerpt.textRef})`;
  }
  return header;
};

export const serializeContextPacket = (packet: ContextPacket): string =>
  [
    "## SystemRules",
    packet.systemRules,
    "",
    "## RunGoal",
    packet.runGoal,
    "",
    "## ProjectSnapshot",
    packet.projectSnapshot,
    "",
    "## Milestone",
    packet.milestone && packet.milestone.trim().length > 0 ? packet.milestone : "- none",
    "",
    "## LatestEvidence",
    packet.latestEvidence,
    "",
    "## RelevantCode",
    packet.relevantCode.length > 0 ? packet.relevantCode.map(formatCodeExcerpt).join("\n\n") : "- none",
    "",
    "## ChangesSoFar",
    packet.changesSoFar,
    "",
    "## MemoryDecisions",
    packet.memoryDecisions.length > 0 ? packet.memoryDecisions.map((item) => `- ${item}`).join("\n") : "- none",
    "",
    "## NextActionRequest",
    packet.nextActionRequest
  ].join("\n");
