import { z } from "zod";
import {
  commandSchema,
  contractAcceptanceSchema,
  contractDesignV1Schema,
  tableSchema
} from "./schema.js";

const appSchema = contractDesignV1Schema.shape.app;

export const contractDesignV1CoreSchema = z.object({
  version: z.literal("v1"),
  app: appSchema,
  commands: z.array(commandSchema),
  dataModel: z
    .object({
      tables: z.array(tableSchema),
      migrations: contractDesignV1Schema.shape.dataModel.shape.migrations.optional()
    })
    .optional(),
  acceptance: contractAcceptanceSchema.optional()
});

export const contractForUxV1Schema = z.object({
  version: z.literal("v1"),
  app: appSchema,
  commands: z.array(
    commandSchema.pick({
      name: true,
      purpose: true,
      inputs: true,
      outputs: true,
      errors: true,
      sideEffects: true
    })
  )
});

export const contractForImplementationV1Schema = z.object({
  version: z.literal("v1"),
  app: appSchema,
  commands: z.array(
    commandSchema.pick({
      name: true,
      purpose: true,
      inputs: true,
      outputs: true,
      errors: true,
      sideEffects: true,
      idempotent: true
    })
  ),
  dataModel: z.object({
    tables: z.array(tableSchema),
    migrations: contractDesignV1Schema.shape.dataModel.shape.migrations.optional()
  })
});

export const contractForDeliveryV1Schema = z.object({
  version: z.literal("v1"),
  app: appSchema,
  commands: z.array(commandSchema.pick({ name: true }))
}).strict();

export type CoreContractV1 = z.infer<typeof contractDesignV1CoreSchema>;
export type ContractForUxV1 = z.infer<typeof contractForUxV1Schema>;
export type ContractForImplementationV1 = z.infer<typeof contractForImplementationV1Schema>;
export type ContractForDeliveryV1 = z.infer<typeof contractForDeliveryV1Schema>;
