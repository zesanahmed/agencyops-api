import { env } from "../../config/env.js";
import { AppError } from "../../errors/AppError.js";
import { Prisma } from "../../generated/prisma/client.js";
import type { InvoiceStatus } from "../../generated/prisma/client.js";
import { getStripe } from "../../lib/stripe.js";
import { prisma } from "../../lib/prisma.js";
import { recordAuditLog } from "../audit/audit.service.js";
import { enqueueInvoicePdf, enqueueInvoicePdfQuietly } from "./invoice.queue.js";
import { pageInfo, type PageInfo } from "../client-collaboration/collaboration.mappers.js";
import {
  toPortalInvoiceView,
  toStaffInvoiceView,
  type PortalInvoiceView,
  type StaffInvoiceView,
} from "./invoice.mappers.js";
import type { CreateInvoiceBody, InvoiceListQuery, UpdateInvoiceBody } from "./invoice.validation.js";

export interface InvoiceActor {
  membershipId: string;
  ipAddress: string | null;
  userAgent: string | null;
}

const MAX_CENTS = 2_000_000_000;
const NUMBER_RETRIES = 5;

const invoiceInclude = {
  items: true,
  payments: { orderBy: { createdAt: "desc" } },
} satisfies Prisma.ClientInvoiceInclude;

type ItemInput = { description: string; quantity: number; unitAmountCents: number };

/** Totals are always computed server-side; the client never supplies amounts it could lie about. */
export function computeTotals(items: ItemInput[], taxCents: number, discountCents: number) {
  const rows = items.map((item, index) => ({
    position: index,
    description: item.description,
    quantity: item.quantity,
    unitAmountCents: item.unitAmountCents,
    amountCents: item.quantity * item.unitAmountCents,
  }));
  if (rows.some((r) => r.amountCents > MAX_CENTS)) throw new AppError("Line item amount is too large", 422);
  const subtotalCents = rows.reduce((sum, r) => sum + r.amountCents, 0);
  const totalCents = subtotalCents - discountCents + taxCents;
  if (totalCents < 0) throw new AppError("Discount cannot exceed the invoice amount", 422);
  if (subtotalCents > MAX_CENTS || totalCents > MAX_CENTS) throw new AppError("Invoice total is too large", 422);
  return { rows, subtotalCents, totalCents };
}

async function assertClientAndProject(organizationId: string, clientId: string, projectId: string | null | undefined) {
  const client = await prisma.clientOrganization.findFirst({
    where: { id: clientId, organizationId, deletedAt: null },
    select: { id: true },
  });
  if (!client) throw new AppError("Client not found", 404);
  if (projectId) {
    const project = await prisma.project.findFirst({
      where: { id: projectId, organizationId, deletedAt: null, clientOrganizationId: clientId },
      select: { id: true },
    });
    if (!project) throw new AppError("Project not found for this client", 404);
  }
}

export async function createInvoice(
  organizationId: string,
  body: CreateInvoiceBody,
  actor: InvoiceActor,
): Promise<StaffInvoiceView> {
  await assertClientAndProject(organizationId, body.clientId, body.projectId);
  const totals = computeTotals(body.items, body.taxCents, body.discountCents);

  for (let attempt = 0; attempt < NUMBER_RETRIES; attempt++) {
    try {
      const invoice = await prisma.$transaction(async (tx) => {
        const count = await tx.clientInvoice.count({ where: { organizationId } });
        return tx.clientInvoice.create({
          data: {
            organizationId,
            clientOrganizationId: body.clientId,
            projectId: body.projectId ?? null,
            number: `INV-${String(count + 1).padStart(4, "0")}`,
            issueDate: body.issueDate,
            dueDate: body.dueDate,
            currency: body.currency,
            subtotalCents: totals.subtotalCents,
            taxCents: body.taxCents,
            discountCents: body.discountCents,
            totalCents: totals.totalCents,
            notes: body.notes ?? null,
            createdByMembershipId: actor.membershipId,
            items: { create: totals.rows },
          },
          include: invoiceInclude,
        });
      });
      await recordAuditLog({
        organizationId,
        actorMembershipId: actor.membershipId,
        action: "invoice.created",
        entityType: "ClientInvoice",
        entityId: invoice.id,
        metadata: { number: invoice.number, totalCents: invoice.totalCents },
        ipAddress: actor.ipAddress,
        userAgent: actor.userAgent,
      });
      return toStaffInvoiceView(invoice);
    } catch (error) {
      // Two concurrent creates picked the same number — the unique constraint caught it; retry.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") continue;
      throw error;
    }
  }
  throw new AppError("Could not allocate an invoice number, please retry", 409);
}

