import type { Request, Response } from "express";
import { sendSuccess } from "../../lib/apiResponse.js";
import {
  createInvoice,
  createPortalCheckout,
  getInvoice,
  getPortalInvoice,
  listInvoices,
  listPortalInvoices,
  requestInvoicePdf,
  sendInvoice,
  updateInvoice,
  voidInvoice,
  type InvoiceActor,
} from "./invoice.service.js";
import type { CreateInvoiceBody, InvoiceListQuery, UpdateInvoiceBody } from "./invoice.validation.js";

const orgId = (req: Request): string => req.orgContext!.organization.id;
const invoiceId = (req: Request): string => (req.params as { invoiceId: string }).invoiceId;

function actor(req: Request): InvoiceActor {
  const ua = req.headers["user-agent"];
  return {
    membershipId: req.orgContext!.membership.id,
    ipAddress: req.ip ?? null,
    userAgent: typeof ua === "string" ? ua : null,
  };
}

export async function create(req: Request, res: Response): Promise<void> {
  sendSuccess(res, await createInvoice(orgId(req), req.body as CreateInvoiceBody, actor(req)), "Invoice created successfully", 201);
}

export async function list(req: Request, res: Response): Promise<void> {
  const data = await listInvoices(orgId(req), req.query as unknown as InvoiceListQuery);
  sendSuccess(res, data, "Invoices retrieved successfully");
}

export async function getOne(req: Request, res: Response): Promise<void> {
  sendSuccess(res, await getInvoice(orgId(req), invoiceId(req)), "Invoice retrieved successfully");
}

export async function update(req: Request, res: Response): Promise<void> {
  sendSuccess(
    res,
    await updateInvoice(orgId(req), invoiceId(req), req.body as UpdateInvoiceBody, actor(req)),
    "Invoice updated successfully",
  );
}

export async function send(req: Request, res: Response): Promise<void> {
  sendSuccess(res, await sendInvoice(orgId(req), invoiceId(req), actor(req)), "Invoice sent successfully");
}

export async function voidOne(req: Request, res: Response): Promise<void> {
  sendSuccess(res, await voidInvoice(orgId(req), invoiceId(req), actor(req)), "Invoice voided successfully");
}

export async function generatePdf(req: Request, res: Response): Promise<void> {
  await requestInvoicePdf(orgId(req), invoiceId(req));
  sendSuccess(res, { queued: true }, "Invoice PDF generation queued", 202);
}

// ---- Portal ----

export async function portalList(req: Request, res: Response): Promise<void> {
  const { page, limit } = req.query as unknown as { page: number; limit: number };
  sendSuccess(res, await listPortalInvoices(req.client!, page, limit), "Invoices retrieved successfully");
}

export async function portalGet(req: Request, res: Response): Promise<void> {
  sendSuccess(res, await getPortalInvoice(req.client!, invoiceId(req)), "Invoice retrieved successfully");
}

export async function portalCheckout(req: Request, res: Response): Promise<void> {
  sendSuccess(res, await createPortalCheckout(req.client!, invoiceId(req)), "Checkout session created successfully", 201);
}
