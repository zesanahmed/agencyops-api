import { AppError } from "../../errors/AppError.js";
import { prisma } from "../../lib/prisma.js";
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
): Promise<SafeSprint> {
  await getSprintOrThrow(organizationId, projectId, sprintId);
  const sprint = await prisma.sprint.update({ where: { id: sprintId }, data: input });
  return toSafeSprint(sprint);
}

export async function startSprint(organizationId: string, projectId: string, sprintId: string): Promise<SafeSprint> {
  const sprint = await getSprintOrThrow(organizationId, projectId, sprintId);
  if (sprint.status !== "PLANNED") {
    throw new AppError("Only a PLANNED sprint can be started", 409);
  }
  const updated = await prisma.sprint.update({ where: { id: sprintId }, data: { status: "ACTIVE" } });
  return toSafeSprint(updated);
}

export async function completeSprint(organizationId: string, projectId: string, sprintId: string): Promise<SafeSprint> {
  const sprint = await getSprintOrThrow(organizationId, projectId, sprintId);
  if (sprint.status !== "ACTIVE") {
    throw new AppError("Only an ACTIVE sprint can be completed", 409);
  }
  const updated = await prisma.sprint.update({ where: { id: sprintId }, data: { status: "COMPLETED" } });
  return toSafeSprint(updated);
}

/**
 * SprintStatus has no CANCELLED value in the schema — only
 * PLANNED/ACTIVE/COMPLETED — so "cancel" is implemented as an actual
 * delete, and only allowed while still PLANNED (never started), to
 * avoid destroying a sprint that real work has already happened in.
 * Tasks referencing this sprint are unassigned (sprintId set to
 * null), not deleted — see the schema's SetNull relation.
 */
export async function deleteSprint(organizationId: string, projectId: string, sprintId: string): Promise<void> {
  const sprint = await getSprintOrThrow(organizationId, projectId, sprintId);
  if (sprint.status !== "PLANNED") {
    throw new AppError("Only a PLANNED sprint can be deleted; completed/active sprints are kept for history", 409);
  }
  await prisma.sprint.delete({ where: { id: sprintId } });
}
