export const CANONICAL_CONTRACT_PATH = "forgetauri.contract.json";
export const LEGACY_CONTRACT_PATH = "design/contract.json";

export const normalizeContractPath = (path: string): string => {
  if (path === LEGACY_CONTRACT_PATH) {
    return CANONICAL_CONTRACT_PATH;
  }
  return path;
};
