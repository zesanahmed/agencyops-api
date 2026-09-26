import { z } from "zod";

const PROJECT_STATUS = ["PLANNING", "ACTIVE", "ON_HOLD", "COMPLETED", "CANCELLED"] as const;

export const createProjectSchema = z
  .object({
    name: z.string().trim().min(1, "Name is required").max(200, "Name is too long"),
    slug: z
      .string()
      .trim()
      .toLowerCase()
      .regex(/^[a-z0-9-]+$/, "Slug may only contain lowercase letters, numbers, and hyphens")
      .max(100)
      .optional(),
    description: z.string().trim().max(5000).optional(),
    status: z.enum(PROJECT_STATUS).optional(),
    startDate: z.coerce.date().optional(),
    dueDate: z.coerce.date().optional(),
  })
  .refine((v) => !v.startDate || !v.dueDate || v.dueDate >= v.startDate, {
    message: "dueDate must be on or after startDate",
    path: ["dueDate"],
  });

export const updateProjectSchema = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    slug: z
      .string()
      .trim()
      .toLowerCase()
      .regex(/^[a-z0-9-]+$/, "Slug may only contain lowercase letters, numbers, and hyphens")
      .max(100)
      .optional(),
    description: z.string().trim().max(5000).optional(),
    status: z.enum(PROJECT_STATUS).optional(),
    startDate: z.coerce.date().optional(),
    dueDate: z.coerce.date().optional(),
  })
  .refine((v) => !v.startDate || !v.dueDate || v.dueDate >= v.startDate, {
    message: "dueDate must be on or after startDate",
    path: ["dueDate"],
  });

export const projectIdParamSchema = z.object({
  projectId: z.string().uuid("Invalid project id"),
});

export const projectListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  status: z.enum(PROJECT_STATUS).optional(),
  search: z.string().trim().max(200).optional(),
  sortBy: z.enum(["createdAt", "name", "dueDate"]).default("createdAt"),
  sortOrder: z.enum(["asc", "desc"]).default("desc"),
});

export const assignProjectTeamSchema = z.object({
  teamId: z.string().uuid("Invalid team id"),
});

export const projectTeamIdParamSchema = z.object({
  projectTeamId: z.string().uuid("Invalid project-team id"),
});

export const addProjectMemberSchema = z.object({
  membershipId: z.string().uuid("Invalid membership id"),
});

export const projectMemberIdParamSchema = z.object({
  projectMemberId: z.string().uuid("Invalid project-member id"),
});

export type CreateProjectBody = z.infer<typeof createProjectSchema>;
export type UpdateProjectBody = z.infer<typeof updateProjectSchema>;
export type ProjectListQuery = z.infer<typeof projectListQuerySchema>;
export type AssignProjectTeamBody = z.infer<typeof assignProjectTeamSchema>;
export type AddProjectMemberBody = z.infer<typeof addProjectMemberSchema>;
