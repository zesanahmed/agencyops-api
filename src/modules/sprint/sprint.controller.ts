import type { Request, Response } from "express";
import { sendSuccess } from "../../lib/apiResponse.js";
import type { PaginationQuery } from "../organization/organization.validation.js";
import {
  completeSprint,
  createSprint,
  deleteSprint,
  getSprint,
  listSprints,
  startSprint,
  updateSprint,
} from "./sprint.service.js";
import type { CreateSprintBody, UpdateSprintBody } from "./sprint.validation.js";

function ids(req: Request) {
  const { projectId, sprintId } = req.params as { projectId: string; sprintId: string };
  return { organizationId: req.orgContext!.organization.id, projectId, sprintId };
}

export async function create(req: Request, res: Response): Promise<void> {
  const { projectId } = req.params as { projectId: string };
  const body = req.body as CreateSprintBody;
  const sprint = await createSprint({ organizationId: req.orgContext!.organization.id, projectId, ...body });
  sendSuccess(res, { sprint }, "Sprint created successfully", 201);
}

export async function list(req: Request, res: Response): Promise<void> {
  const { projectId } = req.params as { projectId: string };
  const { page, limit } = req.query as unknown as PaginationQuery;
  const result = await listSprints(req.orgContext!.organization.id, projectId, page, limit);
  sendSuccess(res, result, "Sprints retrieved successfully");
}

export async function getOne(req: Request, res: Response): Promise<void> {
  const { organizationId, projectId, sprintId } = ids(req);
  const sprint = await getSprint(organizationId, projectId, sprintId);
  sendSuccess(res, { sprint }, "Sprint retrieved successfully");
}

export async function update(req: Request, res: Response): Promise<void> {
  const { organizationId, projectId, sprintId } = ids(req);
  const body = req.body as UpdateSprintBody;
  const sprint = await updateSprint(organizationId, projectId, sprintId, body);
  sendSuccess(res, { sprint }, "Sprint updated successfully");
}

export async function start(req: Request, res: Response): Promise<void> {
  const { organizationId, projectId, sprintId } = ids(req);
  const sprint = await startSprint(organizationId, projectId, sprintId);
  sendSuccess(res, { sprint }, "Sprint started successfully");
}

export async function complete(req: Request, res: Response): Promise<void> {
  const { organizationId, projectId, sprintId } = ids(req);
  const sprint = await completeSprint(organizationId, projectId, sprintId);
  sendSuccess(res, { sprint }, "Sprint completed successfully");
}

export async function remove(req: Request, res: Response): Promise<void> {
  const { organizationId, projectId, sprintId } = ids(req);
  await deleteSprint(organizationId, projectId, sprintId);
  sendSuccess(res, null, "Sprint deleted successfully");
}
