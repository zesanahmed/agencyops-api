import { z } from "zod";

export const activityListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  projectId: z.string().uuid("Invalid project id").optional(),
  taskId: z.string().uuid("Invalid task id").optional(),
  actorMembershipId: z.string().uuid("Invalid membership id").optional(),
  entityType: z.enum(["Project", "Sprint", "Task", "Comment", "Membership"]).optional(),
});
