import type Stripe from "stripe";
import type { SubscriptionStatus } from "../../generated/prisma/client.js";
import { prisma } from "../../lib/prisma.js";
import { recordAuditLog } from "../audit/audit.service.js";
import { applySubscriptionSync } from "../billing/billing.service.js";
import { enqueueInvoicePdfQuietly } from "../invoice/invoice.queue.js";
import { notifyInternal } from "../client-collaboration/collaboration.service.js";

const idOf = (v: string | { id: string } | null | undefined): string | null => (typeof v === "string" ? v : (v?.id ?? null));

export function mapSubscriptionStatus(status: Stripe.Subscription.Status): SubscriptionStatus {
  switch (status) {
    case "active":
    case "trialing":
      return "ACTIVE";
    case "past_due":
    case "unpaid":
      return "PAST_DUE";
    case "canceled":
    case "incomplete_expired":
      return "CANCELED";
    default:
      return "INCOMPLETE";
  }
}

const eventAtOf = (event: Stripe.Event): Date => new Date(event.created * 1000);

// ---------------------------------------------------------------------------
// Platform subscription
// ---------------------------------------------------------------------------

async function onSubscriptionChanged(event: Stripe.Event): Promise<void> {
  const sub = event.data.object as Stripe.Subscription;
  const periodEnd = sub.items.data[0]?.current_period_end;
  await applySubscriptionSync({
    organizationId: sub.metadata?.organizationId ?? null,
    stripeCustomerId: idOf(sub.customer),
    stripeSubscriptionId: sub.id,
    status: event.type === "customer.subscription.deleted" ? "CANCELED" : mapSubscriptionStatus(sub.status),
    currentPeriodEnd: periodEnd ? new Date(periodEnd * 1000) : null,
    cancelAtPeriodEnd: sub.cancel_at_period_end,
    eventAt: eventAtOf(event),
  });
}

async function onSubscriptionCheckoutCompleted(session: Stripe.Checkout.Session, event: Stripe.Event): Promise<void> {
  if (session.payment_status !== "paid" && session.payment_status !== "no_payment_required") return;
  await applySubscriptionSync({
    organizationId: session.metadata?.organizationId ?? session.client_reference_id ?? null,
    stripeCustomerId: idOf(session.customer),
    stripeSubscriptionId: idOf(session.subscription),
    status: "ACTIVE",
    currentPeriodEnd: null,
    cancelAtPeriodEnd: null,
    eventAt: eventAtOf(event),
  });
}

async function onInvoicePaymentFailed(event: Stripe.Event): Promise<void> {
  const invoice = event.data.object as Stripe.Invoice;
  const customerId = idOf(invoice.customer);
  if (!customerId) return;
  await applySubscriptionSync({
    organizationId: null,
    stripeCustomerId: customerId,
    stripeSubscriptionId: null,
    status: "PAST_DUE",
    currentPeriodEnd: null,
    cancelAtPeriodEnd: null,
    eventAt: eventAtOf(event),
  });
}

// ---------------------------------------------------------------------------
// Client invoice payments
// ---------------------------------------------------------------------------

