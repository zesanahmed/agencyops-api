import { AppError } from "../../errors/AppError.js";
import { prisma } from "../../lib/prisma.js";
import { notifyMemberships } from "../notification/notification.service.js";
import { roleHasPermission } from "../rbac/permissions.js";
import type { MembershipRole } from "../../generated/prisma/client.js";
import { loadMembershipUsers, memberRef, type MemberRef } from "../../lib/userInfo.js";
import { recordActivity } from "../activity/activity.service.js";
import type { Comment } from "../../generated/prisma/client.js";
import { toSafeComment, type SafeComment } from "./comment.mappers.js";

export type SafeCommentWithPeople = SafeComment & { author: MemberRef | null; mentions: MemberRef[] };

/** Adds author and mentioned people (user display info) to a batch of comments with 2 queries. */
async function withPeople(comments: Comment[]): Promise<SafeCommentWithPeople[]> {
  if (comments.length === 0) return [];
  const mentions = await prisma.commentMention.findMany({
    where: { commentId: { in: comments.map((c) => c.id) } },
    orderBy: { createdAt: "asc" },
    select: { commentId: true, membershipId: true },
  });
  const users = await loadMembershipUsers([...comments.map((c) => c.authorMembershipId), ...mentions.map((m) => m.membershipId)]);
  const byComment = new Map<string, MemberRef[]>();
  for (const m of mentions) {
    const ref = memberRef(users, m.membershipId);
    if (ref) byComment.set(m.commentId, [...(byComment.get(m.commentId) ?? []), ref]);
  }
  return comments.map((c) => ({
    ...toSafeComment(c),
    author: memberRef(users, c.authorMembershipId),
    mentions: byComment.get(c.id) ?? [],
  }));
}

async function assertMentionsValid(organizationId: string, mentionIds: string[]): Promise<void> {
  if (mentionIds.length === 0) return;
  const validCount = await prisma.membership.count({
    where: { id: { in: mentionIds }, organizationId, status: "ACTIVE" },
  });
  if (validCount !== mentionIds.length) {
    throw new AppError("One or more mentioned members were not found in this organization", 404);
  }
}

async function notifyMentions(
  input: { organizationId: string; projectId: string; taskId: string; authorMembershipId: string },
  commentId: string,
  content: string,
  recipientIds: string[],
): Promise<void> {
  // Delivery (in-app + email, per preference) happens after the comment is committed;
  // you are not notified about mentioning yourself.
  await notifyMemberships({
    organizationId: input.organizationId,
    membershipIds: recipientIds.filter((id) => id !== input.authorMembershipId),
    type: "MENTION",
    title: "You were mentioned in a comment",
    message: content.slice(0, 200),
    data: { projectId: input.projectId, taskId: input.taskId, commentId },
  });
}

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
}): Promise<SafeCommentWithPeople> {
  await assertTaskInOrg(input.organizationId, input.projectId, input.taskId);

  const mentionIds = [...new Set(input.mentionedMembershipIds ?? [])];
  await assertMentionsValid(input.organizationId, mentionIds);

  const comment = await prisma.$transaction(async (tx) => {
    const txClient = tx as unknown as Pick<typeof prisma, "comment" | "commentMention">;

    const created = await txClient.comment.create({
      data: { taskId: input.taskId, authorMembershipId: input.authorMembershipId, content: input.content },
    });

    for (const membershipId of mentionIds) {
      await txClient.commentMention.create({ data: { commentId: created.id, membershipId } });
    }

    return created;
  });

  await notifyMentions(input, comment.id, input.content, mentionIds);
  const task = await prisma.task.findUnique({ where: { id: input.taskId }, select: { title: true } });
  await recordActivity({
    organizationId: input.organizationId,
    actorMembershipId: input.authorMembershipId,
    action: "comment.added",
    entityType: "Comment",
    entityId: comment.id,
    projectId: input.projectId,
    taskId: input.taskId,
    metadata: { title: task?.title ?? null },
  });

  const [full] = await withPeople([comment]);
  return full!;
}

export async function listComments(
  organizationId: string,
  projectId: string,
  taskId: string,
  page: number,
  limit: number,
): Promise<{ comments: SafeCommentWithPeople[]; pagination: { page: number; limit: number; total: number; totalPages: number } }> {
  await assertTaskInOrg(organizationId, projectId, taskId);
  const where = { taskId, deletedAt: null };
  const [comments, total] = await Promise.all([
    prisma.comment.findMany({ where, orderBy: { createdAt: "asc" }, skip: (page - 1) * limit, take: limit }),
    prisma.comment.count({ where }),
  ]);
  return {
    comments: await withPeople(comments),
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
  mentionedMembershipIds?: string[],
): Promise<SafeCommentWithPeople> {
  await assertTaskInOrg(organizationId, projectId, taskId);
  const comment = await prisma.comment.findFirst({ where: { id: commentId, taskId, deletedAt: null } });
  if (!comment) {
    throw new AppError("Comment not found", 404);
  }
  if (comment.authorMembershipId !== callerMembershipId) {
    throw new AppError("Only the comment's author can edit it", 403);
  }

  // When mentionedMembershipIds is sent it REPLACES the mention set; only people who were not
  // mentioned before are notified. When omitted, mentions are left untouched.
  const wanted = mentionedMembershipIds ? [...new Set(mentionedMembershipIds)] : undefined;
  if (wanted) await assertMentionsValid(organizationId, wanted);

  const newlyMentioned: string[] = [];
  const updated = await prisma.$transaction(async (tx) => {
    const saved = await tx.comment.update({ where: { id: commentId }, data: { content } });
    if (wanted) {
      const current = await tx.commentMention.findMany({ where: { commentId }, select: { membershipId: true } });
      const currentIds = new Set(current.map((m) => m.membershipId));
      const toAdd = wanted.filter((id) => !currentIds.has(id));
      const toRemove = [...currentIds].filter((id) => !wanted.includes(id));
      if (toRemove.length > 0) await tx.commentMention.deleteMany({ where: { commentId, membershipId: { in: toRemove } } });
      for (const membershipId of toAdd) await tx.commentMention.create({ data: { commentId, membershipId } });
      newlyMentioned.push(...toAdd);
    }
    return saved;
  });

  await notifyMentions(
    { organizationId, projectId, taskId, authorMembershipId: callerMembershipId },
    commentId,
    content,
    newlyMentioned,
  );
  const [full] = await withPeople([updated]);
  return full!;
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
