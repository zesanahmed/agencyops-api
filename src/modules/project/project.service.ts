import { AppError } from "../../errors/AppError.js";
import { assertDateOrder, mergedDate } from "../../lib/dateRange.js";
import { prisma } from "../../lib/prisma.js";
import { loadMembershipUsers, type UserInfo } from "../../lib/userInfo.js";
import { recordActivity } from "../activity/activity.service.js";
import { getProjectMembershipIds } from "./project.access.js";
import type { Project, TaskStatus } from "../../generated/prisma/client.js";
import {
  toSafeProject,
  toSafeProjectMember,
  toSafeProjectTeam,
  type SafeProject,
  type SafeProjectMember,
  type SafeProjectTeam,
} from "./project.mappers.js";
import type { ProjectListQuery } from "./project.validation.js";

export type TaskCounts = Record<TaskStatus, number>;
export type ProjectStats = {
  /** Top-level (non-subtask), non-deleted tasks per status. */
  taskCounts: TaskCounts;
  /** Distinct active members: explicit project members plus members of assigned teams. */
  memberCount: number;
  activeSprint: { id: string; name: string } | null;
};
export type SafeProjectWithStats = SafeProject & ProjectStats;

/** Grouped queries for a whole page of projects at once — never one query per project. */
async function loadProjectStats(projectIds: string[]): Promise<Map<string, ProjectStats>> {
  const stats = new Map<string, ProjectStats>(
    projectIds.map((id) => [
      id,
      { taskCounts: { BACKLOG: 0, TODO: 0, IN_PROGRESS: 0, IN_REVIEW: 0, DONE: 0 }, memberCount: 0, activeSprint: null },
    ]),
  );
  if (projectIds.length === 0) return stats;

  const [counts, sprints, members] = await Promise.all([
    prisma.task.groupBy({
      by: ["projectId", "status"],
      where: { projectId: { in: projectIds }, parentTaskId: null, deletedAt: null },
      _count: { _all: true },
    }),
    prisma.sprint.findMany({
      where: { projectId: { in: projectIds }, status: "ACTIVE" },
      orderBy: { startDate: "desc" },
      select: { id: true, name: true, projectId: true },
    }),
    getProjectMembershipIds(projectIds),
  ]);
  for (const row of counts) {
    const entry = stats.get(row.projectId);
    if (entry) entry.taskCounts[row.status] = row._count._all;
  }
  for (const sprint of sprints) {
    const entry = stats.get(sprint.projectId);
    if (entry && !entry.activeSprint) entry.activeSprint = { id: sprint.id, name: sprint.name };
  }
  for (const [projectId, ids] of members) {
    const entry = stats.get(projectId);
    if (entry) entry.memberCount = ids.size;
  }
  return stats;
}

async function withStats(projects: Project[]): Promise<SafeProjectWithStats[]> {
  const stats = await loadProjectStats(projects.map((p) => p.id));
  return projects.map((p) => ({ ...toSafeProject(p), ...stats.get(p.id)! }));
}


function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 100);
}

/**
 * `field` says what the caller supplied: "slug" when they sent one explicitly, "name" when the
 * slug was derived from the name (so the frontend can put the error under the Name input).
 */
async function assertSlugAvailable(
  organizationId: string,
  slug: string,
  excludeProjectId?: string,
  field: "name" | "slug" = "slug",
) {
  const existing = await prisma.project.findFirst({
    where: excludeProjectId
      ? { organizationId, slug, id: { not: excludeProjectId } }
      : { organizationId, slug },
    select: { id: true },
  });
  if (existing) {
    const message = `A project with this ${field} already exists`;
    throw new AppError(message, 409, [{ path: field, message }]);
  }
}

export async function createProject(input: {
  organizationId: string;
  actorMembershipId: string;
  name: string;
  slug?: string | undefined;
  description?: string | undefined;
  status?: import("../../generated/prisma/client.js").ProjectStatus | undefined;
  startDate?: Date | null | undefined;
  dueDate?: Date | null | undefined;
}): Promise<SafeProject> {
  const slug = input.slug || slugify(input.name);
  if (!slug) {
    throw new AppError("Could not derive a valid slug from the project name; provide one explicitly", 400);
  }
  await assertSlugAvailable(input.organizationId, slug, undefined, input.slug ? "slug" : "name");

  const project = await prisma.project.create({
    data: {
      organizationId: input.organizationId,
      name: input.name,
      slug,
      description: input.description ?? null,
      status: input.status ?? "PLANNING",
      startDate: input.startDate ?? null,
      dueDate: input.dueDate ?? null,
    },
  });
  await recordActivity({
    organizationId: input.organizationId,
    actorMembershipId: input.actorMembershipId,
    action: "project.created",
    entityType: "Project",
    entityId: project.id,
    projectId: project.id,
    metadata: { title: project.name },
  });
  return toSafeProject(project);
}

export async function listProjects(
  organizationId: string,
  query: ProjectListQuery,
): Promise<{ projects: SafeProjectWithStats[]; pagination: { page: number; limit: number; total: number; totalPages: number } }> {
  const where: Record<string, unknown> = { organizationId, deletedAt: null };
  if (query.status) where.status = query.status;
  if (query.search) where.name = { contains: query.search, mode: "insensitive" };

  const [projects, total] = await Promise.all([
    prisma.project.findMany({
      where,
      orderBy: { [query.sortBy]: query.sortOrder },
      skip: (query.page - 1) * query.limit,
      take: query.limit,
    }),
    prisma.project.count({ where }),
  ]);

  return {
    projects: await withStats(projects),
    pagination: { page: query.page, limit: query.limit, total, totalPages: Math.ceil(total / query.limit) },
  };
}