async function markPaymentSucceeded(session: Stripe.Checkout.Session): Promise<void> {
  if (session.payment_status !== "paid") return; // async method still pending — wait for async_payment_succeeded

  const payment = await prisma.clientInvoicePayment.findUnique({
    where: { stripeCheckoutSessionId: session.id },
    include: { invoice: { select: { number: true } } },
  });
  if (!payment) return; // not one of ours (or the row was never written) — nothing to reconcile

  if (session.amount_total !== payment.amountCents || session.currency?.toLowerCase() !== payment.currency) {
    await prisma.clientInvoicePayment.updateMany({
      where: { id: payment.id, status: { not: "SUCCEEDED" } },
      data: { status: "FAILED", failureReason: "Paid amount or currency did not match the invoice" },
    });
    await recordAuditLog({
      organizationId: payment.organizationId,
      actorMembershipId: null,
      action: "invoice.payment.mismatch",
      entityType: "ClientInvoicePayment",
      entityId: payment.id,
      metadata: { expectedCents: payment.amountCents, receivedCents: session.amount_total ?? null },
    });
    return;
  }

  const invoicePaid = await prisma.$transaction(async (tx) => {
    const { count } = await tx.clientInvoicePayment.updateMany({
      where: { id: payment.id, status: { not: "SUCCEEDED" } },
      data: { status: "SUCCEEDED", paidAt: new Date(), failureReason: null, stripePaymentIntentId: idOf(session.payment_intent) },
    });
    if (count === 0) return null; // already applied — duplicate delivery
    const result = await tx.clientInvoice.updateMany({
      where: { id: payment.invoiceId, organizationId: payment.organizationId, status: "OPEN" },
      data: { status: "PAID", paidAt: new Date() },
    });
    return result.count === 1;
  });
  if (invoicePaid === null) return;

  if (invoicePaid) {
    await recordAuditLog({
      organizationId: payment.organizationId,
      actorMembershipId: null,
      action: "invoice.paid",
      entityType: "ClientInvoice",
      entityId: payment.invoiceId,
      metadata: { paymentId: payment.id, amountCents: payment.amountCents },
    });
    await notifyInternal({
      organizationId: payment.organizationId,
      type: "INVOICE_PAID",
      title: "Invoice paid",
      message: `Invoice ${payment.invoice.number} was paid.`,
      data: { invoiceId: payment.invoiceId },
    });
    // Re-render so the stored PDF shows PAID.
    enqueueInvoicePdfQuietly(payment.invoiceId);
  } else {
    // Money arrived for an invoice that is no longer OPEN (voided, or paid twice) — needs a human.
    await recordAuditLog({
      organizationId: payment.organizationId,
      actorMembershipId: null,
      action: "invoice.payment.received_on_closed_invoice",
      entityType: "ClientInvoicePayment",
      entityId: payment.id,
      metadata: { invoiceId: payment.invoiceId },
    });
    await notifyInternal({
      organizationId: payment.organizationId,
      type: "INVOICE_PAYMENT_ATTENTION",
      title: "Payment needs review",
      message: `A payment arrived for invoice ${payment.invoice.number}, which was no longer open. Review and refund if needed.`,
      data: { invoiceId: payment.invoiceId },
    });
  }
}

async function markPaymentEnded(session: Stripe.Checkout.Session, status: "FAILED" | "CANCELED", reason: string): Promise<void> {
  await prisma.clientInvoicePayment.updateMany({
    where: { stripeCheckoutSessionId: session.id, status: "PENDING" },
    data: { status, failureReason: reason },
  });
}

async function onCheckoutEvent(event: Stripe.Event): Promise<void> {
  const session = event.data.object as Stripe.Checkout.Session;
  const isSubscription = session.mode === "subscription";

  switch (event.type) {
    case "checkout.session.completed":
      return isSubscription ? onSubscriptionCheckoutCompleted(session, event) : markPaymentSucceeded(session);
    case "checkout.session.async_payment_succeeded":
      return isSubscription ? undefined : markPaymentSucceeded(session);
    case "checkout.session.async_payment_failed":
      return isSubscription ? undefined : markPaymentEnded(session, "FAILED", "Payment failed");
    case "checkout.session.expired":
      return isSubscription ? undefined : markPaymentEnded(session, "CANCELED", "Checkout session expired");
    default:
      return undefined;
  }
}

/** Dispatches a verified Stripe event. Unknown event types are acknowledged and ignored. */
export async function handleStripeEvent(event: Stripe.Event): Promise<void> {
  switch (event.type) {
    case "checkout.session.completed":
    case "checkout.session.async_payment_succeeded":
    case "checkout.session.async_payment_failed":
    case "checkout.session.expired":
      return onCheckoutEvent(event);
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted":
      return onSubscriptionChanged(event);
    case "invoice.payment_failed":
      return onInvoicePaymentFailed(event);
    default:
      return undefined;
  }
}
