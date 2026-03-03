export const normalizePath = (path: string): { canonical: string; reason?: string } => {
  const slashNormalized = path.replace(/\\/g, "/");
  if (slashNormalized === "design/contract.json") {
    return {
      canonical: "forgetauri.contract.json",
      reason: "legacy contract path replaced with canonical contract artifact path"
    };
  }
  return { canonical: slashNormalized };
};

