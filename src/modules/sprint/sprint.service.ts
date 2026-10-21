import { AppError } from "../../errors/AppError.js";
import { assertDateOrder, mergedDate } from "../../lib/dateRange.js";
import { prisma } from "../../lib/prisma.js";
import { recordActivity } from "../activity/activity.service.js";
import { notifyMemberships } from "../notification/notification.service.js";
import { getProjectMembershipIds } from "../project/project.access.js";
import { toSafeSprint, type SafeSprint } from "./sprint.mappers.js";

async function assertProjectInOrg(organizationId: string, projectId: string): Promise<void> {
  const project = await prisma.project.findFirst({
    where: { id: projectId, organizationId, deletedAt: null },
    select: { id: true },
  });
  if (!project) {
    throw new AppError("Project not found", 404);
  }
}

export async function createSprint(input: {
  organizationId: string;
  actorMembershipId: string;
  projectId: string;
  name: string;
  goal?: string | undefined;
  startDate: Date;
  endDate: Date;
}): Promise<SafeSprint> {
  await assertProjectInOrg(input.organizationId, input.projectId);
  const sprint = await prisma.sprint.create({
    data: {
      projectId: input.projectId,
      name: input.name,
      goal: input.goal ?? null,
      startDate: input.startDate,
      endDate: input.endDate,
    },
  });
  await recordActivity({
    organizationId: input.organizationId,
    actorMembershipId: input.actorMembershipId,
    action: "sprint.created",
    entityType: "Sprint",
    entityId: sprint.id,
    projectId: input.projectId,
    metadata: { title: sprint.name },
  });
  return toSafeSprint(sprint);
}

export async function listSprints(
  organizationId: string,
  projectId: string,
  page: number,
  limit: number,
): Promise<{ sprints: SafeSprint[]; pagination: { page: number; limit: number; total: number; totalPages: number } }> {
  await assertProjectInOrg(organizationId, projectId);
  const where = { projectId };
  const [sprints, total] = await Promise.all([
    prisma.sprint.findMany({ where, orderBy: { startDate: "desc" }, skip: (page - 1) * limit, take: limit }),
    prisma.sprint.count({ where }),
  ]);
  return { sprints: sprints.map(toSafeSprint), pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } };
}

async function getSprintOrThrow(organizationId: string, projectId: string, sprintId: string) {
  await assertProjectInOrg(organizationId, projectId);
  const sprint = await prisma.sprint.findFirst({ where: { id: sprintId, projectId } });
  if (!sprint) {
    throw new AppError("Sprint not found", 404);
  }
  return sprint;
}

export async function getSprint(organizationId: string, projectId: string, sprintId: string): Promise<SafeSprint> {
  const sprint = await getSprintOrThrow(organizationId, projectId, sprintId);
  return toSafeSprint(sprint);
}

export async function updateSprint(
  organizationId: string,
  projectId: string,
  sprintId: string,
  input: Record<string, unknown>,
  actorMembershipId: string,
): Promise<SafeSprint> {
  const existing = await getSprintOrThrow(organizationId, projectId, sprintId);
  assertDateOrder(
    mergedDate(input, "startDate", existing.startDate),
    mergedDate(input, "endDate", existing.endDate),
    "endDate",
  );
  const sprint = await prisma.sprint.update({ where: { id: sprintId }, data: input });
  await recordActivity({
    organizationId,
    actorMembershipId,
    action: "sprint.updated",
    entityType: "Sprint",
    entityId: sprintId,
    projectId,
    metadata: { title: sprint.name },
  });
  return toSafeSprint(sprint);
}

export async function startSprint(
  organizationId: string,
  projectId: string,
  sprintId: string,
  actorMembershipId: string,
): Promise<SafeSprint> {
  const sprint = await getSprintOrThrow(organizationId, projectId, sprintId);
  if (sprint.status !== "PLANNED") {
    throw new AppError("Only a PLANNED sprint can be started", 409);
  }
  const updated = await prisma.sprint.update({ where: { id: sprintId }, data: { status: "ACTIVE" } });
  await recordActivity({
    organizationId,
    actorMembershipId,
    action: "sprint.started",
    entityType: "Sprint",
    entityId: sprintId,
    projectId,
    metadata: { title: updated.name },
  });
  await notifySprintStarted(organizationId, projectId, updated.id, updated.name, actorMembershipId);
  return toSafeSprint(updated);
}

