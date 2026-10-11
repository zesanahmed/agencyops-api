import type { Request, Response } from "express";
import { AppError } from "../../errors/AppError.js";
import { sendSuccess } from "../../lib/apiResponse.js";
import type { ClientRequestType } from "../../generated/prisma/client.js";
import { deleteProjectFile, listProjectFiles, uploadProjectFile } from "./collaboration.files.service.js";
import type { PortalTaskQuery, RequestListQuery } from "./collaboration.validation.js";
import {
  assertProjectInOrg,
  createClientRequest,
  createProjectUpdate,
  deleteMessage,
  deleteProjectUpdate,
  getPortalProject,
  getRequestInternal,
  listClientVisibleTasks,
  listMessages,
  listOwnRequests,
  listPortalProjects,
  listProjectUpdates,
  listRequestsInternal,
  postMessage,
  setTaskClientVisibility,
  updateRequestInternal,
} from "./collaboration.service.js";

const page = (req: Request) => {
  const q = req.query as unknown as { page: number; limit: number };
  return { page: q.page, limit: q.limit };
};
const params = (req: Request) =>
  req.params as { projectId: string; taskId: string; updateId: string; messageId: string; fileId: string; requestId: string };

function requireFile(req: Request): Express.Multer.File {
  if (!req.file) throw new AppError('No file was uploaded (expected form field "file")', 400);
  return req.file;
}

// ===================== Internal (staff) side =====================

const org = (req: Request) => req.orgContext!.organization.id;
const membershipId = (req: Request) => req.orgContext!.membership.id;

export async function internalSetTaskVisibility(req: Request, res: Response): Promise<void> {
  const { projectId, taskId } = params(req);
  const { clientVisible } = req.body as { clientVisible: boolean };
  const task = await setTaskClientVisibility(org(req), projectId, taskId, clientVisible);
  sendSuccess(res, { task }, "Task client visibility updated successfully");
}

export async function internalCreateUpdate(req: Request, res: Response): Promise<void> {
  const { projectId } = params(req);
  const body = req.body as { title: string; body: string };
  const update = await createProjectUpdate({
    organizationId: org(req),
    projectId,
    authorMembershipId: membershipId(req),
    ...body,
  });
  sendSuccess(res, { update }, "Project update posted successfully", 201);
}

export async function internalListUpdates(req: Request, res: Response): Promise<void> {
  const { projectId } = params(req);
  await assertProjectInOrg(org(req), projectId);
  const { page: p, limit } = page(req);
  sendSuccess(res, await listProjectUpdates(org(req), projectId, p, limit), "Project updates retrieved successfully");
}

export async function internalDeleteUpdate(req: Request, res: Response): Promise<void> {
  const { projectId, updateId } = params(req);
  await deleteProjectUpdate(org(req), projectId, updateId);
  sendSuccess(res, null, "Project update deleted successfully");
}

export async function internalPostMessage(req: Request, res: Response): Promise<void> {
  const { projectId } = params(req);
  await assertProjectInOrg(org(req), projectId);
  const { content } = req.body as { content: string };
  const message = await postMessage({
    organizationId: org(req),
    projectId,
    content,
    author: { membershipId: membershipId(req) },
  });
  sendSuccess(res, { message }, "Message posted successfully", 201);
}

export async function internalListMessages(req: Request, res: Response): Promise<void> {
  const { projectId } = params(req);
  await assertProjectInOrg(org(req), projectId);
  const { page: p, limit } = page(req);
  sendSuccess(res, await listMessages(org(req), projectId, p, limit), "Messages retrieved successfully");
}

export async function internalDeleteMessage(req: Request, res: Response): Promise<void> {
  const { projectId, messageId } = params(req);
  await deleteMessage(org(req), projectId, messageId);
  sendSuccess(res, null, "Message deleted successfully");
}

export async function internalUploadFile(req: Request, res: Response): Promise<void> {
  const { projectId } = params(req);
  await assertProjectInOrg(org(req), projectId);
  const file = requireFile(req);
  const uploaded = await uploadProjectFile({
    organizationId: org(req),
    projectId,
    uploader: { membershipId: membershipId(req) },
    originalFilename: file.originalname,
    mimeType: file.mimetype,
    buffer: file.buffer,
  });
  sendSuccess(res, { file: uploaded }, "File uploaded successfully", 201);
}

export async function internalListFiles(req: Request, res: Response): Promise<void> {
  const { projectId } = params(req);
  await assertProjectInOrg(org(req), projectId);
  const { page: p, limit } = page(req);
  sendSuccess(res, await listProjectFiles(org(req), projectId, p, limit), "Files retrieved successfully");
}