export async function listInvoices(
  organizationId: string,
  query: InvoiceListQuery,
): Promise<{ invoices: StaffInvoiceView[]; pagination: PageInfo }> {
  const where: Prisma.ClientInvoiceWhereInput = {
    organizationId,
    ...(query.clientId ? { clientOrganizationId: query.clientId } : {}),
    ...(query.projectId ? { projectId: query.projectId } : {}),
    ...(query.status ? { status: query.status } : {}),
  };
  const [rows, total] = await Promise.all([
    prisma.clientInvoice.findMany({
      where,
      include: invoiceInclude,
      orderBy: { createdAt: "desc" },
      skip: (query.page - 1) * query.limit,
      take: query.limit,
    }),
    prisma.clientInvoice.count({ where }),
  ]);
  return { invoices: rows.map(toStaffInvoiceView), pagination: pageInfo(query.page, query.limit, total) };
}

export async function getInvoice(organizationId: string, invoiceId: string): Promise<StaffInvoiceView> {
  const row = await prisma.clientInvoice.findFirst({ where: { id: invoiceId, organizationId }, include: invoiceInclude });
  if (!row) throw new AppError("Invoice not found", 404);
  return toStaffInvoiceView(row);
}

export async function updateInvoice(
  organizationId: string,
  invoiceId: string,
  body: UpdateInvoiceBody,
  actor: InvoiceActor,
): Promise<StaffInvoiceView> {
  const existing = await prisma.clientInvoice.findFirst({
    where: { id: invoiceId, organizationId },
    include: { items: true },
  });
  if (!existing) throw new AppError("Invoice not found", 404);
  if (existing.status !== "DRAFT") throw new AppError("Only draft invoices can be edited", 409);

  const projectId = body.projectId === undefined ? existing.projectId : body.projectId;
  if (body.projectId) await assertClientAndProject(organizationId, existing.clientOrganizationId, body.projectId);

  const taxCents = body.taxCents ?? existing.taxCents;
  const discountCents = body.discountCents ?? existing.discountCents;
  const totals = computeTotals(body.items ?? existing.items, taxCents, discountCents);
  const issueDate = body.issueDate ?? existing.issueDate;
  const dueDate = body.dueDate ?? existing.dueDate;
  if (dueDate < issueDate) throw new AppError("dueDate must not be before issueDate", 422);

  const updated = await prisma.$transaction(async (tx) => {
    // Conditional on DRAFT so a concurrent send cannot be overwritten.
    const { count } = await tx.clientInvoice.updateMany({
      where: { id: invoiceId, organizationId, status: "DRAFT" },
      data: {
        projectId,
        issueDate,
        dueDate,
        currency: body.currency ?? existing.currency,
        taxCents,
        discountCents,
        subtotalCents: totals.subtotalCents,
        totalCents: totals.totalCents,
        notes: body.notes === undefined ? existing.notes : body.notes,
      },
    });
    if (count === 0) throw new AppError("Only draft invoices can be edited", 409);
    if (body.items) {
      await tx.clientInvoiceItem.deleteMany({ where: { invoiceId } });
      await tx.clientInvoiceItem.createMany({ data: totals.rows.map((r) => ({ ...r, invoiceId })) });
    }
    return tx.clientInvoice.findUniqueOrThrow({ where: { id: invoiceId }, include: invoiceInclude });
  });

  await recordAuditLog({
    organizationId,
    actorMembershipId: actor.membershipId,
    action: "invoice.updated",
    entityType: "ClientInvoice",
    entityId: invoiceId,
    ipAddress: actor.ipAddress,
    userAgent: actor.userAgent,
  });
  return toStaffInvoiceView(updated);
}

