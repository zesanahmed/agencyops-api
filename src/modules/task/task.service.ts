import { AppError } from "../../errors/AppError.js";
import { assertDateOrder, mergedDate } from "../../lib/dateRange.js";
import { prisma } from "../../lib/prisma.js";
import { loadMembershipUsers, memberRef, type MemberRef, type UserInfo } from "../../lib/userInfo.js";
import { recordActivity } from "../activity/activity.service.js";
import { notifyMemberships } from "../notification/notification.service.js";
import type { Task } from "../../generated/prisma/client.js";
import { toSafeTask, toSafeTaskCollaborator, type SafeTask, type SafeTaskCollaborator } from "./task.mappers.js";
import type { TaskListQuery } from "./task.validation.js";

function stripUndefined<T extends Record<string, unknown>>(obj: T): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) out[k] = v;
  }
  return out;
}

export type TaskExtras = {
  assignee: MemberRef | null;
  subtaskCount: number;
  doneSubtaskCount: number;
  commentCount: number;
};
export type SafeTaskWithExtras = SafeTask & TaskExtras;

/** Adds assignee user info and counts for a batch of tasks using grouped queries (no N+1). */
async function withExtras(tasks: Task[]): Promise<SafeTaskWithExtras[]> {
  if (tasks.length === 0) return [];
  const ids = tasks.map((t) => t.id);
  const [users, subtasks, comments] = await Promise.all([
    loadMembershipUsers(tasks.map((t) => t.assigneeMembershipId)),
    prisma.task.groupBy({
      by: ["parentTaskId", "status"],
      where: { parentTaskId: { in: ids }, deletedAt: null },
      _count: { _all: true },
    }),
    prisma.comment.groupBy({
      by: ["taskId"],
      where: { taskId: { in: ids }, deletedAt: null },
      _count: { _all: true },
    }),
  ]);
  const subtaskTotals = new Map<string, { total: number; done: number }>();
  for (const row of subtasks) {
    if (!row.parentTaskId) continue;
    const entry = subtaskTotals.get(row.parentTaskId) ?? { total: 0, done: 0 };
    entry.total += row._count._all;
    if (row.status === "DONE") entry.done += row._count._all;
    subtaskTotals.set(row.parentTaskId, entry);
  }
  const commentTotals = new Map(comments.map((c) => [c.taskId, c._count._all]));

  return tasks.map((task) => ({
    ...toSafeTask(task),
    assignee: memberRef(users, task.assigneeMembershipId),
    subtaskCount: subtaskTotals.get(task.id)?.total ?? 0,
    doneSubtaskCount: subtaskTotals.get(task.id)?.done ?? 0,
    commentCount: commentTotals.get(task.id) ?? 0,
  }));
}

async function withExtrasOne(task: Task): Promise<SafeTaskWithExtras> {
  const [one] = await withExtras([task]);
  return one!;
}

const sameValue = (a: unknown, b: unknown): boolean => {
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
  return (a ?? null) === (b ?? null);
};

/** In-app (and email, per preference) notification for a newly assigned person; never the actor. */
async function notifyAssigned(
  organizationId: string,
  actorMembershipId: string,
  task: { id: string; projectId: string; title: string },
  assigneeMembershipId: string | null,
): Promise<void> {
  if (!assigneeMembershipId || assigneeMembershipId === actorMembershipId) return;
  await notifyMemberships({
    organizationId,
    membershipIds: [assigneeMembershipId],
    type: "TASK_ASSIGNED",
    title: "You were assigned a task",
    message: `“${task.title}” was assigned to you`,
    data: { projectId: task.projectId, taskId: task.id },
  });
}

async function assertProjectInOrg(organizationId: string, projectId: string): Promise<void> {
  const project = await prisma.project.findFirst({
    where: { id: projectId, organizationId, deletedAt: null },
    select: { id: true },
  });
  if (!project) {
    throw new AppError("Project not found", 404);
  }
}

