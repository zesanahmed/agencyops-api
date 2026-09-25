import type { Team, TeamMember } from "../../generated/prisma/client.js";
import type { JsonValue } from "../../types/api-response.js";

export interface SafeTeam {
  id: string;
  organizationId: string;
  name: string;
  description: string | null;
  createdAt: string;
  updatedAt: string;
  [key: string]: JsonValue;
}

export function toSafeTeam(team: Team): SafeTeam {
  return {
    id: team.id,
    organizationId: team.organizationId,
    name: team.name,
    description: team.description,
    createdAt: team.createdAt.toISOString(),
    updatedAt: team.updatedAt.toISOString(),
  };
}

export interface SafeTeamMember {
  id: string;
  teamId: string;
  membershipId: string;
  createdAt: string;
  [key: string]: JsonValue;
}

export function toSafeTeamMember(member: TeamMember): SafeTeamMember {
  return {
    id: member.id,
    teamId: member.teamId,
    membershipId: member.membershipId,
    createdAt: member.createdAt.toISOString(),
  };
}
