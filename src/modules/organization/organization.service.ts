import { AppError } from "../../errors/AppError.js";
import { prisma } from "../../lib/prisma.js";
import { Prisma } from "../../generated/prisma/client.js";
import {
  toSafeMembership,
  toSafeOrganization,
  type SafeMembership,
  type SafeOrganization,
} from "./organization.mappers.js";
import type { UpdateOrganizationBody } from "./organization.validation.js";

const SLUG_CONFLICT_MESSAGE = "An organization with this slug already exists";

/** Same reasoning/pattern as isPrismaKnownRequestError in auth.service.ts. */
function isPrismaKnownRequestError(
  error: unknown,
): error is Prisma.PrismaClientKnownRequestError {
  return error instanceof Prisma.PrismaClientKnownRequestError;
}

function isSlugUniqueConstraintError(error: unknown): boolean {
  if (!isPrismaKnownRequestError(error)) {
    return false;
  }
  return (
    error.code === "P2002" && ((error.meta as { target?: string[] } | undefined)?.target?.includes("slug") ?? false)
  );
}

/**
 * Lowercases and strips a name down to the same alphabet the slug
 * validator (SLUG_PATTERN in organization.validation.ts) accepts:
 * lowercase letters/digits, single hyphens between segments.
 */
function slugify(name: string): string {
  const base = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return base.length > 0 ? base : "org";
}

/**
 * Generates a slug guaranteed unique at the time of the check by
 * appending a short random suffix on collision. A handful of bounded
 * attempts is enough that a real collision loop is effectively
 * impossible — this isn't trying to be a globally coordinated slug
 * allocator, just a best-effort generator backstopped by the
 * database's own unique constraint (see the P2002 catch in
 * createOrganization below for the actual race-safety net).
 */
async function generateUniqueSlug(name: string): Promise<string> {
  const base = slugify(name);

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const candidate =
      attempt === 0 ? base : `${base}-${Math.random().toString(36).slice(2, 8)}`;

    const existing = await prisma.organization.findUnique({
      where: { slug: candidate },
      select: { id: true },
    });
    if (!existing) {
      return candidate;
    }
  }

  throw new AppError("Could not generate a unique organization slug", 500);
}

export interface CreateOrganizationInput {
  name: string;
  logoUrl?: string;
  ownerId: string;
}

export interface CreateOrganizationResult {
  organization: SafeOrganization;
  membership: SafeMembership;
}

/**
 * Creates an Organization and its OWNER Membership atomically — a
 * failure partway through must never leave an Organization with no
 * owner Membership, or vice versa.
 *
 * `ownerId` always comes from the authenticated request (see
 * organization.controller.ts), never from the request body — the
 * client cannot choose who owns the organization, and there is no
 * separate "set membership role" input here at all, so OWNER can
 * never be assigned through this or any other endpoint besides
 * organization creation.
 */
export async function createOrganization(
  input: CreateOrganizationInput,
): Promise<CreateOrganizationResult> {
  const slug = await generateUniqueSlug(input.name);

  try {
    const { organization, membership } = await prisma.$transaction(
      async (tx) => {
        // Same reasoning as the identical cast in
        // auth.service.ts/registerUser: session.service.ts's
        // comment on createSessionRecord explains why a Prisma
        // transaction-client type is never named directly in this
        // project.
        const txClient = tx as unknown as Pick<
          typeof prisma,
          "organization" | "membership"
        >;

        const createdOrganization = await txClient.organization.create({
          data: {
            name: input.name,
            slug,
            logoUrl: input.logoUrl ?? null,
            ownerId: input.ownerId,
          },
        });

        const createdMembership = await txClient.membership.create({
          data: {
            userId: input.ownerId,
            organizationId: createdOrganization.id,
            role: "OWNER",
          },
        });

        return { organization: createdOrganization, membership: createdMembership };
      },
    );

    return {
      organization: toSafeOrganization(organization),
      membership: toSafeMembership(membership),
    };
  } catch (error) {
    // Defense in depth against the rare race where generateUniqueSlug's
    // own check passed but another request claimed the same slug
    // first — same backstop pattern as auth.service.ts's duplicate
    // email handling.
    if (isSlugUniqueConstraintError(error)) {
      throw new AppError(SLUG_CONFLICT_MESSAGE, 409);
    }
    throw error;
  }
}

export interface ListOrganizationsInput {
  userId: string;
  page: number;
  limit: number;
}

export interface ListOrganizationsResult {
  organizations: SafeOrganization[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
}

/**
 * Lists organizations the user has an active Membership in.
 * Deliberately queries Membership first (not Organization) — the
 * user's access is defined by membership, so that's the table that
 * decides which rows are even visible, never a client-supplied
 * filter on Organization directly.
 */
export async function listUserOrganizations(
  input: ListOrganizationsInput,
): Promise<ListOrganizationsResult> {
  const where = {
    userId: input.userId,
    status: "ACTIVE" as const,
    organization: { deletedAt: null },
  };

  const memberships: Prisma.MembershipGetPayload<{
    include: { organization: true };
  }>[] = await prisma.membership.findMany({
    where,
    include: { organization: true },
    orderBy: { joinedAt: "desc" },
    skip: (input.page - 1) * input.limit,
    take: input.limit,
  });
  const total = await prisma.membership.count({ where });

  return {
    organizations: memberships.map((m) => toSafeOrganization(m.organization)),
    pagination: {
      page: input.page,
      limit: input.limit,
      total,
      totalPages: Math.ceil(total / input.limit),
    },
  };
}

/**
 * Updates organization settings. The caller (organization.controller.ts)
 * has already gone through loadOrganizationContext + requirePermission
 * ("organization:update", OWNER-only) — this function only performs
 * the write and translates a slug conflict into a clean 409.
 */
export async function updateOrganization(
  organizationId: string,
  body: UpdateOrganizationBody,
): Promise<SafeOrganization> {
  try {
    const updated = await prisma.organization.update({
      where: { id: organizationId },
      data: {
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.slug !== undefined ? { slug: body.slug } : {}),
        ...(body.logoUrl !== undefined ? { logoUrl: body.logoUrl } : {}),
      },
    });
    return toSafeOrganization(updated);
  } catch (error) {
    if (isSlugUniqueConstraintError(error)) {
      throw new AppError(SLUG_CONFLICT_MESSAGE, 409);
    }
    throw error;
  }
}

/**
 * Soft-deletes/deactivates an organization — sets `deletedAt` only,
 * same pattern already used for User. Never a physical delete.
 */
export async function deleteOrganization(
  organizationId: string,
): Promise<void> {
  await prisma.organization.update({
    where: { id: organizationId },
    data: { deletedAt: new Date() },
  });
}
