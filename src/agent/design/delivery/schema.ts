import { z } from "zod";

export const deliveryDesignV1Schema = z.object({
  version: z.literal("v1"),
  verifyPolicy: z.object({
    levelDefault: z.literal("full"),
    gates: z.array(z.enum(["pnpm_install_if_needed", "pnpm_build", "cargo_check", "tauri_help", "tauri_build"])),
    smokeCommands: z.array(z.string().min(1)).optional()
  }),
  preflight: z.object({
    checks: z.array(
      z.object({
        id: z.string().min(1),
        description: z.string().min(1),
        cmd: z.string().optional(),
        required: z.boolean()
      })
    )
  }),
  assets: z.object({
    icons: z.object({
      required: z.boolean(),
      paths: z.array(z.string().min(1))
    }),
    capabilities: z
      .object({
        required: z.boolean()
      })
      .optional()
  })
});

export type DeliveryDesignV1 = z.infer<typeof deliveryDesignV1Schema>;
