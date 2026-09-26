import type {
  Project,
  ProjectMember,
  ProjectStatus,
  ProjectTeam,
} from "../../generated/prisma/client.js";
import type { JsonValue } from "../../types/api-response.js";

export interface SafeProject {
  id: string;
  organizationId: string;
  name: string;
  slug: string;
  description: string | null;
  status: ProjectStatus;
  startDate: string | null;
  dueDate: string | null;
  createdAt: string;
  updatedAt: string;
  [key: string]: JsonValue;
}

export function toSafeProject(project: Project): SafeProject {
  return {
    id: project.id,
    organizationId: project.organizationId,
    name: project.name,
    slug: project.slug,
    description: project.description,
    status: project.status,
    startDate: project.startDate ? project.startDate.toISOString() : null,
    dueDate: project.dueDate ? project.dueDate.toISOString() : null,
    createdAt: project.createdAt.toISOString(),
    updatedAt: project.updatedAt.toISOString(),
  };
}

export interface SafeProjectTeam {
  id: string;
  projectId: string;
  teamId: string;
  createdAt: string;
  [key: string]: JsonValue;
}

export function toSafeProjectTeam(pt: ProjectTeam): SafeProjectTeam {
  return { id: pt.id, projectId: pt.projectId, teamId: pt.teamId, createdAt: pt.createdAt.toISOString() };
}

export interface SafeProjectMember {
  id: string;
  projectId: string;
  membershipId: string;
  createdAt: string;
  [key: string]: JsonValue;
}

export function toSafeProjectMember(pm: ProjectMember): SafeProjectMember {
  return { id: pm.id, projectId: pm.projectId, membershipId: pm.membershipId, createdAt: pm.createdAt.toISOString() };
}
