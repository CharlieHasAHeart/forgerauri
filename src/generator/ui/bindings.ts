import { toScreenSlug } from "./slug.js";

export const normalizeActionText = (value: string): string => value.toLowerCase().replace(/[^a-z0-9]/g, "");

const pickShortestStable = (values: string[]): string | null => {
  if (values.length === 0) return null;
  return [...values].sort((left, right) => left.length - right.length || left.localeCompare(right))[0];
};

const pickLexicographic = (values: string[]): string | null => {
  if (values.length === 0) return null;
  return [...values].sort((left, right) => left.localeCompare(right))[0];
};

export const bindActionToCommand = (actionLabel: string, commandNames: string[]): string | null => {
  const normalizedAction = normalizeActionText(actionLabel);
  const normalizedCommands = commandNames.map((name) => ({ name, normalized: normalizeActionText(name) }));

  const exact = normalizedCommands.find((entry) => entry.normalized === normalizedAction);
  if (exact) return exact.name;

  const substringCandidates = normalizedCommands
    .filter(
      (entry) =>
        normalizedAction.includes(entry.normalized) ||
        (entry.normalized.length > 0 && entry.normalized.includes(normalizedAction))
    )
    .map((entry) => entry.name);
  const substringPick = pickShortestStable(substringCandidates);
  if (substringPick) return substringPick;

  const lowerAction = actionLabel.toLowerCase();

  if (lowerAction.includes("lint")) {
    const lintCandidates = commandNames.filter((name) => name.toLowerCase().startsWith("lint_"));
    const lintPick = pickLexicographic(lintCandidates);
    if (lintPick) return lintPick;
  }

  if (lowerAction.includes("fix") || lowerAction.includes("apply")) {
    const fixCandidates = commandNames.filter((name) => {
      const lowered = name.toLowerCase();
      return lowered.startsWith("apply_") || lowered.startsWith("fix_");
    });
    const fixPick = pickLexicographic(fixCandidates);
    if (fixPick) return fixPick;
  }

  if (lowerAction.includes("connect")) {
    const connectCandidates = commandNames.filter((name) => name.toLowerCase().startsWith("connect_"));
    const connectPick = pickLexicographic(connectCandidates);
    if (connectPick) return connectPick;
  }

  if (lowerAction.includes("list")) {
    const listCandidates = commandNames.filter((name) => {
      const lowered = name.toLowerCase();
      return lowered.startsWith("list_") || lowered.endsWith("_list");
    });
    const listPick = pickLexicographic(listCandidates);
    if (listPick) return listPick;
  }

  return null;
};

export const buildActionId = (screenName: string, actionLabel: string): string => {
  const screenSlug = toScreenSlug(screenName);
  return `${screenSlug}__${normalizeActionText(actionLabel)}`;
};