/** Tells everyone working in the project (members + assignees in this sprint), except whoever started it. */
async function notifySprintStarted(
  organizationId: string,
  projectId: string,
  sprintId: string,
  sprintName: string,
  actorMembershipId: string,
): Promise<void> {
  const [project, members, assignees] = await Promise.all([
    prisma.project.findUnique({ where: { id: projectId }, select: { name: true } }),
    getProjectMembershipIds([projectId]),
    prisma.task.findMany({
      where: { sprintId, deletedAt: null, assigneeMembershipId: { not: null } },
      select: { assigneeMembershipId: true },
      distinct: ["assigneeMembershipId"],
    }),
  ]);
  const recipients = new Set<string>(members.get(projectId) ?? []);
  for (const a of assignees) if (a.assigneeMembershipId) recipients.add(a.assigneeMembershipId);
  recipients.delete(actorMembershipId);

  await notifyMemberships({
    organizationId,
    membershipIds: [...recipients],
    type: "SPRINT_STARTED",
    title: "Sprint started",
    message: `Sprint “${sprintName}” in “${project?.name ?? "your project"}” has started`,
    data: { projectId, sprintId },
  });
}

export async function completeSprint(
  organizationId: string,
  projectId: string,
  sprintId: string,
  actorMembershipId: string,
  moveOpenTasksTo?: string,
): Promise<{ sprint: SafeSprint; movedTaskCount: number }> {
  const sprint = await getSprintOrThrow(organizationId, projectId, sprintId);
  if (sprint.status !== "ACTIVE") {
    throw new AppError("Only an ACTIVE sprint can be completed", 409);
  }

  // Validate the target BEFORE changing anything.
  let targetSprintId: string | null | undefined; // undefined = leave open tasks where they are
  if (moveOpenTasksTo === "BACKLOG") {
    targetSprintId = null;
  } else if (moveOpenTasksTo) {
    const target = await prisma.sprint.findFirst({ where: { id: moveOpenTasksTo, projectId } });
    if (!target) throw new AppError("Target sprint not found in this project", 404);
    if (target.id === sprintId) throw new AppError("Cannot move open tasks into the sprint being completed", 400);
    if (target.status === "COMPLETED") throw new AppError("Cannot move open tasks into a completed sprint", 409);
    targetSprintId = target.id;
  }

  const { updated, movedTaskCount } = await prisma.$transaction(async (tx) => {
    const done = await tx.sprint.update({ where: { id: sprintId }, data: { status: "COMPLETED" } });
    // "Open" = any task (including subtasks) in this sprint that is not DONE.
    const moved =
      targetSprintId === undefined
        ? { count: 0 }
        : await tx.task.updateMany({
            where: { sprintId, deletedAt: null, status: { not: "DONE" } },
            data: { sprintId: targetSprintId },
          });
    return { updated: done, movedTaskCount: moved.count };
  });

  await recordActivity({
    organizationId,
    actorMembershipId,
    action: "sprint.completed",
    entityType: "Sprint",
    entityId: sprintId,
    projectId,
    metadata: { title: updated.name, movedTaskCount },
  });
  return { sprint: toSafeSprint(updated), movedTaskCount };
}

/**
 * SprintStatus has no CANCELLED value in the schema — only
 * PLANNED/ACTIVE/COMPLETED — so "cancel" is implemented as an actual
 * delete, and only allowed while still PLANNED (never started), to
 * avoid destroying a sprint that real work has already happened in.
 * Tasks referencing this sprint are unassigned (sprintId set to
 * null), not deleted — see the schema's SetNull relation.
 */
export async function deleteSprint(
  organizationId: string,
  projectId: string,
  sprintId: string,
  actorMembershipId: string,
): Promise<void> {
  const sprint = await getSprintOrThrow(organizationId, projectId, sprintId);
  if (sprint.status !== "PLANNED") {
    throw new AppError("Only a PLANNED sprint can be deleted; completed/active sprints are kept for history", 409);
  }
  await prisma.sprint.delete({ where: { id: sprintId } });
  await recordActivity({
    organizationId,
    actorMembershipId,
    action: "sprint.deleted",
    entityType: "Sprint",
    entityId: sprintId,
    projectId,
    metadata: { title: sprint.name },
  });
}