async function assertMembershipInOrg(organizationId: string, membershipId: string): Promise<void> {
  const membership = await prisma.membership.findFirst({
    where: { id: membershipId, organizationId, status: "ACTIVE" },
    select: { id: true },
  });
  if (!membership) {
    throw new AppError("Membership not found in this organization", 404);
  }
}

async function assertSprintInProject(projectId: string, sprintId: string): Promise<void> {
  const sprint = await prisma.sprint.findFirst({ where: { id: sprintId, projectId }, select: { id: true } });
  if (!sprint) {
    throw new AppError("Sprint not found in this project", 404);
  }
}

interface TaskWriteInput {
  organizationId: string;
  projectId: string;
  sprintId?: string | null | undefined;
  assigneeMembershipId?: string | null | undefined;
}

async function validateTaskRefs(input: TaskWriteInput): Promise<void> {
  if (input.sprintId) {
    await assertSprintInProject(input.projectId, input.sprintId);
  }
  if (input.assigneeMembershipId) {
    await assertMembershipInOrg(input.organizationId, input.assigneeMembershipId);
  }
}

export async function createTask(input: {
  organizationId: string;
  actorMembershipId: string;
  projectId: string;
  title: string;
  description?: string | undefined;
  sprintId?: string | undefined;
  assigneeMembershipId?: string | undefined;
  status?: import("../../generated/prisma/client.js").TaskStatus | undefined;
  priority?: import("../../generated/prisma/client.js").TaskPriority | undefined;
  startDate?: Date | null | undefined;
  dueDate?: Date | null | undefined;
}): Promise<SafeTaskWithExtras> {
  await assertProjectInOrg(input.organizationId, input.projectId);
  await validateTaskRefs(input);

  const task = await prisma.task.create({
    data: {
      projectId: input.projectId,
      title: input.title,
      description: input.description ?? null,
      sprintId: input.sprintId ?? null,
      assigneeMembershipId: input.assigneeMembershipId ?? null,
      status: input.status ?? "BACKLOG",
      priority: input.priority ?? "MEDIUM",
      startDate: input.startDate ?? null,
      dueDate: input.dueDate ?? null,
    },
  });
  await recordActivity({
    organizationId: input.organizationId,
    actorMembershipId: input.actorMembershipId,
    action: "task.created",
    entityType: "Task",
    entityId: task.id,
    projectId: task.projectId,
    taskId: task.id,
    metadata: { title: task.title },
  });
  await notifyAssigned(input.organizationId, input.actorMembershipId, task, task.assigneeMembershipId);
  return withExtrasOne(task);
}

export async function listTasks(
  organizationId: string,
  projectId: string,
  query: TaskListQuery,
): Promise<{ tasks: SafeTaskWithExtras[]; pagination: { page: number; limit: number; total: number; totalPages: number } }> {
  await assertProjectInOrg(organizationId, projectId);

  const where: Record<string, unknown> = { projectId, parentTaskId: null, deletedAt: null };
  if (query.status) where.status = query.status;
  if (query.priority) where.priority = query.priority;
  if (query.sprintId) where.sprintId = query.sprintId === "none" ? null : query.sprintId;
  if (query.assigneeMembershipId) where.assigneeMembershipId = query.assigneeMembershipId;
  if (query.search) where.title = { contains: query.search, mode: "insensitive" };

  const [tasks, total] = await Promise.all([
    prisma.task.findMany({
      where,
      orderBy: { [query.sortBy]: query.sortOrder },
      skip: (query.page - 1) * query.limit,
      take: query.limit,
    }),
    prisma.task.count({ where }),
  ]);

  return {
    tasks: await withExtras(tasks),
    pagination: { page: query.page, limit: query.limit, total, totalPages: Math.ceil(total / query.limit) },
  };
}

async function getTaskOrThrow(organizationId: string, projectId: string, taskId: string) {
  await assertProjectInOrg(organizationId, projectId);
  const task = await prisma.task.findFirst({ where: { id: taskId, projectId, deletedAt: null } });
  if (!task) {
    throw new AppError("Task not found", 404);
  }
  return task;
}