export async function sendInvoice(organizationId: string, invoiceId: string, actor: InvoiceActor): Promise<StaffInvoiceView> {
  const existing = await prisma.clientInvoice.findFirst({
    where: { id: invoiceId, organizationId },
    select: { status: true, totalCents: true, _count: { select: { items: true } } },
  });
  if (!existing) throw new AppError("Invoice not found", 404);
  if (existing.status !== "DRAFT") throw new AppError("Only draft invoices can be sent", 409);
  if (existing._count.items === 0 || existing.totalCents <= 0) {
    throw new AppError("An invoice needs at least one item and a total above zero before it can be sent", 422);
  }

  const { count } = await prisma.clientInvoice.updateMany({
    where: { id: invoiceId, organizationId, status: "DRAFT" },
    data: { status: "OPEN", sentAt: new Date() },
  });
  if (count === 0) throw new AppError("Only draft invoices can be sent", 409);

  await recordAuditLog({
    organizationId,
    actorMembershipId: actor.membershipId,
    action: "invoice.sent",
    entityType: "ClientInvoice",
    entityId: invoiceId,
    ipAddress: actor.ipAddress,
    userAgent: actor.userAgent,
  });
  enqueueInvoicePdfQuietly(invoiceId);
  return getInvoice(organizationId, invoiceId);
}

export async function voidInvoice(organizationId: string, invoiceId: string, actor: InvoiceActor): Promise<StaffInvoiceView> {
  const existing = await prisma.clientInvoice.findFirst({
    where: { id: invoiceId, organizationId },
    select: { status: true, pdfPublicId: true },
  });
  if (!existing) throw new AppError("Invoice not found", 404);
  if (existing.status === "PAID") throw new AppError("A paid invoice cannot be voided", 409);
  if (existing.status === "VOID") throw new AppError("Invoice is already void", 409);

  const pendingSessionIds = await prisma.$transaction(async (tx) => {
    const { count } = await tx.clientInvoice.updateMany({
      where: { id: invoiceId, organizationId, status: { in: ["DRAFT", "OPEN"] } },
      data: { status: "VOID", voidedAt: new Date() },
    });
    if (count === 0) throw new AppError("Invoice can no longer be voided", 409);
    const pending = await tx.clientInvoicePayment.findMany({
      where: { invoiceId, status: "PENDING" },
      select: { stripeCheckoutSessionId: true },
    });
    await tx.clientInvoicePayment.updateMany({ where: { invoiceId, status: "PENDING" }, data: { status: "CANCELED" } });
    return pending.map((p) => p.stripeCheckoutSessionId);
  });

  // Best effort: a failure here must not undo the void — a payment that still
  // slips through is recorded against a VOID invoice and flagged by the webhook.
  if (pendingSessionIds.length > 0 && env.stripe.secretKey) {
    const stripe = getStripe();
    await Promise.allSettled(pendingSessionIds.map((id) => stripe.checkout.sessions.expire(id)));
  }

  await recordAuditLog({
    organizationId,
    actorMembershipId: actor.membershipId,
    action: "invoice.voided",
    entityType: "ClientInvoice",
    entityId: invoiceId,
    ipAddress: actor.ipAddress,
    userAgent: actor.userAgent,
  });
  // A previously rendered PDF would still say "DUE" — refresh it to show VOID.
  if (existing.pdfPublicId) enqueueInvoicePdfQuietly(invoiceId);
  return getInvoice(organizationId, invoiceId);
}

