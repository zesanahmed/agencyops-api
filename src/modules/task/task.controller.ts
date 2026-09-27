import type { Request, Response } from "express";
import { sendSuccess } from "../../lib/apiResponse.js";
import {
  addCollaborator,
  createSubtask,
  createTask,
  deleteTask,
  getTask,
  listCollaborators,
  listSubtasks,
  listTasks,
  removeCollaborator,
  updateTask,
} from "./task.service.js";
import type {
  AddCollaboratorBody,
  CreateSubtaskBody,
  CreateTaskBody,
  TaskListQuery,
  UpdateTaskBody,
} from "./task.validation.js";

function ctx(req: Request) {
  const { projectId, taskId } = req.params as { projectId: string; taskId: string };
  return { organizationId: req.orgContext!.organization.id, projectId, taskId };
}

export async function create(req: Request, res: Response): Promise<void> {
  const { projectId } = req.params as { projectId: string };
  const body = req.body as CreateTaskBody;
  const task = await createTask({ organizationId: req.orgContext!.organization.id, projectId, ...body });
  sendSuccess(res, { task }, "Task created successfully", 201);
}

export async function list(req: Request, res: Response): Promise<void> {
  const { projectId } = req.params as { projectId: string };
  const query = req.query as unknown as TaskListQuery;
  const result = await listTasks(req.orgContext!.organization.id, projectId, query);
  sendSuccess(res, result, "Tasks retrieved successfully");
}

export async function getOne(req: Request, res: Response): Promise<void> {
  const { organizationId, projectId, taskId } = ctx(req);
  const task = await getTask(organizationId, projectId, taskId);
  sendSuccess(res, { task }, "Task retrieved successfully");
}

export async function update(req: Request, res: Response): Promise<void> {
  const { organizationId, projectId, taskId } = ctx(req);
  const body = req.body as UpdateTaskBody;
  const task = await updateTask(organizationId, projectId, taskId, body);
  sendSuccess(res, { task }, "Task updated successfully");
}

export async function remove(req: Request, res: Response): Promise<void> {
  const { organizationId, projectId, taskId } = ctx(req);
  await deleteTask(organizationId, projectId, taskId);
  sendSuccess(res, null, "Task deleted successfully");
}

export async function listSubtasksHandler(req: Request, res: Response): Promise<void> {
  const { organizationId, projectId, taskId } = ctx(req);
  const subtasks = await listSubtasks(organizationId, projectId, taskId);
  sendSuccess(res, { subtasks }, "Subtasks retrieved successfully");
}

export async function createSubtaskHandler(req: Request, res: Response): Promise<void> {
  const { organizationId, projectId, taskId } = ctx(req);
  const body = req.body as CreateSubtaskBody;
  const subtask = await createSubtask(organizationId, projectId, taskId, body);
  sendSuccess(res, { subtask }, "Subtask created successfully", 201);
}

export async function listCollaboratorsHandler(req: Request, res: Response): Promise<void> {
  const { organizationId, projectId, taskId } = ctx(req);
  const collaborators = await listCollaborators(organizationId, projectId, taskId);
  sendSuccess(res, { collaborators }, "Collaborators retrieved successfully");
}

export async function addCollaboratorHandler(req: Request, res: Response): Promise<void> {
  const { organizationId, projectId, taskId } = ctx(req);
  const { membershipId } = req.body as AddCollaboratorBody;
  const collaborator = await addCollaborator(organizationId, projectId, taskId, membershipId);
  sendSuccess(res, { collaborator }, "Collaborator added successfully", 201);
}

export async function removeCollaboratorHandler(req: Request, res: Response): Promise<void> {
  const { organizationId, projectId, taskId } = ctx(req);
  const { taskCollaboratorId } = req.params as { taskCollaboratorId: string };
  await removeCollaborator(organizationId, projectId, taskId, taskCollaboratorId);
  sendSuccess(res, null, "Collaborator removed successfully");
}