async function getProjectRow(organizationId: string, projectId: string): Promise<Project> {
  const project = await prisma.project.findFirst({ where: { id: projectId, organizationId, deletedAt: null } });
  if (!project) {
    throw new AppError("Project not found", 404);
  }
  return project;
}

/** Existence/tenancy check used by the sub-resource functions below. */
export async function getProject(organizationId: string, projectId: string): Promise<SafeProject> {
  return toSafeProject(await getProjectRow(organizationId, projectId));
}

/** Project detail including the aggregates (task counts, member count, active sprint). */
export async function getProjectDetail(organizationId: string, projectId: string): Promise<SafeProjectWithStats> {
  const [detail] = await withStats([await getProjectRow(organizationId, projectId)]);
  return detail!;
}

export async function updateProject(
  organizationId: string,
  projectId: string,
  input: Record<string, unknown>,
  actorMembershipId: string,
): Promise<SafeProject> {
  const existing = await prisma.project.findFirst({
    where: { id: projectId, organizationId, deletedAt: null },
    select: { startDate: true, dueDate: true },
  });
  if (!existing) {
    throw new AppError("Project not found", 404);
  }
  assertDateOrder(
    mergedDate(input, "startDate", existing.startDate),
    mergedDate(input, "dueDate", existing.dueDate),
    "dueDate",
  );
  if (typeof input.slug === "string") {
    await assertSlugAvailable(organizationId, input.slug, projectId);
  }
  const project = await prisma.project.update({ where: { id: projectId }, data: input });
  await recordActivity({
    organizationId,
    actorMembershipId,
    action: "project.updated",
    entityType: "Project",
    entityId: projectId,
    projectId,
    metadata: { title: project.name },
  });
  return toSafeProject(project);
}

export async function deleteProject(
  organizationId: string,
  projectId: string,
  actorMembershipId: string,
): Promise<void> {
  const project = await getProjectRow(organizationId, projectId);
  await prisma.project.update({ where: { id: projectId }, data: { deletedAt: new Date() } });
  await recordActivity({
    organizationId,
    actorMembershipId,
    action: "project.deleted",
    entityType: "Project",
    entityId: projectId,
    projectId,
    metadata: { title: project.name },
  });
}

export async function assignTeam(
  organizationId: string,
  projectId: string,
  teamId: string,
): Promise<SafeProjectTeam & { team: { id: string; name: string } }> {
  await getProject(organizationId, projectId);
  const team = await prisma.team.findFirst({ where: { id: teamId, organizationId, deletedAt: null } });
  if (!team) {
    throw new AppError("Team not found in this organization", 404);
  }
  const existing = await prisma.projectTeam.findFirst({ where: { projectId, teamId } });
  if (existing) {
    throw new AppError("This team is already assigned to the project", 409);
  }
  const pt = await prisma.projectTeam.create({ data: { projectId, teamId } });
  return { ...toSafeProjectTeam(pt), team: { id: team.id, name: team.name } };
}

export async function unassignTeam(
  organizationId: string,
  projectId: string,
  projectTeamId: string,
): Promise<void> {
  await getProject(organizationId, projectId);
  const pt = await prisma.projectTeam.findFirst({ where: { id: projectTeamId, projectId } });
  if (!pt) {
    throw new AppError("Project-team assignment not found", 404);
  }
  await prisma.projectTeam.delete({ where: { id: projectTeamId } });
}

export async function listProjectTeams(
  organizationId: string,
  projectId: string,
): Promise<(SafeProjectTeam & { team: { id: string; name: string } })[]> {
  await getProject(organizationId, projectId);
  const rows = await prisma.projectTeam.findMany({
    where: { projectId },
    include: { team: { select: { id: true, name: true } } },
  });
  return rows.map((row) => ({ ...toSafeProjectTeam(row), team: row.team }));
}

export async function addProjectMember(
  organizationId: string,
  projectId: string,
  membershipId: string,
): Promise<SafeProjectMember & { user: UserInfo }> {
  await getProject(organizationId, projectId);
  const membership = await prisma.membership.findFirst({
    where: { id: membershipId, organizationId, status: "ACTIVE" },
  });
  if (!membership) {
    throw new AppError("Membership not found in this organization", 404);
  }
  const existing = await prisma.projectMember.findFirst({ where: { projectId, membershipId } });
  if (existing) {
    throw new AppError("This member is already on the project", 409);
  }
  const pm = await prisma.projectMember.create({ data: { projectId, membershipId } });
  const users = await loadMembershipUsers([membershipId]);
  return { ...toSafeProjectMember(pm), user: users.get(membershipId)! };
}

export async function removeProjectMember(
  organizationId: string,
  projectId: string,
  projectMemberId: string,
): Promise<void> {
  await getProject(organizationId, projectId);
  const pm = await prisma.projectMember.findFirst({ where: { id: projectMemberId, projectId } });
  if (!pm) {
    throw new AppError("Project member not found", 404);
  }
  await prisma.projectMember.delete({ where: { id: projectMemberId } });
}

export async function listProjectMembers(
  organizationId: string,
  projectId: string,
): Promise<(SafeProjectMember & { user: UserInfo })[]> {
  await getProject(organizationId, projectId);
  const rows = await prisma.projectMember.findMany({ where: { projectId }, orderBy: { createdAt: "asc" } });
  const users = await loadMembershipUsers(rows.map((r) => r.membershipId));
  return rows.flatMap((row) => {
    const user = users.get(row.membershipId);
    return user ? [{ ...toSafeProjectMember(row), user }] : [];
  });
}
