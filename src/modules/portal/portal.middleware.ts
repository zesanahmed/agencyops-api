import type { NextFunction, Request, Response } from "express";
import { AppError } from "../../errors/AppError.js";
import { prisma } from "../../lib/prisma.js";
import { verifyClientAccessToken } from "./portal.token.js";
import "./portal.types.js";

const BEARER_PREFIX = "Bearer ";

/**
 * Authenticates a client-portal request. Unlike internal authenticate()
 * (stateless JWT), this checks the database on every request: disabling
 * a contact, revoking their session, or suspending the agency must cut
 * off portal access immediately, not at the next token expiry.
 */
export async function portalAuthenticate(req: Request, _res: Response, next: NextFunction): Promise<void> {
  const header = req.headers.authorization;
  if (!header || !header.startsWith(BEARER_PREFIX)) {
    throw new AppError("Authentication required", 401);
  }
  const token = header.slice(BEARER_PREFIX.length).trim();
  if (!token) throw new AppError("Authentication required", 401);

  const { sub: contactId, sid: sessionId } = await verifyClientAccessToken(token);

  const session = await prisma.clientSession.findFirst({
    where: { id: sessionId, clientContactId: contactId, revokedAt: null, expiresAt: { gt: new Date() } },
    select: {
      clientContact: {
        select: {
          id: true,
          name: true,
          status: true,
          organizationId: true,
          clientOrganizationId: true,
          organization: { select: { status: true, deletedAt: true } },
          clientOrganization: { select: { deletedAt: true } },
        },
      },
    },
  });

  const contact = session?.clientContact;
  if (
    !contact ||
    contact.status !== "ACTIVE" ||
    contact.organization.deletedAt !== null ||
    contact.organization.status !== "ACTIVE" ||
    contact.clientOrganization.deletedAt !== null
  ) {
    throw new AppError("Authentication required", 401);
  }

  req.client = {
    contactId: contact.id,
    organizationId: contact.organizationId,
    clientOrganizationId: contact.clientOrganizationId,
    sessionId,
    name: contact.name,
  };
  next();
}

/**
 * The client-side authorization gate: the contact must hold an
 * explicit ClientProjectAccess grant for :projectId, and the project
 * must still be live, in the contact's own organization, and linked to
 * the contact's own client. Anything else is a 404 — indistinguishable
 * from a project that doesn't exist.
 */
export async function requireProjectAccess(req: Request, _res: Response, next: NextFunction): Promise<void> {
  const client = req.client!;
  const { projectId } = req.params as { projectId: string };

  const access = await prisma.clientProjectAccess.findFirst({
    where: {
      clientContactId: client.contactId,
      projectId,
      project: {
        deletedAt: null,
        organizationId: client.organizationId,
        clientOrganizationId: client.clientOrganizationId,
      },
    },
    select: { id: true },
  });
  if (!access) throw new AppError("Project not found", 404);
  next();
}
