import type { Membership, Organization } from "../../generated/prisma/client.js";

/**
 * The authenticated user's active-membership context for whichever
 * :organizationId the current request is scoped to. Populated by
 * loadOrganizationContext() — see rbac.middleware.ts — after it has
 * verified (against the database, not a JWT claim) that the user
 * has an active Membership in a non-deleted, non-suspended
 * Organization.
 *
 * Kept as the full Prisma Membership/Organization rows (not a
 * trimmed-down shape) since this is internal request context, never
 * sent directly to the client — routes build their own safe
 * response shapes from it.
 */
export interface OrganizationRequestContext {
  organization: Organization;
  membership: Membership;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      orgContext?: OrganizationRequestContext;
    }
  }
}
