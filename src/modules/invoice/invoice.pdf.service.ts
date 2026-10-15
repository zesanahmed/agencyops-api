import { destroyCloudinaryAsset, uploadBufferToCloudinary } from "../../lib/cloudinary.js";
import { prisma } from "../../lib/prisma.js";
import { renderInvoicePdf } from "./invoice.pdf.js";

export type GenerateResult = "generated" | "skipped";

/**
 * Renders the invoice to PDF, stores it in Cloudinary and records the
 * reference on the invoice. Safe to run any number of times for the same
 * invoice (the queue retries failed jobs): each run re-renders from the
 * database, replaces the stored reference, then removes the previous asset.
 *
 * Drafts and missing invoices are skipped, not failed — retrying them
 * would never succeed.
 */
export async function generateInvoicePdf(invoiceId: string): Promise<GenerateResult> {
  const invoice = await prisma.clientInvoice.findUnique({
    where: { id: invoiceId },
    include: {
      items: { orderBy: { position: "asc" } },
      organization: { select: { name: true } },
      clientOrganization: { select: { name: true } },
      project: { select: { name: true } },
    },
  });
  if (!invoice || invoice.status === "DRAFT") return "skipped";

  const buffer = await renderInvoicePdf({
    number: invoice.number,
    status: invoice.status,
    issueDate: invoice.issueDate,
    dueDate: invoice.dueDate,
    paidAt: invoice.paidAt,
    currency: invoice.currency,
    subtotalCents: invoice.subtotalCents,
    taxCents: invoice.taxCents,
    discountCents: invoice.discountCents,
    totalCents: invoice.totalCents,
    notes: invoice.notes,
    sellerName: invoice.organization.name,
    clientName: invoice.clientOrganization.name,
    projectName: invoice.project?.name ?? null,
    items: invoice.items,
  });

  const uploaded = await uploadBufferToCloudinary(`agencyops/invoices/${invoice.organizationId}`, buffer);
  await prisma.clientInvoice.update({
    where: { id: invoice.id },
    data: { pdfUrl: uploaded.url, pdfPublicId: uploaded.publicId, pdfGeneratedAt: new Date() },
  });

  if (invoice.pdfPublicId && invoice.pdfPublicId !== uploaded.publicId) {
    await destroyCloudinaryAsset(invoice.pdfPublicId);
  }
  return "generated";
}
