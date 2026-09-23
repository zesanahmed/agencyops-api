import { AppError } from "../../errors/AppError.js";
import { prisma } from "../../lib/prisma.js";
import type { User, UserStatus } from "../../generated/prisma/client.js";
import { Prisma } from "../../generated/prisma/client.js";
import { comparePassword, hashPassword, normalizeEmail } from "./auth.utils.js";
import {
  createAuthSession,
  REFRESH_FAILURE_MESSAGE,
  revokeAllUserSessions,
  revokeSession,
  rotateAuthSession,
} from "./session.service.js";
import { verifyRefreshToken } from "./token.service.js";

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

type SafeUserSource = Pick<
  User,
  "id" | "name" | "email" | "avatarUrl" | "status" | "emailVerifiedAt"
>;

function toSafeUser(user: SafeUserSource): SafeUser {
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

const DUMMY_PASSWORD_HASH =
  "$argon2id$v=19$m=65536,p=4,t=3$+zozk9h7tiiOI2MoWA8bww$hBL8ckLWO2XjNaKNsF/5msZho3sLycMN05snNlgpxzE";

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

export async function registerUser(input: RegisterInput): Promise<AuthResult> {
  const name = input.name.trim();
  const email = normalizeEmail(input.email);

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
    if (isEmailUniqueConstraintError(error)) {
      throw new AppError(DUPLICATE_EMAIL_MESSAGE, 409);
    }
    throw error;
  }
}

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

export interface RefreshResult {
  accessToken: string;
  refreshToken: string;
}

export async function refreshAuthSession(
  presentedRefreshToken: string | undefined,
): Promise<RefreshResult> {
  if (!presentedRefreshToken) {
    throw new AppError(REFRESH_FAILURE_MESSAGE, 401);
  }

  const payload = await verifyRefreshToken(presentedRefreshToken);

  const { accessToken, refreshToken } = await rotateAuthSession({
    sessionId: payload.sid,
    userId: payload.sub,
    presentedRefreshToken,
  });

  return { accessToken, refreshToken };
}

export async function logoutCurrentSession(
  presentedRefreshToken: string | undefined,
): Promise<void> {
  if (!presentedRefreshToken) {
    return;
  }

  let sessionId: string;
  try {
    ({ sid: sessionId } = await verifyRefreshToken(presentedRefreshToken));
  } catch {
    return;
  }

  await revokeSession(sessionId);
}

export async function logoutAllSessions(userId: string): Promise<void> {
  await revokeAllUserSessions(userId);
}

export async function getCurrentUser(userId: string): Promise<SafeUser> {
  const user = await prisma.user.findFirst({
    where: { id: userId, deletedAt: null },
    select: {
      id: true,
      name: true,
      email: true,
      avatarUrl: true,
      status: true,
      emailVerifiedAt: true,
    },
  });

  if (!user) {
    throw new AppError("Authentication required", 401);
  }

  return toSafeUser(user);
}
