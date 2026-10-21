import { z } from "zod";
import { requiredDate } from "../../lib/zodDates.js";

export const createSprintSchema = z
  .object({
    name: z.string().trim().min(1, "Name is required").max(150),
    goal: z.string().trim().max(2000).optional(),
    startDate: requiredDate,
    endDate: requiredDate,
  })
  .refine((v) => v.endDate >= v.startDate, {
    message: "endDate must be on or after startDate",
    path: ["endDate"],
  });

export const updateSprintSchema = z
  .object({
    name: z.string().trim().min(1).max(150).optional(),
    goal: z.string().trim().max(2000).optional(),
    startDate: requiredDate.optional(),
    endDate: requiredDate.optional(),
  })
  .refine((v) => !v.startDate || !v.endDate || v.endDate >= v.startDate, {
    message: "endDate must be on or after startDate",
    path: ["endDate"],
  });

export const sprintIdParamSchema = z.object({
  sprintId: z.string().uuid("Invalid sprint id"),
});

/** Body is optional; with no body the open tasks simply stay in the completed sprint. */
export const completeSprintSchema = z.preprocess(
  (v) => v ?? {},
  z.object({
    moveOpenTasksTo: z.union([z.literal("BACKLOG"), z.string().uuid("Invalid sprint id")]).optional(),
  }),
);

export type CompleteSprintBody = { moveOpenTasksTo?: string | undefined };
export type CreateSprintBody = z.infer<typeof createSprintSchema>;
export type UpdateSprintBody = z.infer<typeof updateSprintSchema>;
