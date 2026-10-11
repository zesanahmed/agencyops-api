import { z } from "zod";

const nameSchema = z.string().trim().min(2, "Name must be at least 2 characters").max(150);
const emailSchema = z.string().trim().toLowerCase().email("Enter a valid email").max(254);

export const createClientSchema = z.object({
  name: nameSchema,
  website: z.string().trim().url("Enter a valid URL").max(2048).optional(),
  notes: z.string().trim().max(5000).optional(),
});

export const updateClientSchema = z
  .object({
    name: nameSchema.optional(),
    website: z.string().trim().url("Enter a valid URL").max(2048).nullable().optional(),
    notes: z.string().trim().max(5000).nullable().optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), {
    message: "At least one field is required",
  });

export const clientListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().trim().max(200).optional(),
  sortBy: z.enum(["createdAt", "name"]).default("createdAt"),
  sortOrder: z.enum(["asc", "desc"]).default("desc"),
});

export const createContactSchema = z.object({
  name: nameSchema,
  email: emailSchema,
  jobTitle: z.string().trim().max(150).optional(),
});

export const updateContactSchema = z
  .object({
    name: nameSchema.optional(),
    jobTitle: z.string().trim().max(150).nullable().optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), {
    message: "At least one field is required",
  });

export const linkProjectSchema = z.object({
  projectId: z.string().uuid("Invalid project id"),
});

export const grantAccessSchema = z.object({
  projectId: z.string().uuid("Invalid project id"),
});

export const clientIdParamSchema = z.object({
  clientId: z.string().uuid("Invalid client id"),
});

export const contactIdParamSchema = z.object({
  contactId: z.string().uuid("Invalid contact id"),
});

export const projectIdParamSchema = z.object({
  projectId: z.string().uuid("Invalid project id"),
});

export type CreateClientBody = z.infer<typeof createClientSchema>;
export type UpdateClientBody = z.infer<typeof updateClientSchema>;
export type ClientListQuery = z.infer<typeof clientListQuerySchema>;
export type CreateContactBody = z.infer<typeof createContactSchema>;
export type UpdateContactBody = z.infer<typeof updateContactSchema>;
