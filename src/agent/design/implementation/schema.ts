import { z } from "zod";

const snakeCase = /^[a-z][a-z0-9_]*$/;

export const implementationDesignV1Schema = z.object({
  version: z.literal("v1"),
  rust: z.object({
    layering: z.literal("commands_service_repo"),
    services: z.array(
      z.object({
        name: z.string().regex(snakeCase, "must be snake_case"),
        responsibilities: z.array(z.string().min(1)),
        usesTables: z.array(z.string().regex(snakeCase, "must be snake_case"))
      })
    ),
    repos: z.array(
      z.object({
        name: z.string().regex(snakeCase, "must be snake_case"),
        table: z.string().regex(snakeCase, "must be snake_case"),
        operations: z.array(z.string().min(1))
      })
    ),
    errorModel: z.object({
      pattern: z.literal("thiserror+ApiResponse"),
      errorCodes: z.array(z.string().min(1))
    })
  }),
  frontend: z.object({
    apiPattern: z.literal("invoke_wrapper+typed_meta"),
    stateManagement: z.enum(["local", "stores"]).optional(),
    validation: z.enum(["zod", "simple"]).optional()
  })
});

export type ImplementationDesignV1 = z.infer<typeof implementationDesignV1Schema>;
