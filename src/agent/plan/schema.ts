import { z } from "zod";

export const successCriteriaSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("command"),
    cmd: z.string().min(1),
    args: z.array(z.string()).default([]),
    cwd: z.string().optional(),
    expect_exit_code: z.number().int().default(0)
  }),
  z.object({
    type: z.literal("file_exists"),
    path: z.string().min(1)
  }),
  z.object({
    type: z.literal("file_contains"),
    path: z.string().min(1),
    contains: z.string().min(1)
  }),
  z.object({
    type: z.literal("tool_result"),
    tool_name: z.string().min(1),
    expected_ok: z.boolean().default(true)
  })
]);

export type SuccessCriteria = z.infer<typeof successCriteriaSchema>;

export const planTaskSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  description: z.string().min(1),
  dependencies: z.array(z.string().min(1)).default([]),
  tool_hints: z.array(z.string().min(1)).default([]),
  success_criteria: z.array(successCriteriaSchema).min(1),
  task_type: z.enum(["build", "codegen", "test", "debug", "verify", "repair", "design", "materialize", "other"]).default("other")
});

export type PlanTask = z.infer<typeof planTaskSchema>;

export const planMilestoneSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  description: z.string().optional(),
  task_ids: z.array(z.string().min(1)).default([])
});

export type PlanMilestone = z.infer<typeof planMilestoneSchema>;

export const planV1Schema = z
  .object({
    version: z.literal("v1"),
    goal: z.string().min(1),
    acceptance_locked: z.boolean().default(true),
    tech_stack_locked: z.boolean().default(true),
    milestones: z.array(planMilestoneSchema).default([]),
    tasks: z.array(planTaskSchema).min(1)
  })
  .superRefine((value, ctx) => {
    const ids = new Set<string>();
    for (const task of value.tasks) {
      if (ids.has(task.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `duplicate task id: ${task.id}`,
          path: ["tasks"]
        });
      }
      ids.add(task.id);
    }

    for (const task of value.tasks) {
      for (const dep of task.dependencies) {
        if (!ids.has(dep)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `unknown dependency '${dep}' for task '${task.id}'`,
            path: ["tasks"]
          });
        }
      }
    }

    const milestoneIds = new Set(value.milestones.map((m) => m.id));
    if (milestoneIds.size !== value.milestones.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "duplicate milestone id",
        path: ["milestones"]
      });
    }

    for (const milestone of value.milestones) {
      for (const taskId of milestone.task_ids) {
        if (!ids.has(taskId)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `unknown task '${taskId}' in milestone '${milestone.id}'`,
            path: ["milestones"]
          });
        }
      }
    }
  });

export type PlanV1 = z.infer<typeof planV1Schema>;

export const taskActionPlanActionSchema = z.object({
  name: z.string().min(1),
  input: z.unknown(),
  on_fail: z.enum(["stop", "continue"]).optional(),
  idempotency_key: z.string().min(1).optional()
});

export const taskActionPlanV1Schema = z.object({
  version: z.literal("v1"),
  task_id: z.string().min(1),
  rationale: z.string().min(1),
  actions: z.array(taskActionPlanActionSchema).min(1),
  expected_artifacts: z.array(z.string().min(1)).optional()
});

export type TaskActionPlanV1 = z.infer<typeof taskActionPlanV1Schema>;

export const planChangeTypeSchema = z.enum([
  "reorder_tasks",
  "add_task",
  "scope_reduce",
  "scope_expand",
  "replace_tech",
  "relax_acceptance"
]);

export const planChangeRequestV1Schema = z.object({
  version: z.literal("v1"),
  reason: z.string().min(1),
  change_type: planChangeTypeSchema,
  evidence: z.array(z.string()).default([]),
  impact: z.object({
    steps_delta: z.number().int(),
    risk: z.string().default("unknown")
  }),
  requested_tools: z.array(z.string()).default([]),
  proposed_plan: planV1Schema.optional()
});

export type PlanChangeRequestV1 = z.infer<typeof planChangeRequestV1Schema>;

const planTaskChangesSchema = planTaskSchema
  .omit({ id: true })
  .partial()
  .extend({
    success_criteria: z.array(successCriteriaSchema).optional()
  });

export const planPatchOperationSchema = z.discriminatedUnion("op", [
  z.object({
    op: z.literal("add_task"),
    task: planTaskSchema,
    after_task_id: z.string().min(1).optional()
  }),
  z.object({
    op: z.literal("remove_task"),
    task_id: z.string().min(1)
  }),
  z.object({
    op: z.literal("edit_task"),
    task_id: z.string().min(1),
    changes: planTaskChangesSchema
  }),
  z.object({
    op: z.literal("reorder"),
    task_id: z.string().min(1),
    after_task_id: z.string().min(1).optional()
  }),
  z.object({
    op: z.literal("edit_acceptance"),
    changes: z.unknown()
  }),
  z.object({
    op: z.literal("edit_tech_stack"),
    changes: z.unknown()
  })
]);

export type PlanPatchOperation = z.infer<typeof planPatchOperationSchema>;

export const planChangeRequestV2Schema = z.object({
  version: z.literal("v2"),
  reason: z.string().min(1),
  change_type: z.enum([
    "reorder_tasks",
    "add_task",
    "remove_task",
    "edit_task",
    "scope_reduce",
    "scope_expand",
    "replace_tech",
    "relax_acceptance"
  ]),
  evidence: z.array(z.string()).default([]),
  impact: z.object({
    steps_delta: z.number().int(),
    risk: z.string().default("unknown")
  }),
  requested_tools: z.array(z.string()).default([]),
  patch: z.array(planPatchOperationSchema).default([])
});

export type PlanChangeRequestV2 = z.infer<typeof planChangeRequestV2Schema>;

export const planChangeDecisionSchema = z.object({
  decision: z.enum(["approved", "denied", "needs_more_evidence"]),
  reason: z.string().min(1),
  required_evidence: z.array(z.string()).default([])
});

export type PlanChangeDecision = z.infer<typeof planChangeDecisionSchema>;
