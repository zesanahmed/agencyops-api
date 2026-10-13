import { z } from "zod";

const MAX_CENTS = 2_000_000_000; // stays inside Postgres INT

const itemSchema = z.object({
  description: z.string().trim().min(1, "Description is required").max(500),
  quantity: z.number().int().min(1).max(100_000),
  unitAmountCents: z.number().int().min(0).max(MAX_CENTS),
});

const currencySchema = z
  .string()
  .trim()
  .regex(/^[a-zA-Z]{3}$/, "Currency must be a 3-letter code")
  .transform((v) => v.toLowerCase());

const dateSchema = z.coerce.date();
const cents = z.number().int().min(0).max(MAX_CENTS);

export const createInvoiceSchema = z
  .object({
    clientId: z.string().uuid("Invalid client id"),
    projectId: z.string().uuid("Invalid project id").optional(),
    issueDate: dateSchema,
    dueDate: dateSchema,
    currency: currencySchema.default("usd"),
    taxCents: cents.default(0),
    discountCents: cents.default(0),
    notes: z.string().trim().max(5000).optional(),
    items: z.array(itemSchema).min(1, "At least one item is required").max(50),
  })
  .refine((v) => v.dueDate >= v.issueDate, { message: "dueDate must not be before issueDate", path: ["dueDate"] });

export const updateInvoiceSchema = z
  .object({
    projectId: z.string().uuid("Invalid project id").nullable().optional(),
    issueDate: dateSchema.optional(),
    dueDate: dateSchema.optional(),
    currency: currencySchema.optional(),
    taxCents: cents.optional(),
    discountCents: cents.optional(),
    notes: z.string().trim().max(5000).nullable().optional(),
    items: z.array(itemSchema).min(1).max(50).optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), { message: "At least one field is required" });

export const invoiceListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  clientId: z.string().uuid().optional(),
  projectId: z.string().uuid().optional(),
  status: z.enum(["DRAFT", "OPEN", "PAID", "VOID"]).optional(),
});

export const invoiceIdParamSchema = z.object({ invoiceId: z.string().uuid("Invalid invoice id") });

export type CreateInvoiceBody = z.infer<typeof createInvoiceSchema>;
export type UpdateInvoiceBody = z.infer<typeof updateInvoiceSchema>;
export type InvoiceListQuery = z.infer<typeof invoiceListQuerySchema>;
