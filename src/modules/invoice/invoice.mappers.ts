import type { InvoiceStatus, PaymentStatus } from "../../generated/prisma/client.js";

export type InvoiceItemView = { description: string; quantity: number; unitAmountCents: number; amountCents: number };

type ItemRow = InvoiceItemView & { position: number };

type InvoiceRow = {
  id: string;
  number: string;
  status: InvoiceStatus;
  clientOrganizationId: string;
  projectId: string | null;
  issueDate: Date;
  dueDate: Date;
  currency: string;
  subtotalCents: number;
  taxCents: number;
  discountCents: number;
  totalCents: number;
  notes: string | null;
  sentAt: Date | null;
  paidAt: Date | null;
  voidedAt: Date | null;
  pdfUrl: string | null;
  pdfGeneratedAt: Date | null;
  createdAt: Date;
  items?: ItemRow[];
  payments?: PaymentRow[];
};

type PaymentRow = {
  id: string;
  amountCents: number;
  currency: string;
  status: PaymentStatus;
  failureReason: string | null;
  paidAt: Date | null;
  createdAt: Date;
};

const iso = (d: Date | null): string | null => (d ? d.toISOString() : null);

const toItem = (i: ItemRow): InvoiceItemView => ({
  description: i.description,
  quantity: i.quantity,
  unitAmountCents: i.unitAmountCents,
  amountCents: i.amountCents,
});

const base = (r: InvoiceRow) => ({
  id: r.id,
  number: r.number,
  status: r.status,
  projectId: r.projectId,
  issueDate: r.issueDate.toISOString(),
  dueDate: r.dueDate.toISOString(),
  currency: r.currency,
  subtotalCents: r.subtotalCents,
  taxCents: r.taxCents,
  discountCents: r.discountCents,
  totalCents: r.totalCents,
  notes: r.notes,
  sentAt: iso(r.sentAt),
  paidAt: iso(r.paidAt),
  // Present once the background job has rendered it; the URL is unguessable but not authenticated.
  pdfUrl: r.pdfUrl,
  pdfGeneratedAt: iso(r.pdfGeneratedAt),
  createdAt: r.createdAt.toISOString(),
  items: (r.items ?? []).slice().sort((a, b) => a.position - b.position).map(toItem),
});

/** Staff view — includes payment attempts, but never Stripe identifiers. */
export const toStaffInvoiceView = (r: InvoiceRow) => ({
  ...base(r),
  clientId: r.clientOrganizationId,
  voidedAt: iso(r.voidedAt),
  payments: (r.payments ?? []).map((p) => ({
    id: p.id,
    amountCents: p.amountCents,
    currency: p.currency,
    status: p.status,
    failureReason: p.failureReason,
    paidAt: iso(p.paidAt),
    createdAt: p.createdAt.toISOString(),
  })),
});

/** Client-portal view — no internal ids (client org, creator) and no Stripe data. */
export const toPortalInvoiceView = (r: InvoiceRow) => base(r);

export type StaffInvoiceView = ReturnType<typeof toStaffInvoiceView>;
export type PortalInvoiceView = ReturnType<typeof toPortalInvoiceView>;
