import { z } from "zod";

const TASK_STATUS = ["BACKLOG", "TODO", "IN_PROGRESS", "IN_REVIEW", "DONE"] as const;
const TASK_PRIORITY = ["LOW", "MEDIUM", "HIGH", "URGENT"] as const;

const dateOrderRefine = (v: { startDate?: Date | undefined; dueDate?: Date | undefined }) =>
  !v.startDate || !v.dueDate || v.dueDate >= v.startDate;

export const createTaskSchema = z
  .object({
    title: z.string().trim().min(1, "Title is required").max(300),
    description: z.string().trim().max(10000).optional(),
    sprintId: z.string().uuid().optional(),
    assigneeMembershipId: z.string().uuid().optional(),
    status: z.enum(TASK_STATUS).optional(),
    priority: z.enum(TASK_PRIORITY).optional(),
    startDate: z.coerce.date().optional(),
    dueDate: z.coerce.date().optional(),
  })
  .refine(dateOrderRefine, { message: "dueDate must be on or after startDate", path: ["dueDate"] });

export const updateTaskSchema = z
  .object({
    title: z.string().trim().min(1).max(300).optional(),
    description: z.string().trim().max(10000).optional(),
    sprintId: z.string().uuid().nullable().optional(),
    assigneeMembershipId: z.string().uuid().nullable().optional(),
    status: z.enum(TASK_STATUS).optional(),
    priority: z.enum(TASK_PRIORITY).optional(),
    startDate: z.coerce.date().optional(),
    dueDate: z.coerce.date().optional(),
  })
  .refine(dateOrderRefine, { message: "dueDate must be on or after startDate", path: ["dueDate"] });

export const createSubtaskSchema = z.object({
  title: z.string().trim().min(1, "Title is required").max(300),
  description: z.string().trim().max(10000).optional(),
  assigneeMembershipId: z.string().uuid().optional(),
  status: z.enum(TASK_STATUS).optional(),
  priority: z.enum(TASK_PRIORITY).optional(),
});

export const taskListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  status: z.enum(TASK_STATUS).optional(),
  priority: z.enum(TASK_PRIORITY).optional(),
  sprintId: z.string().uuid().optional(),
  assigneeMembershipId: z.string().uuid().optional(),
  search: z.string().trim().max(200).optional(),
  sortBy: z.enum(["createdAt", "dueDate", "priority"]).default("createdAt"),
  sortOrder: z.enum(["asc", "desc"]).default("desc"),
});

export const taskIdParamSchema = z.object({
  taskId: z.string().uuid("Invalid task id"),
});

export const addCollaboratorSchema = z.object({
  membershipId: z.string().uuid("Invalid membership id"),
});

export const taskCollaboratorIdParamSchema = z.object({
  taskCollaboratorId: z.string().uuid("Invalid task-collaborator id"),
});

export type CreateTaskBody = z.infer<typeof createTaskSchema>;
export type UpdateTaskBody = z.infer<typeof updateTaskSchema>;
export type CreateSubtaskBody = z.infer<typeof createSubtaskSchema>;
export type TaskListQuery = z.infer<typeof taskListQuerySchema>;
export type AddCollaboratorBody = z.infer<typeof addCollaboratorSchema>;
