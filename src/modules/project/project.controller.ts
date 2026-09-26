import type { Request, Response } from "express";
import { sendSuccess } from "../../lib/apiResponse.js";
import {
  addProjectMember,
  assignTeam,
  createProject,
  deleteProject,
  getProject,
  listProjectMembers,
  listProjectTeams,
  listProjects,
  removeProjectMember,
  unassignTeam,
  updateProject,
} from "./project.service.js";
import type {
  AddProjectMemberBody,
  AssignProjectTeamBody,
  CreateProjectBody,
  ProjectListQuery,
  UpdateProjectBody,
} from "./project.validation.js";

export async function create(req: Request, res: Response): Promise<void> {
  const body = req.body as CreateProjectBody;
  const project = await createProject({ organizationId: req.orgContext!.organization.id, ...body });
  sendSuccess(res, { project }, "Project created successfully", 201);
}

export async function list(req: Request, res: Response): Promise<void> {
  const query = req.query as unknown as ProjectListQuery;
  const result = await listProjects(req.orgContext!.organization.id, query);
  sendSuccess(res, result, "Projects retrieved successfully");
}

export async function getOne(req: Request, res: Response): Promise<void> {
  const { projectId } = req.params as { projectId: string };
  const project = await getProject(req.orgContext!.organization.id, projectId);
  sendSuccess(res, { project }, "Project retrieved successfully");
}

export async function update(req: Request, res: Response): Promise<void> {
  const { projectId } = req.params as { projectId: string };
  const body = req.body as UpdateProjectBody;
  const project = await updateProject(req.orgContext!.organization.id, projectId, body);
  sendSuccess(res, { project }, "Project updated successfully");
}

export async function remove(req: Request, res: Response): Promise<void> {
  const { projectId } = req.params as { projectId: string };
  await deleteProject(req.orgContext!.organization.id, projectId);
  sendSuccess(res, null, "Project deleted successfully");
}

export async function listTeams(req: Request, res: Response): Promise<void> {
  const { projectId } = req.params as { projectId: string };
  const teams = await listProjectTeams(req.orgContext!.organization.id, projectId);
  sendSuccess(res, { teams }, "Project teams retrieved successfully");
}

export async function addTeam(req: Request, res: Response): Promise<void> {
  const { projectId } = req.params as { projectId: string };
  const { teamId } = req.body as AssignProjectTeamBody;
  const pt = await assignTeam(req.orgContext!.organization.id, projectId, teamId);
  sendSuccess(res, { projectTeam: pt }, "Team assigned to project successfully", 201);
}

export async function removeTeam(req: Request, res: Response): Promise<void> {
  const { projectId, projectTeamId } = req.params as { projectId: string; projectTeamId: string };
  await unassignTeam(req.orgContext!.organization.id, projectId, projectTeamId);
  sendSuccess(res, null, "Team unassigned from project successfully");
}

export async function listMembers(req: Request, res: Response): Promise<void> {
  const { projectId } = req.params as { projectId: string };
  const members = await listProjectMembers(req.orgContext!.organization.id, projectId);
  sendSuccess(res, { members }, "Project members retrieved successfully");
}

export async function addMember(req: Request, res: Response): Promise<void> {
  const { projectId } = req.params as { projectId: string };
  const { membershipId } = req.body as AddProjectMemberBody;
  const member = await addProjectMember(req.orgContext!.organization.id, projectId, membershipId);
  sendSuccess(res, { member }, "Member added to project successfully", 201);
}

export async function removeMember(req: Request, res: Response): Promise<void> {
  const { projectId, projectMemberId } = req.params as { projectId: string; projectMemberId: string };
  await removeProjectMember(req.orgContext!.organization.id, projectId, projectMemberId);
  sendSuccess(res, null, "Member removed from project successfully");
}
