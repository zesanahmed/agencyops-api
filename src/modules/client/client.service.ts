import { randomBytes } from "node:crypto";
import { AppError } from "../../errors/AppError.js";
import { Prisma } from "../../generated/prisma/client.js";
import { prisma } from "../../lib/prisma.js";
import { hashToken, normalizeEmail } from "../auth/auth.utils.js";
import { recordAuditLog } from "../audit/audit.service.js";
import {
  toSafeClientContact,
  toSafeClientOrganization,
  toSafeClientProjectAccess,
  type SafeClientContact,
  type SafeClientOrganization,
  type SafeClientProjectAccess,
} from "./client.mappers.js";
import type { ClientListQuery } from "./client.validation.js";

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export interface RequestMeta {
  actorMembershipId: string;
  ipAddress: string | null;
  userAgent: string | null;
}

function newInviteToken(): { rawToken: string; tokenHash: string; expiresAt: Date } {
  const rawToken = randomBytes(32).toString("hex");
  return { rawToken, tokenHash: hashToken(rawToken), expiresAt: new Date(Date.now() + INVITE_TTL_MS) };
}

// ---- Tenant-scoped lookups. Every query below filters by organizationId. ----

async function getClientOrThrow(organizationId: string, clientId: string) {
  const client = await prisma.clientOrganization.findFirst({
    where: { id: clientId, organizationId, deletedAt: null },
  });
  if (!client) throw new AppError("Client not found", 404);
  return client;
}

async function getContactOrThrow(organizationId: string, clientId: string, contactId: string) {
  const contact = await prisma.clientContact.findFirst({
    where: { id: contactId, clientOrganizationId: clientId, organizationId },
  });
  if (!contact) throw new AppError("Contact not found", 404);
  return contact;
}

// ---- Client organizations ----

export async function createClient(
  organizationId: string,
  input: { name: string; website?: string | undefined; notes?: string | undefined },
): Promise<SafeClientOrganization> {
  const client = await prisma.clientOrganization.create({
    data: { organizationId, name: input.name, website: input.website ?? null, notes: input.notes ?? null },
  });
  return toSafeClientOrganization(client);
}

export async function listClients(organizationId: string, query: ClientListQuery) {
  const where: Prisma.ClientOrganizationWhereInput = { organizationId, deletedAt: null };
  if (query.search) where.name = { contains: query.search, mode: "insensitive" };

  const [rows, total] = await Promise.all([
    prisma.clientOrganization.findMany({
      where,
      orderBy: { [query.sortBy]: query.sortOrder },
      skip: (query.page - 1) * query.limit,
      take: query.limit,
    }),
    prisma.clientOrganization.count({ where }),
  ]);

  return {
    clients: rows.map(toSafeClientOrganization),
    pagination: { page: query.page, limit: query.limit, total, totalPages: Math.ceil(total / query.limit) },
  };
}

export async function getClient(organizationId: string, clientId: string): Promise<SafeClientOrganization> {
  return toSafeClientOrganization(await getClientOrThrow(organizationId, clientId));
}

export async function updateClient(
  organizationId: string,
  clientId: string,
  input: { name?: string | undefined; website?: string | null | undefined; notes?: string | null | undefined },
): Promise<SafeClientOrganization> {
  await getClientOrThrow(organizationId, clientId);
  const updated = await prisma.clientOrganization.update({
    where: { id: clientId },
    data: {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.website !== undefined ? { website: input.website } : {}),
      ...(input.notes !== undefined ? { notes: input.notes } : {}),
    },
  });
  return toSafeClientOrganization(updated);
}

/**
 * Soft-deletes the client and, in the same transaction, cuts off every
 * way it could still reach data: contacts are disabled, their sessions
 * revoked, their project access removed, and projects unlinked.
 */
export async function deleteClient(organizationId: string, clientId: string, meta: RequestMeta): Promise<void> {
  await getClientOrThrow(organizationId, clientId);
  const now = new Date();

  await prisma.$transaction(async (tx) => {
    const t = tx as unknown as Pick<
      typeof prisma,
      "clientOrganization" | "clientContact" | "clientSession" | "clientProjectAccess" | "project"
    >;
    const contacts = await t.clientContact.findMany({
      where: { clientOrganizationId: clientId, organizationId },
      select: { id: true },
    });
    const contactIds = contacts.map((c) => c.id);

    await t.clientSession.updateMany({
      where: { clientContactId: { in: contactIds }, revokedAt: null },
      data: { revokedAt: now },
    });
    await t.clientProjectAccess.deleteMany({ where: { clientContactId: { in: contactIds } } });
    await t.clientContact.updateMany({
      where: { clientOrganizationId: clientId, organizationId },
      data: { status: "DISABLED", inviteTokenHash: null, inviteExpiresAt: null },
    });
    await t.project.updateMany({
      where: { clientOrganizationId: clientId, organizationId },
      data: { clientOrganizationId: null },
    });
    await t.clientOrganization.update({ where: { id: clientId }, data: { deletedAt: now } });
  });

  await recordAuditLog({
    organizationId,
    actorMembershipId: meta.actorMembershipId,
    action: "client.deleted",
    entityType: "ClientOrganization",
    entityId: clientId,
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
  });
}