export async function getTask(organizationId: string, projectId: string, taskId: string): Promise<SafeTaskWithExtras> {
  const task = await getTaskOrThrow(organizationId, projectId, taskId);
  return withExtrasOne(task);
}

export async function updateTask(
  organizationId: string,
  projectId: string,
  taskId: string,
  input: Record<string, unknown> & { sprintId?: string | null | undefined; assigneeMembershipId?: string | null | undefined },
  actorMembershipId: string,
): Promise<SafeTaskWithExtras> {
  const existing = await getTaskOrThrow(organizationId, projectId, taskId);
  assertDateOrder(
    mergedDate(input, "startDate", existing.startDate),
    mergedDate(input, "dueDate", existing.dueDate),
    "dueDate",
  );
  await validateTaskRefs({
    organizationId,
    projectId,
    sprintId: input.sprintId,
    assigneeMembershipId: input.assigneeMembershipId,
  });
  const task = await prisma.task.update({ where: { id: taskId }, data: stripUndefined(input) });
  await afterTaskUpdate(organizationId, actorMembershipId, existing, task, input);
  return withExtrasOne(task);
}

/** Activity entries and notifications for what actually changed (values equal to the stored ones are ignored). */
async function afterTaskUpdate(
  organizationId: string,
  actorMembershipId: string,
  before: Task,
  after: Task,
  input: Record<string, unknown>,
): Promise<void> {
  const record = (action: "task.updated" | "task.status_changed" | "task.assigned", metadata: Record<string, string | null>) =>
    recordActivity({
      organizationId,
      actorMembershipId,
      action,
      entityType: "Task",
      entityId: after.id,
      projectId: after.projectId,
      taskId: after.id,
      metadata: { title: after.title, ...metadata },
    });

  const statusChanged = before.status !== after.status;
  const assigneeChanged = before.assigneeMembershipId !== after.assigneeMembershipId;
  const otherChanged = ["title", "description", "priority", "sprintId", "startDate", "dueDate"].some(
    (key) => input[key] !== undefined && !sameValue(input[key], (before as Record<string, unknown>)[key]),
  );

  if (statusChanged) await record("task.status_changed", { from: before.status, to: after.status });
  if (assigneeChanged) await record("task.assigned", { assigneeMembershipId: after.assigneeMembershipId });
  if (otherChanged) await record("task.updated", {});

  if (assigneeChanged) await notifyAssigned(organizationId, actorMembershipId, after, after.assigneeMembershipId);
  if (statusChanged) {
    const collaborators = await prisma.taskCollaborator.findMany({ where: { taskId: after.id }, select: { membershipId: true } });
    const recipients = new Set<string>(collaborators.map((c) => c.membershipId));
    if (after.assigneeMembershipId) recipients.add(after.assigneeMembershipId);
    // The actor already knows, and a brand-new assignee got TASK_ASSIGNED for this same save.
    recipients.delete(actorMembershipId);
    if (assigneeChanged && after.assigneeMembershipId) recipients.delete(after.assigneeMembershipId);
    await notifyMemberships({
      organizationId,
      membershipIds: [...recipients],
      type: "TASK_STATUS_CHANGED",
      title: "Task status changed",
      message: `“${after.title}” moved from ${before.status} to ${after.status}`,
      data: { projectId: after.projectId, taskId: after.id, from: before.status, to: after.status },
    });
  }
}

export async function deleteTask(
  organizationId: string,
  projectId: string,
  taskId: string,
  actorMembershipId: string,
): Promise<void> {
  const task = await getTaskOrThrow(organizationId, projectId, taskId);
  await prisma.task.update({ where: { id: taskId }, data: { deletedAt: new Date() } });
  await recordActivity({
    organizationId,
    actorMembershipId,
    action: "task.deleted",
    entityType: "Task",
    entityId: taskId,
    projectId,
    taskId,
    metadata: { title: task.title },
  });
}

