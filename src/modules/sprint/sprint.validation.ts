import { z } from "zod";

export const createSprintSchema = z
  .object({
    name: z.string().trim().min(1, "Name is required").max(150),
    goal: z.string().trim().max(2000).optional(),
    startDate: z.coerce.date(),
    endDate: z.coerce.date(),
  })
  .refine((v) => v.endDate >= v.startDate, {
    message: "endDate must be on or after startDate",
    path: ["endDate"],
  });

export const updateSprintSchema = z
  .object({
    name: z.string().trim().min(1).max(150).optional(),
    goal: z.string().trim().max(2000).optional(),
    startDate: z.coerce.date().optional(),
    endDate: z.coerce.date().optional(),
  })
  .refine((v) => !v.startDate || !v.endDate || v.endDate >= v.startDate, {
    message: "endDate must be on or after startDate",
    path: ["endDate"],
  });

export const sprintIdParamSchema = z.object({
  sprintId: z.string().uuid("Invalid sprint id"),
});

export type CreateSprintBody = z.infer<typeof createSprintSchema>;
export type UpdateSprintBody = z.infer<typeof updateSprintSchema>;