/** Staff-triggered (re)generation of the invoice PDF, e.g. after a failed job. */
export async function requestInvoicePdf(organizationId: string, invoiceId: string): Promise<void> {
  const invoice = await prisma.clientInvoice.findFirst({ where: { id: invoiceId, organizationId }, select: { status: true } });
  if (!invoice) throw new AppError("Invoice not found", 404);
  if (invoice.status === "DRAFT") throw new AppError("Send the invoice before generating its PDF", 409);
  await enqueueInvoicePdf(invoiceId);
}

// ---------------------------------------------------------------------------
// Client portal side
// ---------------------------------------------------------------------------

export interface PortalIdentity {
  contactId: string;
  organizationId: string;
  clientOrganizationId: string;
}

/** Non-draft invoices of the contact's own client org; project-linked ones need an explicit project grant. */
async function portalVisibilityWhere(who: PortalIdentity): Promise<Prisma.ClientInvoiceWhereInput> {
  const grants = await prisma.clientProjectAccess.findMany({
    where: { clientContactId: who.contactId },
    select: { projectId: true },
  });
  return {
    organizationId: who.organizationId,
    clientOrganizationId: who.clientOrganizationId,
    status: { in: ["OPEN", "PAID", "VOID"] satisfies InvoiceStatus[] },
    OR: [{ projectId: null }, { projectId: { in: grants.map((g) => g.projectId) } }],
  };
}

export async function listPortalInvoices(
  who: PortalIdentity,
  page: number,
  limit: number,
): Promise<{ invoices: PortalInvoiceView[]; pagination: PageInfo }> {
  const where = await portalVisibilityWhere(who);
  const [rows, total] = await Promise.all([
    prisma.clientInvoice.findMany({
      where,
      include: { items: true },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.clientInvoice.count({ where }),
  ]);
  return { invoices: rows.map(toPortalInvoiceView), pagination: pageInfo(page, limit, total) };
}

export async function getPortalInvoice(who: PortalIdentity, invoiceId: string): Promise<PortalInvoiceView> {
  const row = await prisma.clientInvoice.findFirst({
    where: { id: invoiceId, ...(await portalVisibilityWhere(who)) },
    include: { items: true },
  });
  if (!row) throw new AppError("Invoice not found", 404);
  return toPortalInvoiceView(row);
}

/**
 * Starts a Stripe Checkout Session for an OPEN invoice. The amount comes
 * from our database, never the request. This only creates a PENDING
 * payment — the invoice becomes PAID solely via the verified webhook.
 */
export async function createPortalCheckout(who: PortalIdentity, invoiceId: string): Promise<{ url: string }> {
  const invoice = await prisma.clientInvoice.findFirst({
    where: { id: invoiceId, ...(await portalVisibilityWhere(who)) },
    select: { id: true, number: true, status: true, totalCents: true, currency: true },
  });
  if (!invoice) throw new AppError("Invoice not found", 404);
  if (invoice.status !== "OPEN") throw new AppError("This invoice is not payable", 409);

  const session = await getStripe().checkout.sessions.create({
    mode: "payment",
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: invoice.currency,
          unit_amount: invoice.totalCents,
          product_data: { name: `Invoice ${invoice.number}` },
        },
      },
    ],
    metadata: { purpose: "client_invoice", invoiceId: invoice.id, organizationId: who.organizationId },
    payment_intent_data: { metadata: { invoiceId: invoice.id, organizationId: who.organizationId } },
    success_url: `${env.frontendUrl}/portal/invoices/${invoice.id}?payment=success`,
    cancel_url: `${env.frontendUrl}/portal/invoices/${invoice.id}?payment=cancelled`,
  });
  if (!session.url) throw new AppError("Could not start checkout", 502);

  await prisma.clientInvoicePayment.create({
    data: {
      organizationId: who.organizationId,
      invoiceId: invoice.id,
      clientContactId: who.contactId,
      amountCents: invoice.totalCents,
      currency: invoice.currency,
      stripeCheckoutSessionId: session.id,
    },
  });
  return { url: session.url };
}
