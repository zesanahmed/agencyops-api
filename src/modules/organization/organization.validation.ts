import { z } from "zod";

/**
 * Slug format: lowercase letters/digits, single hyphens between
 * segments, no leading/trailing/doubled hyphen. Validation only —
 * generating a slug from a name (lowercasing, stripping invalid
 * characters) happens explicitly in organization.service.ts, not as
 * a schema transform, matching this project's existing convention
 * of keeping normalization visible in the service layer (see
 * normalizeEmail() in auth.utils.ts).
 */
const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

const nameSchema = z
  .string()
  .trim()
  .min(2, "Name must be at least 2 characters")
  .max(150, "Name is too long");

const slugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(2, "Slug must be at least 2 characters")
  .max(150, "Slug is too long")
  .regex(
    SLUG_PATTERN,
    "Slug may only contain lowercase letters, numbers, and single hyphens",
  );

const logoUrlSchema = z.string().trim().url("Enter a valid URL").max(2048);

export const createOrganizationSchema = z.object({
  name: nameSchema,
  logoUrl: logoUrlSchema.optional(),
});

export const updateOrganizationSchema = z
  .object({
    name: nameSchema.optional(),
    slug: slugSchema.optional(),
    logoUrl: logoUrlSchema.nullable().optional(),
  })
  .refine((body) => Object.keys(body).length > 0, {
    message: "At least one field must be provided",
  });

export const organizationIdParamSchema = z.object({
  organizationId: z.string().uuid("Invalid organization id"),
});

export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export type CreateOrganizationBody = z.infer<typeof createOrganizationSchema>;
export type UpdateOrganizationBody = z.infer<typeof updateOrganizationSchema>;
export type OrganizationIdParams = z.infer<typeof organizationIdParamSchema>;
export type PaginationQuery = z.infer<typeof paginationQuerySchema>;
