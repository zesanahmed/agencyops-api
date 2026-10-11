import { AppError } from "../../errors/AppError.js";
import type { ClientContact } from "../../generated/prisma/client.js";
import { prisma } from "../../lib/prisma.js";
import { comparePassword, hashPassword, hashToken, normalizeEmail } from "../auth/auth.utils.js";
import {
  CLIENT_REFRESH_FAILURE_MESSAGE,
  createClientSession,
  revokeAllClientSessions,
  revokeClientSession,
  rotateClientSession,
  type ClientSessionTokens,
} from "./portal.session.service.js";
import { verifyClientRefreshToken } from "./portal.token.js";

const GENERIC_LOGIN_FAILURE = "Invalid credentials";
const INVALID_INVITE = "This invitation is invalid or has expired";

// Verified against when no matching contact exists, so a missing
// account costs the same time as a wrong password.
const DUMMY_PASSWORD_HASH =
  "$argon2id$v=19$m=65536,p=4,t=3$+zozk9h7tiiOI2MoWA8bww$hBL8ckLWO2XjNaKNsF/5msZho3sLycMN05snNlgpxzE";

export interface SafeClientSelf {
  id: string;
  name: string;
  email: string;
  jobTitle: string | null;
  clientOrganizationName: string;
  organizationName: string;
  [key: string]: string | null;
}

export interface ClientAuthResult {
  contact: SafeClientSelf;
  tokens: ClientSessionTokens;
}

interface RequestMeta {
  userAgent: string | null;
  ipAddress: string | null;
}

async function toSafeSelf(contact: ClientContact): Promise<SafeClientSelf> {
  const [clientOrg, org] = await Promise.all([
    prisma.clientOrganization.findUnique({ where: { id: contact.clientOrganizationId }, select: { name: true } }),
    prisma.organization.findUnique({ where: { id: contact.organizationId }, select: { name: true } }),
  ]);
  return {
    id: contact.id,
    name: contact.name,
    email: contact.email,
    jobTitle: contact.jobTitle,
    clientOrganizationName: clientOrg?.name ?? "",
    organizationName: org?.name ?? "",
  };
}

export async function acceptClientInvite(
  input: { token: string; password: string } & RequestMeta,
): Promise<ClientAuthResult> {
  const tokenHash = hashToken(input.token);
  const candidate = await prisma.clientContact.findFirst({
    where: {
      inviteTokenHash: tokenHash,
      status: "INVITED",
      inviteExpiresAt: { gt: new Date() },
      organization: { deletedAt: null, status: "ACTIVE" },
      clientOrganization: { deletedAt: null },
    },
    select: { id: true },
  });
  if (!candidate) throw new AppError(INVALID_INVITE, 400);

  const passwordHash = await hashPassword(input.password);

  const tokens = await prisma.$transaction(async (tx) => {
    const t = tx as unknown as Pick<typeof prisma, "clientContact" | "clientSession">;

    // Conditional update makes the token genuinely one-time: of two
    // concurrent accepts, only one matches the row and gets count 1.
    const { count } = await t.clientContact.updateMany({
      where: { id: candidate.id, inviteTokenHash: tokenHash, status: "INVITED" },
      data: {
        passwordHash,
        status: "ACTIVE",
        inviteTokenHash: null,
        inviteExpiresAt: null,
        lastLoginAt: new Date(),
      },
    });
    if (count === 0) throw new AppError(INVALID_INVITE, 400);

    return createClientSession({
      contactId: candidate.id,
      userAgent: input.userAgent,
      ipAddress: input.ipAddress,
      createSessionRecord: (data) => t.clientSession.create({ data }),
    });
  });

  const contact = await prisma.clientContact.findUniqueOrThrow({ where: { id: candidate.id } });
  return { contact: await toSafeSelf(contact), tokens };
}

export async function loginClient(
  input: { organizationSlug: string; email: string; password: string } & RequestMeta,
): Promise<ClientAuthResult> {
  const organization = await prisma.organization.findFirst({
    where: { slug: input.organizationSlug, deletedAt: null, status: "ACTIVE" },
    select: { id: true },
  });
  const contact = organization
    ? await prisma.clientContact.findFirst({
        where: { organizationId: organization.id, email: normalizeEmail(input.email) },
      })
    : null;

  const passwordValid = await comparePassword(input.password, contact?.passwordHash ?? DUMMY_PASSWORD_HASH);

  const clientOrgActive = contact
    ? (await prisma.clientOrganization.count({ where: { id: contact.clientOrganizationId, deletedAt: null } })) > 0
    : false;

  if (!contact || !passwordValid || contact.status !== "ACTIVE" || contact.passwordHash === null || !clientOrgActive) {
    throw new AppError(GENERIC_LOGIN_FAILURE, 401);
  }

  const tokens = await createClientSession({
    contactId: contact.id,
    userAgent: input.userAgent,
    ipAddress: input.ipAddress,
    createSessionRecord: (data) => prisma.clientSession.create({ data }),
  });
  await prisma.clientContact.update({ where: { id: contact.id }, data: { lastLoginAt: new Date() } });

  return { contact: await toSafeSelf(contact), tokens };
}

export async function refreshClientSession(presented: string | undefined): Promise<ClientSessionTokens> {
  if (!presented) throw new AppError(CLIENT_REFRESH_FAILURE_MESSAGE, 401);
  const payload = await verifyClientRefreshToken(presented);
  return rotateClientSession({ sessionId: payload.sid, contactId: payload.sub, presentedRefreshToken: presented });
}

export async function logoutClient(presented: string | undefined): Promise<void> {
  if (!presented) return;
  try {
    const { sid } = await verifyClientRefreshToken(presented);
    await revokeClientSession(sid);
  } catch {
    // Idempotent: an invalid/expired token is already as logged out as it gets.
  }
}

export async function logoutAllClientSessions(contactId: string): Promise<void> {
  await revokeAllClientSessions(contactId);
}

export async function getClientSelf(contactId: string): Promise<SafeClientSelf> {
  const contact = await prisma.clientContact.findFirst({ where: { id: contactId, status: "ACTIVE" } });
  if (!contact) throw new AppError("Authentication required", 401);
  return toSafeSelf(contact);
}
