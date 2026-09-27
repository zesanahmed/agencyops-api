import type { Request, Response } from "express";
import { sendSuccess } from "../../lib/apiResponse.js";
import type { PaginationQuery } from "../organization/organization.validation.js";
import { createComment, deleteComment, listComments, updateComment } from "./comment.service.js";
import type { CreateCommentBody, UpdateCommentBody } from "./comment.validation.js";

function ctx(req: Request) {
  const { projectId, taskId } = req.params as { projectId: string; taskId: string };
  return {
    organizationId: req.orgContext!.organization.id,
    projectId,
    taskId,
    membershipId: req.orgContext!.membership.id,
    role: req.orgContext!.membership.role,
  };
}

export async function create(req: Request, res: Response): Promise<void> {
  const c = ctx(req);
  const body = req.body as CreateCommentBody;
  const comment = await createComment({
    organizationId: c.organizationId,
    projectId: c.projectId,
    taskId: c.taskId,
    authorMembershipId: c.membershipId,
    content: body.content,
    mentionedMembershipIds: body.mentionedMembershipIds,
  });
  sendSuccess(res, { comment }, "Comment created successfully", 201);
}

export async function list(req: Request, res: Response): Promise<void> {
  const c = ctx(req);
  const { page, limit } = req.query as unknown as PaginationQuery;
  const result = await listComments(c.organizationId, c.projectId, c.taskId, page, limit);
  sendSuccess(res, result, "Comments retrieved successfully");
}

export async function update(req: Request, res: Response): Promise<void> {
  const c = ctx(req);
  const { commentId } = req.params as { commentId: string };
  const body = req.body as UpdateCommentBody;
  const comment = await updateComment(c.organizationId, c.projectId, c.taskId, commentId, c.membershipId, body.content);
  sendSuccess(res, { comment }, "Comment updated successfully");
}

export async function remove(req: Request, res: Response): Promise<void> {
  const c = ctx(req);
  const { commentId } = req.params as { commentId: string };
  await deleteComment(c.organizationId, c.projectId, c.taskId, commentId, c.membershipId, c.role);
  sendSuccess(res, null, "Comment deleted successfully");
}
