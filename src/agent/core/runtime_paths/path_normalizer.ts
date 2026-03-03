import { CANONICAL_CONTRACT_PATH, LEGACY_CONTRACT_PATH, normalizeContractPath } from "../../../app/conventions.js";

export const normalizePath = (path: string): { canonical: string; reason?: string } => {
  const slashNormalized = path.replace(/\\/g, "/");
  const canonical = normalizeContractPath(slashNormalized);
  if (canonical === CANONICAL_CONTRACT_PATH && slashNormalized === LEGACY_CONTRACT_PATH) {
    return {
      canonical,
      reason: "legacy contract path replaced with canonical contract artifact path"
    };
  }
  return { canonical: slashNormalized };
};