// ---- Contacts ----

export async function createContact(
  organizationId: string,
  clientId: string,
  input: { name: string; email: string; jobTitle?: string | undefined },
): Promise<{ contact: SafeClientContact; inviteToken: string }> {
  await getClientOrThrow(organizationId, clientId);
  const email = normalizeEmail(input.email);
  const invite = newInviteToken();

  try {
    const contact = await prisma.clientContact.create({
      data: {
        organizationId,
        clientOrganizationId: clientId,
        name: input.name,
        email,
        jobTitle: input.jobTitle ?? null,
        inviteTokenHash: invite.tokenHash,
        inviteExpiresAt: invite.expiresAt,
      },
    });
    return { contact: toSafeClientContact(contact), inviteToken: invite.rawToken };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new AppError("A client contact with this email already exists", 409);
    }
    throw error;
  }
}

export async function listContacts(organizationId: string, clientId: string): Promise<SafeClientContact[]> {
  await getClientOrThrow(organizationId, clientId);
  const rows = await prisma.clientContact.findMany({
    where: { clientOrganizationId: clientId, organizationId },
    orderBy: { createdAt: "asc" },
  });
  return rows.map(toSafeClientContact);
}

export async function updateContact(
  organizationId: string,
  clientId: string,
  contactId: string,
  input: { name?: string | undefined; jobTitle?: string | null | undefined },
): Promise<SafeClientContact> {
  await getContactOrThrow(organizationId, clientId, contactId);
  const updated = await prisma.clientContact.update({
    where: { id: contactId },
    data: {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.jobTitle !== undefined ? { jobTitle: input.jobTitle } : {}),
    },
  });
  return toSafeClientContact(updated);
}

/** Issues a fresh one-time invite token. Only valid while the contact has not accepted yet. */
export async function reinviteContact(
  organizationId: string,
  clientId: string,
  contactId: string,
): Promise<{ contact: SafeClientContact; inviteToken: string }> {
  const contact = await getContactOrThrow(organizationId, clientId, contactId);
  if (contact.status !== "INVITED") {
    throw new AppError("Only contacts that have not accepted their invitation can be re-invited", 409);
  }
  const invite = newInviteToken();
  const updated = await prisma.clientContact.update({
    where: { id: contactId },
    data: { inviteTokenHash: invite.tokenHash, inviteExpiresAt: invite.expiresAt },
  });
  return { contact: toSafeClientContact(updated), inviteToken: invite.rawToken };
}

