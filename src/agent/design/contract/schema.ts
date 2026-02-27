import { z } from "zod";

const snakeCase = /^[a-z][a-z0-9_]*$/;

export const ioTypeSchema = z.enum(["string", "int", "float", "boolean", "json"]);
export const sideEffectSchema = z.enum(["db_read", "db_write", "fs_read", "fs_write", "network"]);

export const commandFieldSchema = z.object({
  name: z.string().regex(snakeCase, "must be snake_case"),
  type: ioTypeSchema,
  optional: z.boolean().optional(),
  description: z.string().optional()
});

export const commandSchema = z.object({
  name: z.string().regex(snakeCase, "must be snake_case"),
  purpose: z.string().min(1),
  inputs: z.array(commandFieldSchema),
  outputs: z.array(commandFieldSchema),
  errors: z.array(z.object({ code: z.string().min(1), message: z.string().min(1) })).optional(),
  sideEffects: z.array(sideEffectSchema).optional(),
  idempotent: z.boolean().optional()
});

export const columnSchema = z.object({
  name: z.string().regex(snakeCase, "must be snake_case"),
  type: z.enum(["text", "integer", "real", "blob", "json"]),
  nullable: z.boolean().optional(),
  primaryKey: z.boolean().optional(),
  default: z.string().optional()
});

export const tableSchema = z.object({
  name: z.string().regex(snakeCase, "must be snake_case"),
  columns: z.array(columnSchema).min(1),
  indices: z
    .array(
      z.object({
        name: z.string().regex(snakeCase, "must be snake_case"),
        columns: z.array(z.string().regex(snakeCase, "must be snake_case")).min(1),
        unique: z.boolean().optional()
      })
    )
    .optional(),
  description: z.string().optional()
});

export const contractAcceptanceSchema = z.object({
  mustPass: z.array(z.enum(["pnpm_build", "cargo_check", "tauri_help", "tauri_build"])).min(1),
  smokeCommands: z.array(z.string().regex(snakeCase, "must be snake_case")).optional()
});

export const contractDesignV1Schema = z.object({
  version: z.literal("v1"),
  app: z.object({
    name: z.string().min(1),
    description: z.string().optional()
  }),
  commands: z.array(commandSchema),
  dataModel: z.object({
    tables: z.array(tableSchema),
    migrations: z.object({
      strategy: z.enum(["single", "versioned"])
    })
  }),
  // Delivery verifyPolicy is the primary source for gates/smoke.
  // Keep this optional for backward compatibility with existing contracts.
  acceptance: contractAcceptanceSchema.optional()
});

export type ContractDesignV1 = z.infer<typeof contractDesignV1Schema>;
