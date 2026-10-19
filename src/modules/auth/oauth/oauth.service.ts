import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { AppError } from "../../../errors/AppError.js";
import { Prisma } from "../../../generated/prisma/client.js";
import { prisma } from "../../../lib/prisma.js";
import { normalizeEmail } from "../auth.utils.js";
import { createAuthSession } from "../session.service.js";
import {
  exchangeCode,
  getProvider,
  redirectUriFor,
  type OAuthProfile,
  type OAuthProviderId,
} from "./oauth.providers.js";

/** Machine-readable reasons handed to the frontend in the redirect; never free text from a provider. */
export type OAuthErrorCode =
  | "access_denied"
  | "invalid_state"
  | "email_not_verified"
  | "account_disabled"
  | "oauth_failed";

export class OAuthFlowError extends Error {
  constructor(public readonly code: OAuthErrorCode) {
    super(code);
  }
}

const base64Url = (buffer: Buffer): string => buffer.toString("base64url");

export interface OAuthStart {
  authorizeUrl: string;
  /** Opaque value for the short-lived HttpOnly cookie that binds this browser to this attempt. */
  cookieValue: string;
}

/** Step 1: builds the provider URL. `state` blocks login-CSRF, PKCE blocks code interception. */
export function startOAuth(providerId: OAuthProviderId): OAuthStart {
  const provider = getProvider(providerId);
  const config = provider.config();
  if (!config) throw new AppError("This sign-in method is not available", 503);

  const state = base64Url(randomBytes(32));
  const codeVerifier = base64Url(randomBytes(48));
  const codeChallenge = base64Url(createHash("sha256").update(codeVerifier).digest());

  const url = new URL(provider.authorizeUrl);
  url.search = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: redirectUriFor(providerId),
    response_type: "code",
    scope: provider.scope,
    state,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
  }).toString();

  return { authorizeUrl: url.toString(), cookieValue: `${providerId}.${state}.${codeVerifier}` };
}

function sameString(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

interface SessionMeta {
  userAgent: string | null;
  ipAddress: string | null;
}

/**
 * Step 2: validates state against the cookie, exchanges the code, resolves the
 * local user and opens a normal session. Any failure becomes an OAuthFlowError
 * with a fixed code.
 */
export async function completeOAuth(input: {
  providerId: OAuthProviderId;
  code: string | undefined;
  state: string | undefined;
  providerError: string | undefined;
  cookieValue: string | undefined;
  meta: SessionMeta;
}): Promise<{ refreshToken: string }> {
  const [cookieProvider, cookieState, codeVerifier] = (input.cookieValue ?? "").split(".");
  if (
    !input.state ||
    !cookieState ||
    !codeVerifier ||
    cookieProvider !== input.providerId ||
    !sameString(input.state, cookieState)
  ) {
    throw new OAuthFlowError("invalid_state");
  }
  if (input.providerError) throw new OAuthFlowError("access_denied");
  if (!input.code) throw new OAuthFlowError("oauth_failed");

  let profile: OAuthProfile;
  try {
    const accessToken = await exchangeCode(input.providerId, input.code, codeVerifier);
    profile = await getProvider(input.providerId).fetchProfile(accessToken);
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error(`[oauth] ${input.providerId} exchange failed:`, error instanceof Error ? error.message : "unknown");
    throw new OAuthFlowError("oauth_failed");
  }

  let userId: string;
  try {
    userId = await resolveUser(input.providerId, profile);
  } catch (error) {
    if (error instanceof OAuthFlowError) throw error;
    // eslint-disable-next-line no-console
    console.error("[oauth] could not resolve user:", error instanceof Error ? error.message : "unknown");
    throw new OAuthFlowError("oauth_failed");
  }

  const session = await createAuthSession({
    userId,
    userAgent: input.meta.userAgent,
    ipAddress: input.meta.ipAddress,
    createSessionRecord: (data) => prisma.session.create({ data }),
  });
  return { refreshToken: session.refreshToken };
}

type Tx = Pick<typeof prisma, "user" | "account" | "session">;

/**
 * Decides which local user this provider identity is.
 *  1. Known (provider, id) pair → that user, whatever email the provider shows now.
 *  2. Otherwise the provider MUST vouch for the email; without that we neither
 *     link to an existing account nor create one.
 *  3. Verified email matches an existing user → link. Matches nobody → create.
 */
async function resolveUser(providerId: OAuthProviderId, profile: OAuthProfile): Promise<string> {
  const dbProvider = getProvider(providerId).dbProvider;

  const linked = await prisma.account.findUnique({
    where: { provider_providerAccountId: { provider: dbProvider, providerAccountId: profile.providerAccountId } },
    select: { user: { select: { id: true, status: true, deletedAt: true } } },
  });
  if (linked) {
    if (linked.user.deletedAt !== null || linked.user.status !== "ACTIVE") throw new OAuthFlowError("account_disabled");
    return linked.user.id;
  }

  if (!profile.email || !profile.emailVerified) throw new OAuthFlowError("email_not_verified");
  const email = normalizeEmail(profile.email);

  try {
    return await prisma.$transaction(async (tx) => {
      const t = tx as unknown as Tx;
      const existing = await t.user.findFirst({
        where: { email, deletedAt: null },
        select: { id: true, status: true, emailVerifiedAt: true },
      });

      if (existing) {
        if (existing.status !== "ACTIVE") throw new OAuthFlowError("account_disabled");
        await t.account.create({
          data: { userId: existing.id, provider: dbProvider, providerAccountId: profile.providerAccountId },
        });
        if (existing.emailVerifiedAt === null) {
          // Pre-hijacking defence: this account was created with a password by
          // someone who never proved they own the mailbox — possibly an attacker
          // who registered the victim's address in advance. The real owner has now
          // proven it via the provider, so the unproven password and any sessions
          // opened with it are discarded (the owner can set a new one by reset).
          await t.user.update({ where: { id: existing.id }, data: { emailVerifiedAt: new Date(), passwordHash: null } });
          await t.session.updateMany({ where: { userId: existing.id, revokedAt: null }, data: { revokedAt: new Date() } });
        }
        return existing.id;
      }

      const created = await t.user.create({
        data: {
          email,
          name: profile.name.trim() || email.split("@")[0] || "User",
          avatarUrl: profile.avatarUrl,
          emailVerifiedAt: new Date(),
          accounts: { create: { provider: dbProvider, providerAccountId: profile.providerAccountId } },
        },
        select: { id: true },
      });
      return created.id;
    });
  } catch (error) {
    // A concurrent callback created the same user/account first; the user just retries.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new OAuthFlowError("oauth_failed");
    }
    throw error;
  }
}
