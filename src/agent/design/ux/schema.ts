import { z } from "zod";

const snakeId = /^[a-z][a-z0-9_]*$/;

const navItemSchema = z.object({
  id: z.string().regex(snakeId, "must be snake_case id"),
  title: z.string().min(1),
  route: z.string().min(1)
});

const screenSchema = z.object({
  id: z.string().regex(snakeId, "must be snake_case id"),
  title: z.string().min(1),
  route: z.string().min(1),
  purpose: z.string().min(1),
  dataNeeds: z.array(
    z.object({
      source: z.literal("command"),
      command: z.string().min(1),
      mapping: z.string().optional()
    })
  ),
  actions: z.array(
    z.object({
      label: z.string().min(1),
      command: z.string().min(1),
      argsFrom: z.string().optional(),
      successToast: z.string().optional(),
      errorToast: z.string().optional()
    })
  ),
  states: z.object({
    loading: z.boolean(),
    empty: z.string().min(1),
    error: z.string().min(1)
  })
});

export const uxDesignV1Schema = z.object({
  version: z.literal("v1"),
  navigation: z.object({
    kind: z.enum(["tabs", "sidebar", "single"]),
    items: z.array(navItemSchema)
  }),
  screens: z.array(screenSchema),
  uiConventions: z
    .object({
      dateFormat: z.string().optional(),
      defaultSort: z.string().optional()
    })
    .optional()
});

export type UXDesignV1 = z.infer<typeof uxDesignV1Schema>;
