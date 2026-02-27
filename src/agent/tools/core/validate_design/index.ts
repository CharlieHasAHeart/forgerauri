import { readFile } from "node:fs/promises";
import { isAbsolute } from "node:path";
import { z } from "zod";
import type { ContractDesignV1 } from "../../../design/contract/schema.js";
import { contractDesignV1Schema } from "../../../design/contract/schema.js";
import { deliveryDesignV1Schema, type DeliveryDesignV1 } from "../../../design/delivery/schema.js";
import type { ImplementationDesignV1 } from "../../../design/implementation/schema.js";
import { implementationDesignV1Schema } from "../../../design/implementation/schema.js";
import type { UXDesignV1 } from "../../../design/ux/schema.js";
import { uxDesignV1Schema } from "../../../design/ux/schema.js";
import type { ToolPackage } from "../../types.js";

const allowedGates = new Set(["pnpm_install_if_needed", "pnpm_build", "cargo_check", "tauri_help", "tauri_build"]);

type ValidationError = {
  code: string;
  message: string;
  path?: string;
};

const inputSchema = z.object({
  projectRoot: z.string().min(1),
  contract: z.unknown().optional(),
  ux: z.unknown().optional(),
  implementation: z.unknown().optional(),
  delivery: z.unknown().optional()
});

const outputSchema = z.object({
  ok: z.boolean(),
  errors: z.array(
    z.object({
      code: z.string(),
      message: z.string(),
      path: z.string().optional()
    })
  ),
  summary: z.string()
});

const summarizeZodIssues = (error: z.ZodError): ValidationError[] =>
  error.issues.map((issue) => ({
    code: "DESIGN_SCHEMA_INVALID",
    message: issue.message,
    path: issue.path.join(".") || "<root>"
  }));

const validateUxCommands = (contract: ContractDesignV1, ux: UXDesignV1): ValidationError[] => {
  const errors: ValidationError[] = [];
  const commandNames = new Set(contract.commands.map((cmd) => cmd.name));

  ux.screens.forEach((screen, screenIndex) => {
    screen.actions.forEach((action, actionIndex) => {
      if (!commandNames.has(action.command)) {
        errors.push({
          code: "UX_UNKNOWN_COMMAND",
          message: `Screen action references unknown command: ${action.command}`,
          path: `screens.${screenIndex}.actions.${actionIndex}.command`
        });
      }
    });

    screen.dataNeeds.forEach((dataNeed, needIndex) => {
      if (dataNeed.source === "command" && !commandNames.has(dataNeed.command)) {
        errors.push({
          code: "UX_UNKNOWN_COMMAND",
          message: `Screen dataNeed references unknown command: ${dataNeed.command}`,
          path: `screens.${screenIndex}.dataNeeds.${needIndex}.command`
        });
      }
    });
  });

  return errors;
};

const validateImplementationTables = (contract: ContractDesignV1, impl: ImplementationDesignV1): ValidationError[] => {
  const errors: ValidationError[] = [];
  const tableNames = new Set(contract.dataModel.tables.map((table) => table.name));

  impl.rust.services.forEach((service, serviceIndex) => {
    service.usesTables.forEach((table, tableIndex) => {
      if (!tableNames.has(table)) {
        errors.push({
          code: "IMPL_UNKNOWN_TABLE",
          message: `Service ${service.name} references unknown table: ${table}`,
          path: `rust.services.${serviceIndex}.usesTables.${tableIndex}`
        });
      }
    });
  });

  impl.rust.repos.forEach((repo, repoIndex) => {
    if (!tableNames.has(repo.table)) {
      errors.push({
        code: "IMPL_UNKNOWN_TABLE",
        message: `Repo ${repo.name} references unknown table: ${repo.table}`,
        path: `rust.repos.${repoIndex}.table`
      });
    }
  });

  return errors;
};

const validateDeliveryGates = (delivery: DeliveryDesignV1): ValidationError[] => {
  const errors: ValidationError[] = [];

  delivery.verifyPolicy.gates.forEach((gate, gateIndex) => {
    if (!allowedGates.has(gate)) {
      errors.push({
        code: "DELIVERY_UNKNOWN_GATE",
        message: `Unknown verify gate: ${gate}`,
        path: `verifyPolicy.gates.${gateIndex}`
      });
    }
  });

  return errors;
};