/**
 * Enforces the one-level subtask rule: the parent must not itself
 * already be a subtask (have its own parentTaskId).
 */
export async function createSubtask(
  organizationId: string,
  projectId: string,
  parentTaskId: string,
  actorMembershipId: string,
  input: {
    title: string;
    description?: string | undefined;
    assigneeMembershipId?: string | undefined;
    status?: import("../../generated/prisma/client.js").TaskStatus | undefined;
    priority?: import("../../generated/prisma/client.js").TaskPriority | undefined;
  },
): Promise<SafeTaskWithExtras> {
  const parent = await getTaskOrThrow(organizationId, projectId, parentTaskId);
  if (parent.parentTaskId !== null) {
    throw new AppError("Subtasks cannot themselves have subtasks (one level only)", 409);
  }
  if (input.assigneeMembershipId) {
    await assertMembershipInOrg(organizationId, input.assigneeMembershipId);
  }

  const subtask = await prisma.task.create({
    data: {
      projectId,
      parentTaskId,
      sprintId: parent.sprintId,
      title: input.title,
      description: input.description ?? null,
      assigneeMembershipId: input.assigneeMembershipId ?? null,
      status: input.status ?? "BACKLOG",
      priority: input.priority ?? "MEDIUM",
    },
  });
  await recordActivity({
    organizationId,
    actorMembershipId,
    action: "task.created",
    entityType: "Task",
    entityId: subtask.id,
    projectId,
    taskId: subtask.id,
    metadata: { title: subtask.title, parentTaskId: parentTaskId },
  });
  await notifyAssigned(organizationId, actorMembershipId, subtask, subtask.assigneeMembershipId);
  return withExtrasOne(subtask);
}

export async function listSubtasks(organizationId: string, projectId: string, taskId: string): Promise<SafeTaskWithExtras[]> {
  await getTaskOrThrow(organizationId, projectId, taskId);
  const subtasks = await prisma.task.findMany({ where: { parentTaskId: taskId, deletedAt: null }, orderBy: { createdAt: "asc" } });
  return withExtras(subtasks);
}

export async function addCollaborator(
  organizationId: string,
  projectId: string,
  taskId: string,
  membershipId: string,
): Promise<SafeTaskCollaborator & { user: UserInfo }> {
  await getTaskOrThrow(organizationId, projectId, taskId);
  await assertMembershipInOrg(organizationId, membershipId);

  const existing = await prisma.taskCollaborator.findFirst({ where: { taskId, membershipId } });
  if (existing) {
    throw new AppError("This member is already a collaborator on the task", 409);
  }
  const tc = await prisma.taskCollaborator.create({ data: { taskId, membershipId } });
  const users = await loadMembershipUsers([membershipId]);
  return { ...toSafeTaskCollaborator(tc), user: users.get(membershipId)! };
}

export async function removeCollaborator(
  organizationId: string,
  projectId: string,
  taskId: string,
  taskCollaboratorId: string,
): Promise<void> {
  await getTaskOrThrow(organizationId, projectId, taskId);
  const tc = await prisma.taskCollaborator.findFirst({ where: { id: taskCollaboratorId, taskId } });
  if (!tc) {
    throw new AppError("Task collaborator not found", 404);
  }
  await prisma.taskCollaborator.delete({ where: { id: taskCollaboratorId } });
}

export async function listCollaborators(
  organizationId: string,
  projectId: string,
  taskId: string,
): Promise<(SafeTaskCollaborator & { user: UserInfo })[]> {
  await getTaskOrThrow(organizationId, projectId, taskId);
  const rows = await prisma.taskCollaborator.findMany({ where: { taskId }, orderBy: { createdAt: "asc" } });
  const users = await loadMembershipUsers(rows.map((r) => r.membershipId));
  return rows.flatMap((row) => {
    const user = users.get(row.membershipId);
    return user ? [{ ...toSafeTaskCollaborator(row), user }] : [];
  });
}
