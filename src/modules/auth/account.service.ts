import { AppError } from "../../errors/AppError.js";
import { prisma } from "../../lib/prisma.js";
import { enqueueEmailQuietly } from "../email/email.queue.js";
import { comparePassword, hashPassword, normalizeEmail } from "./auth.utils.js";
import {
  consumeAuthToken,
  EMAIL_VERIFICATION_TTL_MS,
  issueAuthToken,
  PASSWORD_RESET_TTL_MS,
} from "./auth-token.service.js";

const INVALID_LINK_MESSAGE = "This link is invalid or has expired";

type Tx = Pick<typeof prisma, "user" | "session" | "authToken" | "membership" | "account">;

// ---------- Email verification ----------

/** Queues a fresh verification email. Never throws: a mail problem must not fail the caller. */
export async function sendVerificationEmail(user: { id: string; email: string; name: string }): Promise<void> {
  try {
    const token = await issueAuthToken(user.id, "EMAIL_VERIFICATION", EMAIL_VERIFICATION_TTL_MS);
    enqueueEmailQuietly({ type: "VERIFY_EMAIL", to: user.email, name: user.name, token });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("[auth] could not issue verification token:", error instanceof Error ? error.message : error);
  }
}

export async function verifyEmail(rawToken: string): Promise<void> {
  const ok = await prisma.$transaction(async (tx) => {
    const t = tx as unknown as Tx;
    const userId = await consumeAuthToken(t, rawToken, "EMAIL_VERIFICATION");
    if (!userId) return false;
    const { count } = await t.user.updateMany({
      where: { id: userId, deletedAt: null },
      data: { emailVerifiedAt: new Date() },
    });
    return count === 1;
  });
  if (!ok) throw new AppError(INVALID_LINK_MESSAGE, 400);
}

/** Authenticated. Returns whether a new email was sent (false = already verified). */
export async function resendVerification(userId: string): Promise<boolean> {
  const user = await prisma.user.findFirst({
    where: { id: userId, deletedAt: null },
    select: { id: true, email: true, name: true, emailVerifiedAt: true },
  });
  if (!user) throw new AppError("Authentication required", 401);
  if (user.emailVerifiedAt) return false;
  await sendVerificationEmail(user);
  return true;
}

// ---------- Forgot / reset password ----------

/**
 * Always resolves the same way whether or not the email belongs to an account,
 * so the endpoint cannot be used to discover who is registered. The mail itself
 * goes out through the queue, off the request path.
 */
export async function requestPasswordReset(rawEmail: string): Promise<void> {
  const user = await prisma.user.findFirst({
    where: { email: normalizeEmail(rawEmail), deletedAt: null, status: "ACTIVE" },
    select: { id: true, email: true, name: true },
  });
  if (!user) return;
  const token = await issueAuthToken(user.id, "PASSWORD_RESET", PASSWORD_RESET_TTL_MS);
  enqueueEmailQuietly({ type: "PASSWORD_RESET", to: user.email, name: user.name, token });
}

export async function resetPassword(rawToken: string, newPassword: string): Promise<void> {
  const passwordHash = await hashPassword(newPassword);
  const ok = await prisma.$transaction(async (tx) => {
    const t = tx as unknown as Tx;
    const userId = await consumeAuthToken(t, rawToken, "PASSWORD_RESET");
    if (!userId) return false;

    const user = await t.user.findFirst({
      where: { id: userId, deletedAt: null, status: "ACTIVE" },
      select: { id: true, emailVerifiedAt: true },
    });
    if (!user) return false;

    await t.user.update({
      where: { id: userId },
      // Following the link proves control of the mailbox.
      data: { passwordHash, emailVerifiedAt: user.emailVerifiedAt ?? new Date() },
    });
    // Whoever had a session before the reset (possibly an attacker) is signed out.
    await t.session.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
    return true;
  });
  if (!ok) throw new AppError(INVALID_LINK_MESSAGE, 400);
}

// ---------- Change password ----------

export async function changePassword(userId: string, currentPassword: string, newPassword: string): Promise<void> {
  const user = await prisma.user.findFirst({
    where: { id: userId, deletedAt: null },
    select: { id: true, passwordHash: true },
  });
  if (!user) throw new AppError("Authentication required", 401);
  if (!user.passwordHash) {
    throw new AppError("This account has no password yet. Use \"forgot password\" to set one.", 400);
  }
  if (!(await comparePassword(currentPassword, user.passwordHash))) {
    throw new AppError("Current password is incorrect", 400);
  }
  if (await comparePassword(newPassword, user.passwordHash)) {
    throw new AppError("The new password must be different from the current one", 400);
  }

  const passwordHash = await hashPassword(newPassword);
  await prisma.$transaction(async (tx) => {
    const t = tx as unknown as Tx;
    await t.user.update({ where: { id: userId }, data: { passwordHash } });
    await t.session.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
  });
}

// ---------- Sessions ----------

export interface SessionView {
  id: string;
  userAgent: string | null;
  ipAddress: string | null;
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string;
  current: boolean;
  [key: string]: string | boolean | null;
}

export async function listActiveSessions(userId: string, currentSessionId: string): Promise<SessionView[]> {
  const rows = await prisma.session.findMany({
    where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: "desc" },
    select: { id: true, userAgent: true, ipAddress: true, createdAt: true, lastUsedAt: true, expiresAt: true },
  });
  return rows.map((s) => ({
    id: s.id,
    userAgent: s.userAgent,
    ipAddress: s.ipAddress,
    createdAt: s.createdAt.toISOString(),
    lastUsedAt: s.lastUsedAt ? s.lastUsedAt.toISOString() : null,
    expiresAt: s.expiresAt.toISOString(),
    current: s.id === currentSessionId,
  }));
}

/** Only ever touches the caller's own sessions; someone else's id is simply "not found". */
export async function revokeOwnSession(userId: string, sessionId: string): Promise<void> {
  const { count } = await prisma.session.updateMany({
    where: { id: sessionId, userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  if (count === 0) throw new AppError("Session not found", 404);
}

// ---------- Account deletion (soft) ----------

export async function deleteAccount(userId: string, password: string | undefined): Promise<void> {
  const user = await prisma.user.findFirst({
    where: { id: userId, deletedAt: null },
    select: { id: true, passwordHash: true },
  });
  if (!user) throw new AppError("Authentication required", 401);

  if (user.passwordHash) {
    if (!password || !(await comparePassword(password, user.passwordHash))) {
      throw new AppError("Password is incorrect", 400);
    }
  }

  const owned = await prisma.organization.findFirst({
    where: { ownerId: userId, deletedAt: null },
    select: { name: true },
  });
  if (owned) {
    throw new AppError(
      `You still own the organization "${owned.name}". Delete it or transfer ownership before deleting your account.`,
      409,
    );
  }

  const now = new Date();
  await prisma.$transaction(async (tx) => {
    const t = tx as unknown as Tx;
    await t.user.update({
      where: { id: userId },
      data: {
        deletedAt: now,
        // Frees the address for a future sign-up; the name stays so history
        // (comments, audit trail) keeps a readable author.
        email: `deleted-${userId}@deleted.invalid`,
        passwordHash: null,
        avatarUrl: null,
      },
    });
    await t.membership.updateMany({
      where: { userId, status: "ACTIVE" },
      data: { status: "REMOVED", removedAt: now },
    });
    await t.session.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: now } });
    await t.account.deleteMany({ where: { userId } });
    await t.authToken.deleteMany({ where: { userId } });
  });
}
