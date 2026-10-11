import type { Request, Response } from "express";
import { sendSuccess } from "../../lib/apiResponse.js";
import {
  createClient,
  createContact,
  deleteClient,
  disableContact,
  enableContact,
  getClient,
  grantAccess,
  linkProject,
  listAccess,
  listClientProjects,
  listClients,
  listContacts,
  reinviteContact,
  revokeAccess,
  unlinkProject,
  updateClient,
  updateContact,
  type RequestMeta,
} from "./client.service.js";
import type {
  ClientListQuery,
  CreateClientBody,
  CreateContactBody,
  UpdateClientBody,
  UpdateContactBody,
} from "./client.validation.js";

function orgId(req: Request): string {
  return req.orgContext!.organization.id;
}

function meta(req: Request): RequestMeta {
  const userAgent = req.headers["user-agent"];
  return {
    actorMembershipId: req.orgContext!.membership.id,
    ipAddress: req.ip ?? null,
    userAgent: typeof userAgent === "string" ? userAgent : null,
  };
}

const p = (req: Request) =>
  req.params as { clientId: string; contactId: string; projectId: string };

export async function create(req: Request, res: Response): Promise<void> {
  const client = await createClient(orgId(req), req.body as CreateClientBody);
  sendSuccess(res, { client }, "Client created successfully", 201);
}

export async function list(req: Request, res: Response): Promise<void> {
  const result = await listClients(orgId(req), req.query as unknown as ClientListQuery);
  sendSuccess(res, result, "Clients retrieved successfully");
}

export async function getOne(req: Request, res: Response): Promise<void> {
  const client = await getClient(orgId(req), p(req).clientId);
  sendSuccess(res, { client }, "Client retrieved successfully");
}

export async function update(req: Request, res: Response): Promise<void> {
  const client = await updateClient(orgId(req), p(req).clientId, req.body as UpdateClientBody);
  sendSuccess(res, { client }, "Client updated successfully");
}

export async function remove(req: Request, res: Response): Promise<void> {
  await deleteClient(orgId(req), p(req).clientId, meta(req));
  sendSuccess(res, null, "Client deleted successfully");
}

export async function createContactHandler(req: Request, res: Response): Promise<void> {
  const result = await createContact(orgId(req), p(req).clientId, req.body as CreateContactBody);
  sendSuccess(res, result, "Contact created successfully", 201);
}

export async function listContactsHandler(req: Request, res: Response): Promise<void> {
  const contacts = await listContacts(orgId(req), p(req).clientId);
  sendSuccess(res, { contacts }, "Contacts retrieved successfully");
}

export async function updateContactHandler(req: Request, res: Response): Promise<void> {
  const { clientId, contactId } = p(req);
  const contact = await updateContact(orgId(req), clientId, contactId, req.body as UpdateContactBody);
  sendSuccess(res, { contact }, "Contact updated successfully");
}

export async function reinvite(req: Request, res: Response): Promise<void> {
  const { clientId, contactId } = p(req);
  const result = await reinviteContact(orgId(req), clientId, contactId);
  sendSuccess(res, result, "Invitation re-issued successfully");
}

export async function disable(req: Request, res: Response): Promise<void> {
  const { clientId, contactId } = p(req);
  await disableContact(orgId(req), clientId, contactId, meta(req));
  sendSuccess(res, null, "Contact disabled successfully");
}

export async function enable(req: Request, res: Response): Promise<void> {
  const { clientId, contactId } = p(req);
  const result = await enableContact(orgId(req), clientId, contactId, meta(req));
  sendSuccess(res, result, "Contact enabled successfully");
}

export async function listProjectsHandler(req: Request, res: Response): Promise<void> {
  const projects = await listClientProjects(orgId(req), p(req).clientId);
  sendSuccess(res, { projects }, "Client projects retrieved successfully");
}

export async function linkProjectHandler(req: Request, res: Response): Promise<void> {
  const { projectId } = req.body as { projectId: string };
  await linkProject(orgId(req), p(req).clientId, projectId);
  sendSuccess(res, null, "Project linked to client successfully", 201);
}

export async function unlinkProjectHandler(req: Request, res: Response): Promise<void> {
  const { clientId, projectId } = p(req);
  await unlinkProject(orgId(req), clientId, projectId, meta(req));
  sendSuccess(res, null, "Project unlinked from client successfully");
}

export async function listAccessHandler(req: Request, res: Response): Promise<void> {
  const { clientId, contactId } = p(req);
  const access = await listAccess(orgId(req), clientId, contactId);
  sendSuccess(res, { access }, "Project access retrieved successfully");
}

export async function grantAccessHandler(req: Request, res: Response): Promise<void> {
  const { clientId, contactId } = p(req);
  const { projectId } = req.body as { projectId: string };
  const access = await grantAccess(orgId(req), clientId, contactId, projectId, meta(req));
  sendSuccess(res, { access }, "Project access granted successfully", 201);
}

export async function revokeAccessHandler(req: Request, res: Response): Promise<void> {
  const { clientId, contactId, projectId } = p(req);
  await revokeAccess(orgId(req), clientId, contactId, projectId, meta(req));
  sendSuccess(res, null, "Project access revoked successfully");
}
