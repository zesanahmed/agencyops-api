import { AppError } from "../../errors/AppError.js";
import { prisma } from "../../lib/prisma.js";
import { toSafeTeam, toSafeTeamMember, type SafeTeam, type SafeTeamMember } from "./team.mappers.js";

async function assertNameAvailable(organizationId: string, name: string, excludeTeamId?: string) {
  const existing = await prisma.team.findFirst({
    where: excludeTeamId
      ? { organizationId, name, deletedAt: null, id: { not: excludeTeamId } }
      : { organizationId, name, deletedAt: null },
    select: { id: true },
  });
  if (existing) {
    throw new AppError("A team with this name already exists in the organization", 409);
  }
}

export async function createTeam(input: {
  organizationId: string;
  name: string;
  description?: string | undefined;
}): Promise<SafeTeam> {
  await assertNameAvailable(input.organizationId, input.name);
  const team = await prisma.team.create({
    data: { organizationId: input.organizationId, name: input.name, description: input.description ?? null },
  });
  return toSafeTeam(team);
}

export async function listTeams(input: {
  organizationId: string;
  page: number;
  limit: number;
}): Promise<{ teams: SafeTeam[]; pagination: { page: number; limit: number; total: number; totalPages: number } }> {
  const where = { organizationId: input.organizationId, deletedAt: null };
  const [teams, total] = await Promise.all([
    prisma.team.findMany({ where, orderBy: { createdAt: "desc" }, skip: (input.page - 1) * input.limit, take: input.limit }),
    prisma.team.count({ where }),
  ]);
  return {
    teams: teams.map(toSafeTeam),
    pagination: { page: input.page, limit: input.limit, total, totalPages: Math.ceil(total / input.limit) },
  };
}

export async function getTeam(organizationId: string, teamId: string): Promise<SafeTeam> {
  const team = await prisma.team.findFirst({ where: { id: teamId, organizationId, deletedAt: null } });
  if (!team) {
    throw new AppError("Team not found", 404);
  }
  return toSafeTeam(team);
}

export async function updateTeam(
  organizationId: string,
  teamId: string,
  input: { name?: string | undefined; description?: string | undefined },
): Promise<SafeTeam> {
  await getTeam(organizationId, teamId);
  if (input.name) {
    await assertNameAvailable(organizationId, input.name, teamId);
  }
  const data: { name?: string; description?: string } = {};
  if (input.name !== undefined) data.name = input.name;
  if (input.description !== undefined) data.description = input.description;
  const team = await prisma.team.update({ where: { id: teamId }, data });
  return toSafeTeam(team);
}

export async function deleteTeam(organizationId: string, teamId: string): Promise<void> {
  await getTeam(organizationId, teamId);
  await prisma.team.update({ where: { id: teamId }, data: { deletedAt: new Date() } });
}

export async function addTeamMember(
  organizationId: string,
  teamId: string,
  membershipId: string,
): Promise<SafeTeamMember> {
  await getTeam(organizationId, teamId);

  const membership = await prisma.membership.findFirst({
    where: { id: membershipId, organizationId, status: "ACTIVE" },
  });
  if (!membership) {
    throw new AppError("Membership not found in this organization", 404);
  }

  const existing = await prisma.teamMember.findFirst({ where: { teamId, membershipId } });
  if (existing) {
    throw new AppError("This member is already on the team", 409);
  }

  const member = await prisma.teamMember.create({ data: { teamId, membershipId } });
  return toSafeTeamMember(member);
}

export async function removeTeamMember(
  organizationId: string,
  teamId: string,
  teamMemberId: string,
): Promise<void> {
  await getTeam(organizationId, teamId);
  const member = await prisma.teamMember.findFirst({ where: { id: teamMemberId, teamId } });
  if (!member) {
    throw new AppError("Team member not found", 404);
  }
  await prisma.teamMember.delete({ where: { id: teamMemberId } });
}

export async function listTeamMembers(organizationId: string, teamId: string): Promise<SafeTeamMember[]> {
  await getTeam(organizationId, teamId);
  const members = await prisma.teamMember.findMany({ where: { teamId }, orderBy: { createdAt: "asc" } });
  return members.map(toSafeTeamMember);
}