const validateDeliveryIcons = (delivery: DeliveryDesignV1): ValidationError[] => {
  const errors: ValidationError[] = [];
  const { icons } = delivery.assets;

  if (!icons.required) return errors;

  if (icons.paths.length === 0) {
    errors.push({
      code: "DELIVERY_ICON_PATH_INVALID",
      message: "assets.icons.required=true but no icon path provided",
      path: "assets.icons.paths"
    });
    return errors;
  }

  const hasPng = icons.paths.some((path) => path.toLowerCase().endsWith(".png"));
  if (!hasPng) {
    errors.push({
      code: "DELIVERY_ICON_PATH_INVALID",
      message: "assets.icons.required=true but no .png path found",
      path: "assets.icons.paths"
    });
  }

  icons.paths.forEach((path, index) => {
    if (isAbsolute(path) || path.split(/[\\/]/).includes("..")) {
      errors.push({
        code: "DELIVERY_ICON_PATH_INVALID",
        message: `Icon path must be project-root relative: ${path}`,
        path: `assets.icons.paths.${index}`
      });
    }
  });

  return errors;
};

const normalizeSmokeCommands = (commands: string[] | undefined): string[] => [...(commands ?? [])].sort((a, b) => a.localeCompare(b));

const normalizeContractMustPassToDeliveryGates = (mustPass: NonNullable<ContractDesignV1["acceptance"]>["mustPass"]): string[] =>
  [...mustPass].sort((a, b) => a.localeCompare(b));

const validateContractDeliveryConsistency = (contract: ContractDesignV1, delivery: DeliveryDesignV1): ValidationError[] => {
  const errors: ValidationError[] = [];
  const acceptance = contract.acceptance;
  if (!acceptance) return errors;

  const contractGates = normalizeContractMustPassToDeliveryGates(acceptance.mustPass);
  const deliveryGates = [...delivery.verifyPolicy.gates]
    .filter((gate) => gate !== "pnpm_install_if_needed")
    .sort((a, b) => a.localeCompare(b));

  if (JSON.stringify(contractGates) !== JSON.stringify(deliveryGates)) {
    errors.push({
      code: "CONTRACT_DELIVERY_POLICY_CONFLICT",
      message: `contract.acceptance.mustPass (${contractGates.join(",")}) conflicts with delivery.verifyPolicy.gates (${deliveryGates.join(",")})`,
      path: "contract.acceptance.mustPass"
    });
  }

  const contractSmoke = normalizeSmokeCommands(acceptance.smokeCommands);
  const deliverySmoke = normalizeSmokeCommands(delivery.verifyPolicy.smokeCommands);
  if (contractSmoke.length > 0 && deliverySmoke.length > 0 && JSON.stringify(contractSmoke) !== JSON.stringify(deliverySmoke)) {
    errors.push({
      code: "CONTRACT_DELIVERY_POLICY_CONFLICT",
      message: `contract.acceptance.smokeCommands (${contractSmoke.join(",")}) conflicts with delivery.verifyPolicy.smokeCommands (${deliverySmoke.join(",")})`,
      path: "contract.acceptance.smokeCommands"
    });
  }

  return errors;
};

const loadJson = async (path: string): Promise<unknown> => JSON.parse(await readFile(path, "utf8"));

const parseContract = (value: unknown): { value?: ContractDesignV1; errors: ValidationError[] } => {
  const parsed = contractDesignV1Schema.safeParse(value);
  if (parsed.success) return { value: parsed.data, errors: [] };
  return { errors: summarizeZodIssues(parsed.error) };
};

const parseUx = (value: unknown): { value?: UXDesignV1; errors: ValidationError[] } => {
  const parsed = uxDesignV1Schema.safeParse(value);
  if (parsed.success) return { value: parsed.data, errors: [] };
  return { errors: summarizeZodIssues(parsed.error) };
};

const parseImplementation = (value: unknown): { value?: ImplementationDesignV1; errors: ValidationError[] } => {
  const parsed = implementationDesignV1Schema.safeParse(value);
  if (parsed.success) return { value: parsed.data, errors: [] };
  return { errors: summarizeZodIssues(parsed.error) };
};

