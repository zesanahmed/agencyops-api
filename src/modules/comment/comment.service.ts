import { AppError } from "../../errors/AppError.js";
import { prisma } from "../../lib/prisma.js";
import { roleHasPermission } from "../rbac/permissions.js";
import type { MembershipRole } from "../../generated/prisma/client.js";
import { toSafeComment, type SafeComment } from "./comment.mappers.js";

async function assertTaskInOrg(organizationId: string, projectId: string, taskId: string): Promise<void> {
  const task = await prisma.task.findFirst({
    where: { id: taskId, projectId, deletedAt: null, project: { organizationId, deletedAt: null } },
    select: { id: true },
  });
  if (!task) {
    throw new AppError("Task not found", 404);
  }
}

export async function createComment(input: {
  organizationId: string;
  projectId: string;
  taskId: string;
  authorMembershipId: string;
  content: string;
  mentionedMembershipIds?: string[] | undefined;
}): Promise<SafeComment> {
  await assertTaskInOrg(input.organizationId, input.projectId, input.taskId);

  const mentionIds = input.mentionedMembershipIds ?? [];
  if (mentionIds.length > 0) {
    const validCount = await prisma.membership.count({
      where: { id: { in: mentionIds }, organizationId: input.organizationId, status: "ACTIVE" },
    });
    if (validCount !== mentionIds.length) {
      throw new AppError("One or more mentioned members were not found in this organization", 404);
    }
  }

  const comment = await prisma.$transaction(async (tx) => {
    const txClient = tx as unknown as Pick<typeof prisma, "comment" | "commentMention" | "notification">;

    const created = await txClient.comment.create({
      data: { taskId: input.taskId, authorMembershipId: input.authorMembershipId, content: input.content },
    });

    for (const membershipId of mentionIds) {
      await txClient.commentMention.create({ data: { commentId: created.id, membershipId } });
      await txClient.notification.create({
        data: {
          organizationId: input.organizationId,
          recipientMembershipId: membershipId,
          type: "MENTION",
          title: "You were mentioned in a comment",
          message: input.content.slice(0, 200),
        },
      });
    }

    return created;
  });

  return toSafeComment(comment);
}

export async function listComments(
  organizationId: string,
  projectId: string,
  taskId: string,
  page: number,
  limit: number,
): Promise<{ comments: SafeComment[]; pagination: { page: number; limit: number; total: number; totalPages: number } }> {
  await assertTaskInOrg(organizationId, projectId, taskId);
  const where = { taskId, deletedAt: null };
  const [comments, total] = await Promise.all([
    prisma.comment.findMany({ where, orderBy: { createdAt: "asc" }, skip: (page - 1) * limit, take: limit }),
    prisma.comment.count({ where }),
  ]);
  return {
    comments: comments.map(toSafeComment),
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  };
}

export async function updateComment(
  organizationId: string,
  projectId: string,
  taskId: string,
  commentId: string,
  callerMembershipId: string,
  content: string,
): Promise<SafeComment> {
  await assertTaskInOrg(organizationId, projectId, taskId);
  const comment = await prisma.comment.findFirst({ where: { id: commentId, taskId, deletedAt: null } });
  if (!comment) {
    throw new AppError("Comment not found", 404);
  }
  if (comment.authorMembershipId !== callerMembershipId) {
    throw new AppError("Only the comment's author can edit it", 403);
  }
  const updated = await prisma.comment.update({ where: { id: commentId }, data: { content } });
  return toSafeComment(updated);
}

export async function deleteComment(
  organizationId: string,
  projectId: string,
  taskId: string,
  commentId: string,
  callerMembershipId: string,
  callerRole: MembershipRole,
): Promise<void> {
  await assertTaskInOrg(organizationId, projectId, taskId);
  const comment = await prisma.comment.findFirst({ where: { id: commentId, taskId, deletedAt: null } });
  if (!comment) {
    throw new AppError("Comment not found", 404);
  }
  const isAuthor = comment.authorMembershipId === callerMembershipId;
  const canModerate = roleHasPermission(callerRole, "comment:moderate");
  if (!isAuthor && !canModerate) {
    throw new AppError("You do not have permission to delete this comment", 403);
  }
  await prisma.comment.update({ where: { id: commentId }, data: { deletedAt: new Date() } });
}