export async function disableContact(
  organizationId: string,
  clientId: string,
  contactId: string,
  meta: RequestMeta,
): Promise<void> {
  await getContactOrThrow(organizationId, clientId, contactId);
  await prisma.$transaction(async (tx) => {
    const t = tx as unknown as Pick<typeof prisma, "clientContact" | "clientSession">;
    await t.clientContact.update({
      where: { id: contactId },
      data: { status: "DISABLED", inviteTokenHash: null, inviteExpiresAt: null },
    });
    await t.clientSession.updateMany({
      where: { clientContactId: contactId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  });
  await recordAuditLog({
    organizationId,
    actorMembershipId: meta.actorMembershipId,
    action: "client.contact.disabled",
    entityType: "ClientContact",
    entityId: contactId,
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
  });
}

/** Re-enables a disabled contact: ACTIVE if they had set a password, otherwise back to INVITED with a new token. */
export async function enableContact(
  organizationId: string,
  clientId: string,
  contactId: string,
  meta: RequestMeta,
): Promise<{ contact: SafeClientContact; inviteToken: string | null }> {
  const contact = await getContactOrThrow(organizationId, clientId, contactId);
  if (contact.status !== "DISABLED") {
    throw new AppError("Contact is not disabled", 409);
  }

  const hasPassword = contact.passwordHash !== null;
  const invite = hasPassword ? null : newInviteToken();
  const updated = await prisma.clientContact.update({
    where: { id: contactId },
    data: hasPassword
      ? { status: "ACTIVE" }
      : { status: "INVITED", inviteTokenHash: invite!.tokenHash, inviteExpiresAt: invite!.expiresAt },
  });

  await recordAuditLog({
    organizationId,
    actorMembershipId: meta.actorMembershipId,
    action: "client.contact.enabled",
    entityType: "ClientContact",
    entityId: contactId,
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
  });
  return { contact: toSafeClientContact(updated), inviteToken: invite ? invite.rawToken : null };
}

// ---- Project <-> client linkage ----

export async function listClientProjects(organizationId: string, clientId: string) {
  await getClientOrThrow(organizationId, clientId);
  const projects = await prisma.project.findMany({
    where: { organizationId, clientOrganizationId: clientId, deletedAt: null },
    select: { id: true, name: true, slug: true, status: true },
    orderBy: { createdAt: "asc" },
  });
  return projects;
}

export async function linkProject(organizationId: string, clientId: string, projectId: string): Promise<void> {
  await getClientOrThrow(organizationId, clientId);
  const project = await prisma.project.findFirst({
    where: { id: projectId, organizationId, deletedAt: null },
    select: { id: true, clientOrganizationId: true },
  });
  if (!project) throw new AppError("Project not found", 404);
  if (project.clientOrganizationId && project.clientOrganizationId !== clientId) {
    throw new AppError("Project is already linked to a different client", 409);
  }
  await prisma.project.update({ where: { id: projectId }, data: { clientOrganizationId: clientId } });
}

/** Unlinking removes every contact's access to the project in the same transaction. */
export async function unlinkProject(
  organizationId: string,
  clientId: string,
  projectId: string,
  meta: RequestMeta,
): Promise<void> {
  await getClientOrThrow(organizationId, clientId);
  const project = await prisma.project.findFirst({
    where: { id: projectId, organizationId, clientOrganizationId: clientId, deletedAt: null },
    select: { id: true },
  });
  if (!project) throw new AppError("Project is not linked to this client", 404);

  await prisma.$transaction(async (tx) => {
    const t = tx as unknown as Pick<typeof prisma, "project" | "clientProjectAccess">;
    await t.clientProjectAccess.deleteMany({ where: { projectId } });
    await t.project.update({ where: { id: projectId }, data: { clientOrganizationId: null } });
  });

  await recordAuditLog({
    organizationId,
    actorMembershipId: meta.actorMembershipId,
    action: "client.project.unlinked",
    entityType: "Project",
    entityId: projectId,
    metadata: { clientId },
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
  });
}

// ---- Explicit project access ----

export async function listAccess(
  organizationId: string,
  clientId: string,
  contactId: string,
): Promise<SafeClientProjectAccess[]> {
  await getContactOrThrow(organizationId, clientId, contactId);
  const rows = await prisma.clientProjectAccess.findMany({
    where: { clientContactId: contactId, project: { organizationId, deletedAt: null } },
    orderBy: { createdAt: "asc" },
  });
  return rows.map(toSafeClientProjectAccess);
}

export async function grantAccess(
  organizationId: string,
  clientId: string,
  contactId: string,
  projectId: string,
  meta: RequestMeta,
): Promise<SafeClientProjectAccess> {
  await getClientOrThrow(organizationId, clientId);
  const contact = await getContactOrThrow(organizationId, clientId, contactId);
  if (contact.status === "DISABLED") {
    throw new AppError("Cannot grant access to a disabled contact", 409);
  }

  // The project must belong to this organization AND be linked to this
  // contact's own client — a contact can never be granted a project
  // that belongs to a different client.
  const project = await prisma.project.findFirst({
    where: { id: projectId, organizationId, clientOrganizationId: clientId, deletedAt: null },
    select: { id: true },
  });
  if (!project) {
    throw new AppError("Project not found or not linked to this client", 404);
  }

  try {
    const access = await prisma.clientProjectAccess.create({
      data: { clientContactId: contactId, projectId, grantedByMembershipId: meta.actorMembershipId },
    });
    await recordAuditLog({
      organizationId,
      actorMembershipId: meta.actorMembershipId,
      action: "client.access.granted",
      entityType: "ClientProjectAccess",
      entityId: access.id,
      metadata: { contactId, projectId },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });
    return toSafeClientProjectAccess(access);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new AppError("Contact already has access to this project", 409);
    }
    throw error;
  }
}

export async function revokeAccess(
  organizationId: string,
  clientId: string,
  contactId: string,
  projectId: string,
  meta: RequestMeta,
): Promise<void> {
  await getContactOrThrow(organizationId, clientId, contactId);
  const access = await prisma.clientProjectAccess.findFirst({
    where: { clientContactId: contactId, projectId, project: { organizationId } },
    select: { id: true },
  });
  if (!access) throw new AppError("Access grant not found", 404);

  await prisma.clientProjectAccess.delete({ where: { id: access.id } });
  await recordAuditLog({
    organizationId,
    actorMembershipId: meta.actorMembershipId,
    action: "client.access.revoked",
    entityType: "ClientProjectAccess",
    entityId: access.id,
    metadata: { contactId, projectId },
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
  });
}
