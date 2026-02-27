import { describe, expect, test } from "vitest";
import { contractDesignV1Schema } from "../src/agent/design/contract/schema.js";
import {
  contractDesignV1CoreSchema,
  contractForDeliveryV1Schema,
  contractForImplementationV1Schema,
  contractForUxV1Schema
} from "../src/agent/design/contract/views.js";

const fullContract = contractDesignV1Schema.parse({
  version: "v1",
  app: { name: "MacroGraph", description: "desc" },
  commands: [
    {
      name: "lint_config",
      purpose: "lint",
      inputs: [{ name: "file_path", type: "string" }],
      outputs: [{ name: "ok", type: "boolean" }],
      errors: [{ code: "LINT_ERR", message: "failed" }],
      sideEffects: ["db_write"],
      idempotent: true
    }
  ],
  dataModel: {
    tables: [{ name: "lint_runs", columns: [{ name: "id", type: "integer", primaryKey: true }] }],
    migrations: { strategy: "single" }
  },
  acceptance: {
    mustPass: ["pnpm_build", "cargo_check"],
    smokeCommands: ["lint_config"]
  }
});

describe("contract view schemas", () => {
  test("core view accepts full contract", () => {
    const parsed = contractDesignV1CoreSchema.parse(fullContract);
    expect(parsed.version).toBe("v1");
    expect(parsed.commands[0]?.name).toBe("lint_config");
  });

  test("ux/implementation/delivery views project required fields", () => {
    const uxView = contractForUxV1Schema.parse(fullContract);
    const implView = contractForImplementationV1Schema.parse(fullContract);
    const deliveryView = contractForDeliveryV1Schema.parse(fullContract);

    expect(uxView.commands[0]?.purpose).toBe("lint");
    expect(implView.dataModel.tables[0]?.name).toBe("lint_runs");
    expect(deliveryView.commands[0]?.name).toBe("lint_config");
  });
});
