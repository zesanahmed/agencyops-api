import type { Request, Response } from "express";
import { sendSuccess } from "../../lib/apiResponse.js";
import type { PaginationQuery } from "../organization/organization.validation.js";
import {
  addTeamMember,
  createTeam,
  deleteTeam,
  getTeam,
  listTeamMembers,
  listTeams,
  removeTeamMember,
  updateTeam,
} from "./team.service.js";
import type { AddTeamMemberBody, CreateTeamBody, UpdateTeamBody } from "./team.validation.js";

export async function create(req: Request, res: Response): Promise<void> {
  const body = req.body as CreateTeamBody;
  const team = await createTeam({ organizationId: req.orgContext!.organization.id, ...body });
  sendSuccess(res, { team }, "Team created successfully", 201);
}

export async function list(req: Request, res: Response): Promise<void> {
  const { page, limit } = req.query as unknown as PaginationQuery;
  const result = await listTeams({ organizationId: req.orgContext!.organization.id, page, limit });
  sendSuccess(res, result, "Teams retrieved successfully");
}

export async function getOne(req: Request, res: Response): Promise<void> {
  const { teamId } = req.params as { teamId: string };
  const team = await getTeam(req.orgContext!.organization.id, teamId);
  sendSuccess(res, { team }, "Team retrieved successfully");
}

export async function update(req: Request, res: Response): Promise<void> {
  const { teamId } = req.params as { teamId: string };
  const body = req.body as UpdateTeamBody;
  const team = await updateTeam(req.orgContext!.organization.id, teamId, body);
  sendSuccess(res, { team }, "Team updated successfully");
}

export async function remove(req: Request, res: Response): Promise<void> {
  const { teamId } = req.params as { teamId: string };
  await deleteTeam(req.orgContext!.organization.id, teamId);
  sendSuccess(res, null, "Team deleted successfully");
}

export async function listMembers(req: Request, res: Response): Promise<void> {
  const { teamId } = req.params as { teamId: string };
  const members = await listTeamMembers(req.orgContext!.organization.id, teamId);
  sendSuccess(res, { members }, "Team members retrieved successfully");
}

export async function addMember(req: Request, res: Response): Promise<void> {
  const { teamId } = req.params as { teamId: string };
  const { membershipId } = req.body as AddTeamMemberBody;
  const member = await addTeamMember(req.orgContext!.organization.id, teamId, membershipId);
  sendSuccess(res, { member }, "Member added to team successfully", 201);
}

export async function removeMember(req: Request, res: Response): Promise<void> {
  const { teamId, teamMemberId } = req.params as { teamId: string; teamMemberId: string };
  await removeTeamMember(req.orgContext!.organization.id, teamId, teamMemberId);
  sendSuccess(res, null, "Member removed from team successfully");
}
