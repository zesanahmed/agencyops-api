import { z } from "zod";

export const REQUEST_TYPES = ["NEW_REQUIREMENT", "CHANGE_REQUEST", "QUESTION", "FEEDBACK", "ISSUE"] as const;
export const REQUEST_STATUSES = ["OPEN", "IN_REVIEW", "RESOLVED", "REJECTED"] as const;
const TASK_STATUS = ["BACKLOG", "TODO", "IN_PROGRESS", "IN_REVIEW", "DONE"] as const;

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export const createUpdateSchema = z.object({
  title: z.string().trim().min(1, "Title is required").max(200),
  body: z.string().trim().min(1, "Body is required").max(10000),
});

export const createMessageSchema = z.object({
  content: z.string().trim().min(1, "Message cannot be empty").max(5000),
});

export const createClientRequestSchema = z.object({
  type: z.enum(REQUEST_TYPES),
  title: z.string().trim().min(1, "Title is required").max(200),
  description: z.string().trim().min(1, "Description is required").max(10000),
});

export const updateClientRequestSchema = z
  .object({
    status: z.enum(REQUEST_STATUSES).optional(),
    resolutionNote: z.string().trim().max(5000).nullable().optional(),
  })
  .refine((v) => v.status !== undefined || v.resolutionNote !== undefined, {
    message: "At least one field is required",
  });

export const requestListQuerySchema = paginationSchema.extend({
  projectId: z.string().uuid().optional(),
  status: z.enum(REQUEST_STATUSES).optional(),
  type: z.enum(REQUEST_TYPES).optional(),
});

export const portalTaskQuerySchema = paginationSchema.extend({
  status: z.enum(TASK_STATUS).optional(),
});

export const setVisibilitySchema = z.object({
  clientVisible: z.boolean(),
});

export const projectIdParamSchema = z.object({ projectId: z.string().uuid("Invalid project id") });
export const taskIdParamSchema = z.object({ taskId: z.string().uuid("Invalid task id") });
export const updateIdParamSchema = z.object({ updateId: z.string().uuid("Invalid update id") });
export const messageIdParamSchema = z.object({ messageId: z.string().uuid("Invalid message id") });
export const fileIdParamSchema = z.object({ fileId: z.string().uuid("Invalid file id") });
export const requestIdParamSchema = z.object({ requestId: z.string().uuid("Invalid request id") });

export type Pagination = z.infer<typeof paginationSchema>;
export type RequestListQuery = z.infer<typeof requestListQuerySchema>;
export type PortalTaskQuery = z.infer<typeof portalTaskQuerySchema>;
