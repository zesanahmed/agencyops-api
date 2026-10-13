import { env } from "../../config/env.js";
import { AppError } from "../../errors/AppError.js";
import { Prisma } from "../../generated/prisma/client.js";
import type { PlanCode, SubscriptionStatus } from "../../generated/prisma/client.js";
import { getStripe } from "../../lib/stripe.js";
import { prisma } from "../../lib/prisma.js";
import { recordAuditLog } from "../audit/audit.service.js";
import { ensurePlan } from "./billing.plans.js";

export type BillingView = {
  plan: { code: PlanCode; name: string; maxMembers: number | null; maxProjects: number | null };
  subscription: {
    status: SubscriptionStatus;
    currentPeriodEnd: string | null;
    cancelAtPeriodEnd: boolean;
    hasBillingAccount: boolean;
  };
};

type SubscriptionWithPlan = Prisma.PlatformSubscriptionGetPayload<{ include: { plan: true } }>;

/** Every organization is on FREE until a paid subscription says otherwise; the row is created lazily. */
async function getOrCreateSubscription(organizationId: string): Promise<SubscriptionWithPlan> {
  const existing = await prisma.platformSubscription.findUnique({ where: { organizationId }, include: { plan: true } });
  if (existing) return existing;

  const free = await ensurePlan("FREE");
  try {
    return await prisma.platformSubscription.create({
      data: { organizationId, planId: free.id },
      include: { plan: true },
    });
  } catch (error) {
    // Lost a creation race with a concurrent request — the winner's row is fine.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return prisma.platformSubscription.findUniqueOrThrow({ where: { organizationId }, include: { plan: true } });
    }
    throw error;
  }
}

function toBillingView(sub: SubscriptionWithPlan): BillingView {
  return {
    plan: { code: sub.plan.code, name: sub.plan.name, maxMembers: sub.plan.maxMembers, maxProjects: sub.plan.maxProjects },
    subscription: {
      status: sub.status,
      currentPeriodEnd: sub.currentPeriodEnd ? sub.currentPeriodEnd.toISOString() : null,
      cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
      hasBillingAccount: sub.stripeCustomerId !== null,
    },
  };
}

export async function getBilling(organizationId: string): Promise<BillingView> {
  return toBillingView(await getOrCreateSubscription(organizationId));
}

export interface BillingActor {
  membershipId: string;
  email: string;
  ipAddress: string | null;
  userAgent: string | null;
}

/** Starts a Stripe Checkout Session for the PRO plan. The plan only changes when the webhook confirms it. */
export async function createProCheckout(organizationId: string, organizationName: string, actor: BillingActor) {
  if (!env.stripe.proPriceId) throw new AppError("Payments are not configured", 503);

  const sub = await getOrCreateSubscription(organizationId);
  if (sub.plan.code === "PRO" && (sub.status === "ACTIVE" || sub.status === "PAST_DUE")) {
    throw new AppError("This organization is already on the Pro plan", 409);
  }

  const stripe = getStripe();
  let customerId = sub.stripeCustomerId;
  if (!customerId) {
    const customer = await stripe.customers.create({
      name: organizationName,
      email: actor.email,
      metadata: { organizationId },
    });
    customerId = customer.id;
    await prisma.platformSubscription.update({ where: { organizationId }, data: { stripeCustomerId: customerId } });
  }

  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    customer: customerId,
    line_items: [{ price: env.stripe.proPriceId, quantity: 1 }],
    client_reference_id: organizationId,
    metadata: { organizationId, purpose: "platform_subscription" },
    subscription_data: { metadata: { organizationId } },
    success_url: `${env.frontendUrl}/billing/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${env.frontendUrl}/billing/cancel`,
  });
  if (!session.url) throw new AppError("Could not start checkout", 502);

  await recordAuditLog({
    organizationId,
    actorMembershipId: actor.membershipId,
    action: "billing.checkout.started",
    entityType: "PlatformSubscription",
    entityId: sub.id,
    ipAddress: actor.ipAddress,
    userAgent: actor.userAgent,
  });
  return { url: session.url };
}

/** Stripe-hosted portal for managing/cancelling the subscription and payment method. */
export async function createPortalSession(organizationId: string) {
  const sub = await getOrCreateSubscription(organizationId);
  if (!sub.stripeCustomerId) {
    throw new AppError("No billing account exists yet — subscribe to a plan first", 409);
  }
  const session = await getStripe().billingPortal.sessions.create({
    customer: sub.stripeCustomerId,
    return_url: `${env.frontendUrl}/billing`,
  });
  return { url: session.url };
}

// ---------------------------------------------------------------------------
// Webhook-driven state sync (called from the Stripe webhook handler only).
// ---------------------------------------------------------------------------

export interface SubscriptionSync {
  organizationId: string | null;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  status: SubscriptionStatus;
  /** null = unknown for this event; the stored value is left unchanged. */
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean | null;
  /** Stripe event creation time — older events than the last applied one are ignored. */
  eventAt: Date;
}

/**
 * Applies a subscription state change. Plan follows status: ACTIVE or
 * PAST_DUE (grace period) → PRO; anything else → FREE. Returns false when
 * the event could not be matched to an organization or was stale.
 */
export async function applySubscriptionSync(sync: SubscriptionSync): Promise<boolean> {
  const sub = await prisma.platformSubscription.findFirst({
    where: {
      OR: [
        ...(sync.organizationId ? [{ organizationId: sync.organizationId }] : []),
        ...(sync.stripeSubscriptionId ? [{ stripeSubscriptionId: sync.stripeSubscriptionId }] : []),
        ...(sync.stripeCustomerId ? [{ stripeCustomerId: sync.stripeCustomerId }] : []),
      ],
    },
  });
  // Never create a subscription for an organization we cannot positively identify.
  const organization = sub
    ? null
    : sync.organizationId
      ? await prisma.organization.findFirst({ where: { id: sync.organizationId, deletedAt: null }, select: { id: true } })
      : null;
  if (!sub && !organization) return false;

  const organizationId = sub ? sub.organizationId : organization!.id;
  if (sub?.lastStripeEventAt && sub.lastStripeEventAt.getTime() > sync.eventAt.getTime()) return false;

  const plan = await ensurePlan(sync.status === "ACTIVE" || sync.status === "PAST_DUE" ? "PRO" : "FREE");
  const data = {
    planId: plan.id,
    status: sync.status,
    ...(sync.cancelAtPeriodEnd === null ? {} : { cancelAtPeriodEnd: sync.cancelAtPeriodEnd }),
    ...(sync.currentPeriodEnd ? { currentPeriodEnd: sync.currentPeriodEnd } : {}),
    lastStripeEventAt: sync.eventAt,
    ...(sync.stripeCustomerId ? { stripeCustomerId: sync.stripeCustomerId } : {}),
    ...(sync.stripeSubscriptionId ? { stripeSubscriptionId: sync.stripeSubscriptionId } : {}),
  };

  const saved = await prisma.platformSubscription.upsert({
    where: { organizationId },
    create: { organizationId, ...data },
    update: data,
  });

  await recordAuditLog({
    organizationId,
    actorMembershipId: null,
    action: "billing.subscription.synced",
    entityType: "PlatformSubscription",
    entityId: saved.id,
    metadata: { status: sync.status, plan: plan.code },
  });
  return true;
}
