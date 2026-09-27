import { z } from "zod";

export const createCommentSchema = z.object({
  content: z.string().trim().min(1, "Content is required").max(10000),
  mentionedMembershipIds: z.array(z.string().uuid()).max(50).optional(),
});

export const updateCommentSchema = z.object({
  content: z.string().trim().min(1, "Content is required").max(10000),
});

export const commentIdParamSchema = z.object({
  commentId: z.string().uuid("Invalid comment id"),
});

export type CreateCommentBody = z.infer<typeof createCommentSchema>;
export type UpdateCommentBody = z.infer<typeof updateCommentSchema>;