const parseDelivery = (value: unknown): { value?: DeliveryDesignV1; errors: ValidationError[] } => {
  const parsed = deliveryDesignV1Schema.safeParse(value);
  if (parsed.success) return { value: parsed.data, errors: [] };
  const mapped = parsed.error.issues.map((issue) => {
    const path = issue.path.join(".") || "<root>";
    if (path.startsWith("verifyPolicy.gates.")) {
      return {
        code: "DELIVERY_UNKNOWN_GATE",
        message: issue.message,
        path
      };
    }
    return {
      code: "DESIGN_SCHEMA_INVALID",
      message: issue.message,
      path
    };
  });
  return { errors: mapped };
};

export const runValidateDesign = async (args: {
  projectRoot: string;
  contract?: unknown;
  ux?: unknown;
  implementation?: unknown;
  delivery?: unknown;
}): Promise<z.infer<typeof outputSchema>> => {
  const contractRaw = args.contract ?? (await loadJson(`${args.projectRoot}/forgetauri.contract.json`));
  const uxRaw = args.ux ?? (await loadJson(`${args.projectRoot}/src/lib/design/ux.json`));
  const implementationRaw = args.implementation ?? (await loadJson(`${args.projectRoot}/src/lib/design/implementation.json`));
  const deliveryRaw = args.delivery ?? (await loadJson(`${args.projectRoot}/src/lib/design/delivery.json`));

  const contractParsed = parseContract(contractRaw);
  const uxParsed = parseUx(uxRaw);
  const implementationParsed = parseImplementation(implementationRaw);
  const deliveryParsed = parseDelivery(deliveryRaw);

  const errors: ValidationError[] = [
    ...contractParsed.errors,
    ...uxParsed.errors,
    ...implementationParsed.errors,
    ...deliveryParsed.errors
  ];

  if (contractParsed.value && uxParsed.value) {
    errors.push(...validateUxCommands(contractParsed.value, uxParsed.value));
  }

  if (contractParsed.value && implementationParsed.value) {
    errors.push(...validateImplementationTables(contractParsed.value, implementationParsed.value));
  }

  if (deliveryParsed.value) {
    errors.push(...validateDeliveryGates(deliveryParsed.value));
    errors.push(...validateDeliveryIcons(deliveryParsed.value));
  }

  if (contractParsed.value && deliveryParsed.value) {
    errors.push(...validateContractDeliveryConsistency(contractParsed.value, deliveryParsed.value));
  }

  return {
    ok: errors.length === 0,
    errors,
    summary: errors.length === 0 ? "Design validation passed" : `Design validation failed: ${errors.length} errors`
  };
};

export const toolPackage: ToolPackage<z.infer<typeof inputSchema>, z.infer<typeof outputSchema>> = {
  manifest: {
    name: "tool_validate_design",
    version: "1.0.0",
    category: "high",
    description: "Deterministically validates consistency across contract/ux/implementation/delivery design artifacts.",
    capabilities: ["validate", "design", "deterministic"],
    inputSchema,
    outputSchema,
    safety: {
      sideEffects: "none"
    }
  },
  runtime: {
    run: async (input) => {
      try {
        const data = await runValidateDesign({
          projectRoot: input.projectRoot,
          contract: input.contract,
          ux: input.ux,
          implementation: input.implementation,
          delivery: input.delivery
        });

        return {
          ok: true,
          data,
          meta: { touchedPaths: [] }
        };
      } catch (error) {
        return {
          ok: false,
          error: {
            code: "VALIDATE_DESIGN_FAILED",
            message: error instanceof Error ? error.message : "design validation failed"
          },
          meta: { touchedPaths: [] }
        };
      }
    },
    examples: [
      {
        title: "Validate design files in project",
        toolCall: {
          name: "tool_validate_design",
          input: { projectRoot: "./generated/app" }
        },
        expected: "Returns ok=true if design artifacts are consistent, otherwise returns detailed errors."
      }
    ]
  }
};

export {
  allowedGates,
  validateContractDeliveryConsistency,
  validateDeliveryGates,
  validateDeliveryIcons,
  validateImplementationTables,
  validateUxCommands
};
