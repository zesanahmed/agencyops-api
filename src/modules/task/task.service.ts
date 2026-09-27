import { AppError } from "../../errors/AppError.js";
import { prisma } from "../../lib/prisma.js";
import { toSafeTask, toSafeTaskCollaborator, type SafeTask, type SafeTaskCollaborator } from "./task.mappers.js";
import type { TaskListQuery } from "./task.validation.js";

function stripUndefined<T extends Record<string, unknown>>(obj: T): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) out[k] = v;
  }
  return out;
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
  projectId: string;
  title: string;
  description?: string | undefined;
  sprintId?: string | undefined;
  assigneeMembershipId?: string | undefined;
  status?: import("../../generated/prisma/client.js").TaskStatus | undefined;
  priority?: import("../../generated/prisma/client.js").TaskPriority | undefined;
  startDate?: Date | undefined;
  dueDate?: Date | undefined;
}): Promise<SafeTask> {
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
  return toSafeTask(task);
}

export async function listTasks(
  organizationId: string,
  projectId: string,
  query: TaskListQuery,
): Promise<{ tasks: SafeTask[]; pagination: { page: number; limit: number; total: number; totalPages: number } }> {
  await assertProjectInOrg(organizationId, projectId);

  const where: Record<string, unknown> = { projectId, parentTaskId: null, deletedAt: null };
  if (query.status) where.status = query.status;
  if (query.priority) where.priority = query.priority;
  if (query.sprintId) where.sprintId = query.sprintId;
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
    tasks: tasks.map(toSafeTask),
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

export async function getTask(organizationId: string, projectId: string, taskId: string): Promise<SafeTask> {
  const task = await getTaskOrThrow(organizationId, projectId, taskId);
  return toSafeTask(task);
}

export async function updateTask(
  organizationId: string,
  projectId: string,
  taskId: string,
  input: Record<string, unknown> & { sprintId?: string | null | undefined; assigneeMembershipId?: string | null | undefined },
): Promise<SafeTask> {
  await getTaskOrThrow(organizationId, projectId, taskId);
  await validateTaskRefs({
    organizationId,
    projectId,
    sprintId: input.sprintId,
    assigneeMembershipId: input.assigneeMembershipId,
  });
  const task = await prisma.task.update({ where: { id: taskId }, data: stripUndefined(input) });
  return toSafeTask(task);
}

export async function deleteTask(organizationId: string, projectId: string, taskId: string): Promise<void> {
  await getTaskOrThrow(organizationId, projectId, taskId);
  await prisma.task.update({ where: { id: taskId }, data: { deletedAt: new Date() } });
}

/**
 * Enforces the one-level subtask rule: the parent must not itself
 * already be a subtask (have its own parentTaskId).
 */
export async function createSubtask(
  organizationId: string,
  projectId: string,
  parentTaskId: string,
  input: {
    title: string;
    description?: string | undefined;
    assigneeMembershipId?: string | undefined;
    status?: import("../../generated/prisma/client.js").TaskStatus | undefined;
    priority?: import("../../generated/prisma/client.js").TaskPriority | undefined;
  },
): Promise<SafeTask> {
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
  return toSafeTask(subtask);
}

export async function listSubtasks(organizationId: string, projectId: string, taskId: string): Promise<SafeTask[]> {
  await getTaskOrThrow(organizationId, projectId, taskId);
  const subtasks = await prisma.task.findMany({ where: { parentTaskId: taskId, deletedAt: null }, orderBy: { createdAt: "asc" } });
  return subtasks.map(toSafeTask);
}

export async function addCollaborator(
  organizationId: string,
  projectId: string,
  taskId: string,
  membershipId: string,
): Promise<SafeTaskCollaborator> {
  await getTaskOrThrow(organizationId, projectId, taskId);
  await assertMembershipInOrg(organizationId, membershipId);

  const existing = await prisma.taskCollaborator.findFirst({ where: { taskId, membershipId } });
  if (existing) {
    throw new AppError("This member is already a collaborator on the task", 409);
  }
  const tc = await prisma.taskCollaborator.create({ data: { taskId, membershipId } });
  return toSafeTaskCollaborator(tc);
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
): Promise<SafeTaskCollaborator[]> {
  await getTaskOrThrow(organizationId, projectId, taskId);
  const rows = await prisma.taskCollaborator.findMany({ where: { taskId } });
  return rows.map(toSafeTaskCollaborator);
}
