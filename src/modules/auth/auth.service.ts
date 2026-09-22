import { AppError } from "../../errors/AppError.js";
import { prisma } from "../../lib/prisma.js";
import type { User, UserStatus } from "../../generated/prisma/client.js";
import { Prisma } from "../../generated/prisma/client.js";
import { comparePassword, hashPassword, normalizeEmail } from "./auth.utils.js";
import { createAuthSession } from "./session.service.js";

export interface RegisterInput {
  name: string;
  email: string;
  password: string;
  userAgent: string | null;
  ipAddress: string | null;
}

export interface LoginInput {
  email: string;
  password: string;
  userAgent: string | null;
  ipAddress: string | null;
}

/**
 * Safe user shape returned by the API — never passwordHash or any
 * other internal field. The index signature is what lets this be
 * passed straight into sendSuccess()'s JsonValue-constrained data
 * param — a plain named interface without one isn't structurally
 * assignable to an indexed type when it goes through generic
 * constraint checking, even though every field here is already a
 * JsonValue on its own.
 */
export interface SafeUser {
  id: string;
  name: string;
  email: string;
  avatarUrl: string | null;
  status: UserStatus;
  /** ISO string, not a Date — this is the actual wire/JSON format. */
  emailVerifiedAt: string | null;
  [key: string]: string | null;
}

export interface AuthResult {
  user: SafeUser;
  accessToken: string;
  refreshToken: string;
}

function toSafeUser(user: User): SafeUser {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    avatarUrl: user.avatarUrl,
    status: user.status,
    emailVerifiedAt: user.emailVerifiedAt
      ? user.emailVerifiedAt.toISOString()
      : null,
  };
}

const DUPLICATE_EMAIL_MESSAGE = "An account with this email already exists";
const GENERIC_LOGIN_FAILURE_MESSAGE = "Invalid email or password";

/**
 * A precomputed, valid-format Argon2id hash of an arbitrary fixed
 * string — not a real password hash for any real account. Used only
 * so comparePassword() always has *something* to hash against, even
 * when no matching user was found. See loginUser() for why.
 */
const DUMMY_PASSWORD_HASH =
  "$argon2id$v=19$m=65536,p=4,t=3$+zozk9h7tiiOI2MoWA8bww$hBL8ckLWO2XjNaKNsF/5msZho3sLycMN05snNlgpxzE";

/**
 * Explicit type guard rather than an inline `instanceof` check.
 * Prisma's PrismaClientKnownRequestError is declared in the
 * generated client as a const+type pair re-exported through a
 * namespace (Prisma, from internal/prismaNamespace.ts via
 * client.ts's `export { Prisma }`) — accessed through that many
 * layers of re-export, TypeScript's control-flow narrowing for a
 * bare `error instanceof Prisma.PrismaClientKnownRequestError`
 * inside a chained boolean expression didn't reliably narrow
 * `error` away from `unknown` (see the milestone report for the
 * exact symptom). Isolating the check in one function with an
 * explicit `error is Prisma.PrismaClientKnownRequestError`
 * predicate makes the narrowing exact and guaranteed at every call
 * site, regardless of that inference gap.
 */
function isPrismaKnownRequestError(
  error: unknown,
): error is Prisma.PrismaClientKnownRequestError {
  return error instanceof Prisma.PrismaClientKnownRequestError;
}

function isEmailUniqueConstraintError(error: unknown): boolean {
  if (!isPrismaKnownRequestError(error)) {
    return false;
  }
  return (
    error.code === "P2002" && (error.meta?.target?.includes("email") ?? false)
  );
}

/**
 * Registers a new user and immediately creates their first session
 * (register implies being logged in — matches the milestone's
 * "register → session creation" flow).
 *
 * User creation + session creation run inside one Prisma
 * transaction, so a failure partway through can't leave a User row
 * with no session, or any other inconsistent state.
 */
export async function registerUser(input: RegisterInput): Promise<AuthResult> {
  const name = input.name.trim();
  const email = normalizeEmail(input.email);

  // Explicit pre-check for the common case (see the milestone report
  // for the one edge case this doesn't fully cover, and the
  // try/catch below that backstops it).
  const existing = await prisma.user.findFirst({
    where: { email, deletedAt: null },
    select: { id: true },
  });
  if (existing) {
    throw new AppError(DUPLICATE_EMAIL_MESSAGE, 409);
  }

  const passwordHash = await hashPassword(input.password);

  try {
    const { user, session } = await prisma.$transaction(async (tx) => {
      const txClient = tx as unknown as Pick<typeof prisma, "user" | "session">;
      const createdUser = await txClient.user.create({
        data: { name, email, passwordHash },
      });

      const createdSession = await createAuthSession({
        userId: createdUser.id,
        userAgent: input.userAgent,
        ipAddress: input.ipAddress,
        createSessionRecord: (data) => txClient.session.create({ data }),
      });

      return { user: createdUser, session: createdSession };
    });

    return {
      user: toSafeUser(user),
      accessToken: session.accessToken,
      refreshToken: session.refreshToken,
    };
  } catch (error) {
    // Defense in depth: the pre-check above handles the common case
    // (an ACTIVE or previously-registered-and-still-present user),
    // but User.email is a globally unique DB constraint with no
    // carve-out for soft-deleted rows — see the milestone report for
    // why, and why fixing that at the schema level is deliberately
    // out of scope here. This catches the remaining edge case (email
    // belongs to a soft-deleted user, or a genuine race) and returns
    // the same 409 instead of an unhandled 500.
    if (isEmailUniqueConstraintError(error)) {
      throw new AppError(DUPLICATE_EMAIL_MESSAGE, 409);
    }
    throw error;
  }
}

/**
 * Logs a user in. Returns a generic 401 for every ineligible case —
 * unknown email, wrong password, suspended account, soft-deleted
 * account — on purpose, so none of those can be distinguished from
 * the outside by response content.
 *
 * Timing note: comparePassword() is always called, even when no
 * user was found (against a fixed dummy hash) — see
 * DUMMY_PASSWORD_HASH above. Short-circuiting on `!user` before
 * calling comparePassword would make "no such account" respond
 * measurably faster than "wrong password" (Argon2 is deliberately
 * slow), which would leak exactly the "does this email exist"
 * information the generic error message is trying to hide, just
 * through timing instead of content.
 */
export async function loginUser(input: LoginInput): Promise<AuthResult> {
  const email = normalizeEmail(input.email);

  const user = await prisma.user.findFirst({ where: { email } });

  const passwordIsValid = await comparePassword(
    input.password,
    user?.passwordHash ?? DUMMY_PASSWORD_HASH,
  );

  const isEligible =
    user !== null &&
    user.deletedAt === null &&
    user.status === "ACTIVE" &&
    user.passwordHash !== null;

  if (!isEligible || !passwordIsValid || !user) {
    throw new AppError(GENERIC_LOGIN_FAILURE_MESSAGE, 401);
  }

  const session = await createAuthSession({
    userId: user.id,
    userAgent: input.userAgent,
    ipAddress: input.ipAddress,
    createSessionRecord: (data) => prisma.session.create({ data }),
  });

  return {
    user: toSafeUser(user),
    accessToken: session.accessToken,
    refreshToken: session.refreshToken,
  };
}
