import { prisma } from "../../lib/prisma.js";

/**
 * "Belongs to a project" = is an explicit ProjectMember OR sits on a team assigned to it.
 * Only ACTIVE memberships count, and soft-deleted teams are ignored.
 */
export async function getProjectMembershipIds(projectIds: string[]): Promise<Map<string, Set<string>>> {
  const result = new Map<string, Set<string>>(projectIds.map((id) => [id, new Set<string>()]));
  if (projectIds.length === 0) return result;

  const [explicit, viaTeams] = await Promise.all([
    prisma.projectMember.findMany({
      where: { projectId: { in: projectIds }, membership: { status: "ACTIVE" } },
      select: { projectId: true, membershipId: true },
    }),
    prisma.projectTeam.findMany({
      where: { projectId: { in: projectIds }, team: { deletedAt: null } },
      select: {
        projectId: true,
        team: { select: { members: { where: { membership: { status: "ACTIVE" } }, select: { membershipId: true } } } },
      },
    }),
  ]);
  for (const row of explicit) result.get(row.projectId)?.add(row.membershipId);
  for (const row of viaTeams) {
    for (const m of row.team.members) result.get(row.projectId)?.add(m.membershipId);
  }
  return result;
}

/** Ids of the (non-deleted) projects of an organization that the membership belongs to. */
export async function getProjectIdsForMembership(organizationId: string, membershipId: string): Promise<string[]> {
  const projects = await prisma.project.findMany({
    where: {
      organizationId,
      deletedAt: null,
      OR: [
        { members: { some: { membershipId, membership: { status: "ACTIVE" } } } },
        { projectTeams: { some: { team: { deletedAt: null, members: { some: { membershipId } } } } } },
      ],
    },
    select: { id: true },
  });
  return projects.map((p) => p.id);
}