export async function internalDeleteFile(req: Request, res: Response): Promise<void> {
  const { projectId, fileId } = params(req);
  await deleteProjectFile(org(req), projectId, fileId);
  sendSuccess(res, null, "File deleted successfully");
}

export async function internalListRequests(req: Request, res: Response): Promise<void> {
  const query = req.query as unknown as RequestListQuery;
  sendSuccess(res, await listRequestsInternal(org(req), query), "Client requests retrieved successfully");
}

export async function internalGetRequest(req: Request, res: Response): Promise<void> {
  const request = await getRequestInternal(org(req), params(req).requestId);
  sendSuccess(res, { request }, "Client request retrieved successfully");
}

export async function internalUpdateRequest(req: Request, res: Response): Promise<void> {
  const body = req.body as { status?: "OPEN" | "IN_REVIEW" | "RESOLVED" | "REJECTED"; resolutionNote?: string | null };
  const request = await updateRequestInternal(org(req), params(req).requestId, membershipId(req), body);
  sendSuccess(res, { request }, "Client request updated successfully");
}

// ===================== Client portal side =====================
// Every handler below runs after portalAuthenticate; project-scoped ones
// also run after requireProjectAccess.

const client = (req: Request) => req.client!;

export async function portalListProjects(req: Request, res: Response): Promise<void> {
  const c = client(req);
  const projects = await listPortalProjects(c.contactId, c.organizationId, c.clientOrganizationId);
  sendSuccess(res, { projects }, "Projects retrieved successfully");
}

export async function portalGetProject(req: Request, res: Response): Promise<void> {
  const project = await getPortalProject(params(req).projectId);
  sendSuccess(res, { project }, "Project retrieved successfully");
}

export async function portalListTasks(req: Request, res: Response): Promise<void> {
  const query = req.query as unknown as PortalTaskQuery;
  sendSuccess(res, await listClientVisibleTasks(params(req).projectId, query), "Tasks retrieved successfully");
}

export async function portalListUpdates(req: Request, res: Response): Promise<void> {
  const { page: p, limit } = page(req);
  sendSuccess(
    res,
    await listProjectUpdates(client(req).organizationId, params(req).projectId, p, limit),
    "Project updates retrieved successfully",
  );
}

export async function portalListMessages(req: Request, res: Response): Promise<void> {
  const { page: p, limit } = page(req);
  sendSuccess(
    res,
    await listMessages(client(req).organizationId, params(req).projectId, p, limit),
    "Messages retrieved successfully",
  );
}

export async function portalPostMessage(req: Request, res: Response): Promise<void> {
  const c = client(req);
  const { content } = req.body as { content: string };
  const message = await postMessage({
    organizationId: c.organizationId,
    projectId: params(req).projectId,
    content,
    author: { clientContactId: c.contactId },
  });
  sendSuccess(res, { message }, "Message posted successfully", 201);
}

export async function portalListRequests(req: Request, res: Response): Promise<void> {
  const { page: p, limit } = page(req);
  sendSuccess(
    res,
    await listOwnRequests(params(req).projectId, client(req).contactId, p, limit),
    "Requests retrieved successfully",
  );
}

export async function portalCreateRequest(req: Request, res: Response): Promise<void> {
  const c = client(req);
  const body = req.body as { type: ClientRequestType; title: string; description: string };
  const request = await createClientRequest({
    organizationId: c.organizationId,
    projectId: params(req).projectId,
    clientContactId: c.contactId,
    contactName: c.name,
    ...body,
  });
  sendSuccess(res, { request }, "Request submitted successfully", 201);
}

export async function portalListFiles(req: Request, res: Response): Promise<void> {
  const { page: p, limit } = page(req);
  sendSuccess(
    res,
    await listProjectFiles(client(req).organizationId, params(req).projectId, p, limit),
    "Files retrieved successfully",
  );
}

export async function portalUploadFile(req: Request, res: Response): Promise<void> {
  const c = client(req);
  const file = requireFile(req);
  const uploaded = await uploadProjectFile({
    organizationId: c.organizationId,
    projectId: params(req).projectId,
    uploader: { clientContactId: c.contactId, contactName: c.name },
    originalFilename: file.originalname,
    mimeType: file.mimetype,
    buffer: file.buffer,
  });
  sendSuccess(res, { file: uploaded }, "File uploaded successfully", 201);
}
