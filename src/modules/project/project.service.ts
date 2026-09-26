import { AppError } from "../../errors/AppError.js";
import { prisma } from "../../lib/prisma.js";
import {
  toSafeProject,
  toSafeProjectMember,
  toSafeProjectTeam,
  type SafeProject,
  type SafeProjectMember,
  type SafeProjectTeam,
} from "./project.mappers.js";
import type { ProjectListQuery } from "./project.validation.js";

function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 100);
}

async function assertSlugAvailable(organizationId: string, slug: string, excludeProjectId?: string) {
  const existing = await prisma.project.findFirst({
    where: excludeProjectId
      ? { organizationId, slug, id: { not: excludeProjectId } }
      : { organizationId, slug },
    select: { id: true },
  });
  if (existing) {
    throw new AppError("A project with this slug already exists in the organization", 409);
  }
}

export async function createProject(input: {
  organizationId: string;
  name: string;
  slug?: string | undefined;
  description?: string | undefined;
  status?: import("../../generated/prisma/client.js").ProjectStatus | undefined;
  startDate?: Date | undefined;
  dueDate?: Date | undefined;
}): Promise<SafeProject> {
  const slug = input.slug || slugify(input.name);
  if (!slug) {
    throw new AppError("Could not derive a valid slug from the project name; provide one explicitly", 400);
  }
  await assertSlugAvailable(input.organizationId, slug);

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
  return toSafeProject(project);
}

export async function listProjects(
  organizationId: string,
  query: ProjectListQuery,
): Promise<{ projects: SafeProject[]; pagination: { page: number; limit: number; total: number; totalPages: number } }> {
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
    projects: projects.map(toSafeProject),
    pagination: { page: query.page, limit: query.limit, total, totalPages: Math.ceil(total / query.limit) },
  };
}

export async function getProject(organizationId: string, projectId: string): Promise<SafeProject> {
  const project = await prisma.project.findFirst({ where: { id: projectId, organizationId, deletedAt: null } });
  if (!project) {
    throw new AppError("Project not found", 404);
  }
  return toSafeProject(project);
}

export async function updateProject(
  organizationId: string,
  projectId: string,
  input: Record<string, unknown>,
): Promise<SafeProject> {
  await getProject(organizationId, projectId);
  if (typeof input.slug === "string") {
    await assertSlugAvailable(organizationId, input.slug, projectId);
  }
  const project = await prisma.project.update({ where: { id: projectId }, data: input });
  return toSafeProject(project);
}

export async function deleteProject(organizationId: string, projectId: string): Promise<void> {
  await getProject(organizationId, projectId);
  await prisma.project.update({ where: { id: projectId }, data: { deletedAt: new Date() } });
}

export async function assignTeam(
  organizationId: string,
  projectId: string,
  teamId: string,
): Promise<SafeProjectTeam> {
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
  return toSafeProjectTeam(pt);
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

export async function listProjectTeams(organizationId: string, projectId: string): Promise<SafeProjectTeam[]> {
  await getProject(organizationId, projectId);
  const rows = await prisma.projectTeam.findMany({ where: { projectId } });
  return rows.map(toSafeProjectTeam);
}

export async function addProjectMember(
  organizationId: string,
  projectId: string,
  membershipId: string,
): Promise<SafeProjectMember> {
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
  return toSafeProjectMember(pm);
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

export async function listProjectMembers(organizationId: string, projectId: string): Promise<SafeProjectMember[]> {
  await getProject(organizationId, projectId);
  const rows = await prisma.projectMember.findMany({ where: { projectId } });
  return rows.map(toSafeProjectMember);
}
