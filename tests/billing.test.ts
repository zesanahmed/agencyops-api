import Stripe from "stripe";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderInvoicePdf } from "../src/modules/invoice/invoice.pdf.js";
import { generateInvoicePdf } from "../src/modules/invoice/invoice.pdf.service.js";
import { addMember, api, app, auth, createOrg, PASSWORD, prisma, registerUser, request, resetDatabase } from "./helpers.js";
import type { TestUser } from "./helpers.js";

// Only the Stripe network calls are stubbed; signature verification is the real code.
let sessionCounter = 0;
const stripeMock = {
  customers: { create: vi.fn(async () => ({ id: "cus_test_1" })) },
  checkout: {
    sessions: {
      create: vi.fn(async () => {
        sessionCounter += 1;
        return { id: `cs_test_${sessionCounter}`, url: `https://checkout.stripe.test/cs_test_${sessionCounter}` };
      }),
      expire: vi.fn(async () => ({})),
    },
  },
  billingPortal: { sessions: { create: vi.fn(async () => ({ url: "https://billing.stripe.test/portal" })) } },
};
vi.mock("../src/lib/stripe.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/lib/stripe.js")>();
  return { ...actual, getStripe: () => stripeMock };
});

// Redis/BullMQ and Cloudinary are never reached from tests.
const enqueueMock = vi.fn(async (_invoiceId: string) => undefined);
vi.mock("../src/modules/invoice/invoice.queue.js", () => ({
  enqueueInvoicePdf: (id: string) => enqueueMock(id),
  enqueueInvoicePdfQuietly: (id: string) => void enqueueMock(id),
}));

let uploadCounter = 0;
const destroyMock = vi.fn(async (_publicId: string) => undefined);
vi.mock("../src/lib/cloudinary.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/lib/cloudinary.js")>();
  return {
    ...actual,
    uploadBufferToCloudinary: vi.fn(async () => {
      uploadCounter += 1;
      return { publicId: `invoices/pdf-${uploadCounter}`, url: `https://res.cloudinary.test/invoice-${uploadCounter}.pdf` };
    }),
    destroyCloudinaryAsset: (id: string) => destroyMock(id),
  };
});

const WEBHOOK_SECRET = "whsec_test_secret";
const signer = new Stripe("sk_test_dummy");
let eventCounter = 0;

function makeEvent(type: string, object: unknown, created = Math.floor(Date.now() / 1000)) {
  eventCounter += 1;
  return { id: `evt_test_${eventCounter}`, object: "event", type, created, data: { object } };
}

function sendEvent(event: ReturnType<typeof makeEvent>, opts: { signature?: string | null } = {}) {
  const payload = JSON.stringify(event);
  const signature =
    opts.signature === undefined
      ? signer.webhooks.generateTestHeaderString({ payload, secret: WEBHOOK_SECRET })
      : opts.signature;
  const req = request(app).post(`${api}/webhooks/stripe`).set("Content-Type", "application/json");
  if (signature) req.set("Stripe-Signature", signature);
  return req.send(payload);
}

const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });
const org = (ctx: { orgId: string }) => `${api}/organizations/${ctx.orgId}`;

interface Ctx {
  owner: TestUser;
  manager: TestUser;
  member: TestUser;
  outsider: TestUser;
  orgId: string;
  clientId: string;
  projectId: string;
  clientToken: string;
}

async function portalContact(ctx: { orgId: string; owner: TestUser }, clientId: string, email: string, projectId?: string) {
  const created = await request(app)
    .post(`${org(ctx)}/clients/${clientId}/contacts`)
    .set(auth(ctx.owner))
    .send({ name: "Jane Client", email });
  expect(created.status).toBe(201);
  if (projectId) {
    const grant = await request(app)
      .post(`${org(ctx)}/clients/${clientId}/contacts/${created.body.data.contact.id}/access`)
      .set(auth(ctx.owner))
      .send({ projectId });
    expect(grant.status).toBe(201);
  }
  const accepted = await request(app)
    .post(`${api}/portal/auth/accept-invite`)
    .send({ token: created.body.data.inviteToken, password: PASSWORD });
  expect(accepted.status).toBe(201);
  return accepted.body.data.accessToken as string;
}

async function setup(): Promise<Ctx> {
  const owner = await registerUser("Olivia Owner");
  const manager = await registerUser("Max Manager");
  const member = await registerUser("Tim Member");
  const outsider = await registerUser("Out Sider");
  const orgId = await createOrg(owner, "Agency");
  await addMember(orgId, manager, "MANAGER");
  await addMember(orgId, member, "TEAM_MEMBER");

  const clientRes = await request(app).post(`${api}/organizations/${orgId}/clients`).set(auth(owner)).send({ name: "Acme Corp" });
  const clientId = clientRes.body.data.client.id as string;
  const projectRes = await request(app).post(`${api}/organizations/${orgId}/projects`).set(auth(owner)).send({ name: "Website" });
  const projectId = projectRes.body.data.project.id as string;
  const link = await request(app).post(`${api}/organizations/${orgId}/clients/${clientId}/projects`).set(auth(owner)).send({ projectId });
  expect(link.status).toBe(201);

  const base = { owner, manager, member, outsider, orgId, clientId, projectId };
  const clientToken = await portalContact(base, clientId, "jane@acme.test", projectId);
  return { ...base, clientToken };
}

const invoiceBody = (ctx: Ctx, extra: Record<string, unknown> = {}) => ({
  clientId: ctx.clientId,
  issueDate: "2026-10-01",
  dueDate: "2026-10-31",
  currency: "USD",
  taxCents: 500,
  discountCents: 1000,
  items: [
    { description: "Design", quantity: 2, unitAmountCents: 10000 },
    { description: "Dev", quantity: 1, unitAmountCents: 5000 },
  ],
  ...extra,
});

async function openInvoice(ctx: Ctx, extra: Record<string, unknown> = {}): Promise<string> {
  const created = await request(app).post(`${org(ctx)}/invoices`).set(auth(ctx.owner)).send(invoiceBody(ctx, extra));
  expect(created.status).toBe(201);
  const id = created.body.data.id as string;
  const sent = await request(app).post(`${org(ctx)}/invoices/${id}/send`).set(auth(ctx.owner));
  expect(sent.status).toBe(200);
  return id;
}

async function startCheckout(ctx: Ctx, invoiceId: string) {
  const res = await request(app).post(`${api}/portal/invoices/${invoiceId}/checkout`).set(bearer(ctx.clientToken));
  expect(res.status).toBe(201);
  return `cs_test_${sessionCounter}`;
}

const paidSession = (id: string, amount: number, extra: Record<string, unknown> = {}) => ({
  id,
  object: "checkout.session",
  mode: "payment",
  payment_status: "paid",
  amount_total: amount,
  currency: "usd",
  payment_intent: "pi_test_1",
  ...extra,
});

beforeEach(async () => {
  await resetDatabase();
  vi.clearAllMocks();
});

describe("platform subscription (billing)", () => {
  it("is readable by OWNER/MANAGER, defaults to FREE, and is hidden from members and outsiders", async () => {
    const ctx = await setup();
    const res = await request(app).get(`${org(ctx)}/billing`).set(auth(ctx.owner));
    expect(res.status).toBe(200);
    expect(res.body.data.plan.code).toBe("FREE");
    expect((await request(app).get(`${org(ctx)}/billing`).set(auth(ctx.manager))).status).toBe(200);
    expect((await request(app).get(`${org(ctx)}/billing`).set(auth(ctx.member))).status).toBe(403);
    expect((await request(app).get(`${org(ctx)}/billing`).set(auth(ctx.outsider))).status).toBe(404);
  });

  it("only the OWNER can start checkout, and starting it does not upgrade the plan", async () => {
    const ctx = await setup();
    expect((await request(app).post(`${org(ctx)}/billing/checkout`).set(auth(ctx.manager))).status).toBe(403);
    const res = await request(app).post(`${org(ctx)}/billing/checkout`).set(auth(ctx.owner));
    expect(res.status).toBe(201);
    expect(res.body.data.url).toContain("checkout.stripe.test");
    const sub = stripeMock.checkout.sessions.create.mock.calls.at(-1)![0] as unknown as { success_url: string; cancel_url: string };
    expect(sub.success_url).toBe(
      `http://web.test/payment/success?type=subscription&organizationId=${ctx.orgId}&session_id={CHECKOUT_SESSION_ID}`,
    );
    expect(sub.cancel_url).toBe(`http://web.test/payment/cancel?type=subscription&organizationId=${ctx.orgId}`);
    const billing = await request(app).get(`${org(ctx)}/billing`).set(auth(ctx.owner));
    expect(billing.body.data.plan.code).toBe("FREE");
    expect(billing.body.data.subscription.hasBillingAccount).toBe(true);
    // The portal is only available once a Stripe customer exists.
    expect((await request(app).post(`${org(ctx)}/billing/portal`).set(auth(ctx.owner))).status).toBe(201);
  });

  it("rejects missing and invalid webhook signatures", async () => {
    const event = makeEvent("customer.subscription.updated", {});
    expect((await sendEvent(event, { signature: null })).status).toBe(400);
    expect((await sendEvent(event, { signature: "t=1,v1=deadbeef" })).status).toBe(400);
    expect(await prisma.webhookEvent.count()).toBe(0);
  });

  it("upgrades to PRO from verified events, handles failure/cancel, and ignores stale events", async () => {
    const ctx = await setup();
    await request(app).post(`${org(ctx)}/billing/checkout`).set(auth(ctx.owner));
    const periodEnd = Math.floor(Date.now() / 1000) + 30 * 86400;
    const now = Math.floor(Date.now() / 1000);
    const subObject = (status: string) => ({
      id: "sub_test_1",
      object: "subscription",
      status,
      customer: "cus_test_1",
      cancel_at_period_end: false,
      metadata: { organizationId: ctx.orgId },
      items: { data: [{ current_period_end: periodEnd }] },
    });

    const created = await sendEvent(makeEvent("customer.subscription.created", subObject("active"), now));
    expect(created.status).toBe(200);
    let billing = await request(app).get(`${org(ctx)}/billing`).set(auth(ctx.owner));
    expect(billing.body.data.plan.code).toBe("PRO");
    expect(billing.body.data.subscription.status).toBe("ACTIVE");
    expect(billing.body.data.subscription.currentPeriodEnd).toBe(new Date(periodEnd * 1000).toISOString());

    const failed = await sendEvent(makeEvent("invoice.payment_failed", { id: "in_1", customer: "cus_test_1" }, now + 10));
    expect(failed.status).toBe(200);
    billing = await request(app).get(`${org(ctx)}/billing`).set(auth(ctx.owner));
    expect(billing.body.data.subscription.status).toBe("PAST_DUE");
    expect(billing.body.data.plan.code).toBe("PRO"); // grace period

    // An older event arriving late must not roll state back.
    await sendEvent(makeEvent("customer.subscription.updated", subObject("active"), now - 100));
    billing = await request(app).get(`${org(ctx)}/billing`).set(auth(ctx.owner));
    expect(billing.body.data.subscription.status).toBe("PAST_DUE");

    await sendEvent(makeEvent("customer.subscription.deleted", subObject("canceled"), now + 20));
    billing = await request(app).get(`${org(ctx)}/billing`).set(auth(ctx.owner));
    expect(billing.body.data.plan.code).toBe("FREE");
    expect(billing.body.data.subscription.status).toBe("CANCELED");
  });

  it("processes a duplicate delivery only once", async () => {
    const ctx = await setup();
    const event = makeEvent("customer.subscription.created", {
      id: "sub_dup",
      object: "subscription",
      status: "active",
      customer: "cus_dup",
      cancel_at_period_end: false,
      metadata: { organizationId: ctx.orgId },
      items: { data: [] },
    });
    expect((await sendEvent(event)).body.duplicate).toBeUndefined();
    const again = await sendEvent(event);
    expect(again.status).toBe(200);
    expect(again.body.duplicate).toBe(true);
    expect(await prisma.webhookEvent.count({ where: { eventId: event.id } })).toBe(1);
    expect(await prisma.auditLog.count({ where: { action: "billing.subscription.synced" } })).toBe(1);
  });

  it("never creates a subscription for an unidentifiable organization", async () => {
    await sendEvent(
      makeEvent("customer.subscription.created", {
        id: "sub_x",
        object: "subscription",
        status: "active",
        customer: "cus_unknown",
        cancel_at_period_end: false,
        metadata: { organizationId: "00000000-0000-4000-8000-000000000000" },
        items: { data: [] },
      }),
    );
    expect(await prisma.platformSubscription.count()).toBe(0);
  });
});

describe("client invoices (staff)", () => {
  it("creates invoices with server-computed totals and sequential numbers", async () => {
    const ctx = await setup();
    const first = await request(app).post(`${org(ctx)}/invoices`).set(auth(ctx.manager)).send(invoiceBody(ctx));
    expect(first.status).toBe(201);
    expect(first.body.data).toMatchObject({ number: "INV-0001", status: "DRAFT", subtotalCents: 25000, totalCents: 24500, currency: "usd" });
    const second = await request(app).post(`${org(ctx)}/invoices`).set(auth(ctx.owner)).send(invoiceBody(ctx));
    expect(second.body.data.number).toBe("INV-0002");
  });

  it("enforces RBAC, tenancy and validation", async () => {
    const ctx = await setup();
    expect((await request(app).post(`${org(ctx)}/invoices`).set(auth(ctx.member)).send(invoiceBody(ctx))).status).toBe(403);
    expect((await request(app).get(`${org(ctx)}/invoices`).set(auth(ctx.member))).status).toBe(403);
    expect((await request(app).get(`${org(ctx)}/invoices`).set(auth(ctx.outsider))).status).toBe(404);

    const other = await createOrg(ctx.outsider, "Other Org");
    const crossOrgClient = await request(app).post(`${api}/organizations/${other}/invoices`).set(auth(ctx.outsider)).send(invoiceBody(ctx));
    expect(crossOrgClient.status).toBe(404); // client belongs to a different organization

    expect((await request(app).post(`${org(ctx)}/invoices`).set(auth(ctx.owner)).send(invoiceBody(ctx, { items: [] }))).status).toBe(400);
    expect((await request(app).post(`${org(ctx)}/invoices`).set(auth(ctx.owner)).send(invoiceBody(ctx, { dueDate: "2026-09-01" }))).status).toBe(400);
    expect((await request(app).post(`${org(ctx)}/invoices`).set(auth(ctx.owner)).send(invoiceBody(ctx, { discountCents: 999999 }))).status).toBe(422);

    const id = (await request(app).post(`${org(ctx)}/invoices`).set(auth(ctx.owner)).send(invoiceBody(ctx))).body.data.id;
    expect((await request(app).get(`${api}/organizations/${other}/invoices/${id}`).set(auth(ctx.outsider))).status).toBe(404);
  });

  it("edits drafts only, then sends and voids", async () => {
    const ctx = await setup();
    const id = (await request(app).post(`${org(ctx)}/invoices`).set(auth(ctx.owner)).send(invoiceBody(ctx))).body.data.id as string;
    const patched = await request(app)
      .patch(`${org(ctx)}/invoices/${id}`)
      .set(auth(ctx.owner))
      .send({ items: [{ description: "Only", quantity: 1, unitAmountCents: 9000 }], discountCents: 0, taxCents: 0 });
    expect(patched.status).toBe(200);
    expect(patched.body.data.totalCents).toBe(9000);

    expect((await request(app).post(`${org(ctx)}/invoices/${id}/send`).set(auth(ctx.owner))).status).toBe(200);
    expect((await request(app).post(`${org(ctx)}/invoices/${id}/send`).set(auth(ctx.owner))).status).toBe(409);
    expect((await request(app).patch(`${org(ctx)}/invoices/${id}`).set(auth(ctx.owner)).send({ notes: "x" })).status).toBe(409);

    const voided = await request(app).post(`${org(ctx)}/invoices/${id}/void`).set(auth(ctx.owner));
    expect(voided.status).toBe(200);
    expect(voided.body.data.status).toBe("VOID");
    expect((await request(app).post(`${org(ctx)}/invoices/${id}/void`).set(auth(ctx.owner))).status).toBe(409);
  });
});

describe("client invoices (portal + payment)", () => {
  it("shows a client only sent invoices of their own organization, and honors project grants", async () => {
    const ctx = await setup();
    const draft = (await request(app).post(`${org(ctx)}/invoices`).set(auth(ctx.owner)).send(invoiceBody(ctx))).body.data.id;
    const open = await openInvoice(ctx);

    const list = await request(app).get(`${api}/portal/invoices`).set(bearer(ctx.clientToken));
    expect(list.status).toBe(200);
    expect(list.body.data.invoices.map((i: { id: string }) => i.id)).toEqual([open]);
    expect(JSON.stringify(list.body)).not.toMatch(/stripe|clientId|createdBy/i);
    expect((await request(app).get(`${api}/portal/invoices/${draft}`).set(bearer(ctx.clientToken))).status).toBe(404);

    // A different client organization in the same agency sees nothing of Acme's.
    const other = await request(app).post(`${org(ctx)}/clients`).set(auth(ctx.owner)).send({ name: "Beta LLC" });
    const otherToken = await portalContact(ctx, other.body.data.client.id, "bob@beta.test");
    expect((await request(app).get(`${api}/portal/invoices/${open}`).set(bearer(otherToken))).status).toBe(404);
    expect((await request(app).post(`${api}/portal/invoices/${open}/checkout`).set(bearer(otherToken))).status).toBe(404);

    // Project-linked invoice: a contact without a grant on that project cannot see it.
    const second = await request(app).post(`${org(ctx)}/projects`).set(auth(ctx.owner)).send({ name: "Mobile" });
    const pid = second.body.data.project.id as string;
    await request(app).post(`${org(ctx)}/clients/${ctx.clientId}/projects`).set(auth(ctx.owner)).send({ projectId: pid });
    const linked = await openInvoice(ctx, { projectId: pid });
    expect((await request(app).get(`${api}/portal/invoices/${linked}`).set(bearer(ctx.clientToken))).status).toBe(404);

    expect((await request(app).get(`${api}/portal/invoices`)).status).toBe(401);
  });

  it("checkout charges the stored total, and the redirect alone never marks the invoice paid", async () => {
    const ctx = await setup();
    const id = await openInvoice(ctx);
    const sessionId = await startCheckout(ctx, id);

    const call = stripeMock.checkout.sessions.create.mock.calls[0]![0] as unknown as {
      line_items: Array<{ price_data: { unit_amount: number; currency: string } }>;
    };
    expect(call.line_items[0]!.price_data).toMatchObject({ unit_amount: 24500, currency: "usd" });

    const payment = await prisma.clientInvoicePayment.findUniqueOrThrow({ where: { stripeCheckoutSessionId: sessionId } });
    expect(payment).toMatchObject({ status: "PENDING", amountCents: 24500 });
    expect((await prisma.clientInvoice.findUniqueOrThrow({ where: { id } })).status).toBe("OPEN");

    const draft = (await request(app).post(`${org(ctx)}/invoices`).set(auth(ctx.owner)).send(invoiceBody(ctx))).body.data.id;
    expect((await request(app).post(`${api}/portal/invoices/${draft}/checkout`).set(bearer(ctx.clientToken))).status).toBe(404);
  });

  it("redirects to the shared /payment pages and payment-status reflects only webhook-confirmed state", async () => {
    const ctx = await setup();
    const id = await openInvoice(ctx);
    const status = (sessionId?: string, token = ctx.clientToken) =>
      request(app)
        .get(`${api}/portal/invoices/${id}/payment-status${sessionId ? `?session_id=${sessionId}` : ""}`)
        .set(bearer(token));

    // Before any checkout: nothing is confirmed and there is no payment attempt.
    expect((await status()).body.data).toEqual({ invoiceStatus: "OPEN", confirmed: false, payment: null });

    const sessionId = await startCheckout(ctx, id);
    const params = stripeMock.checkout.sessions.create.mock.calls.at(-1)![0] as unknown as { success_url: string; cancel_url: string };
    expect(params.success_url).toBe(
      `http://web.test/payment/success?type=invoice&invoiceId=${id}&session_id={CHECKOUT_SESSION_ID}`,
    );
    expect(params.cancel_url).toBe(`http://web.test/payment/cancel?type=invoice&invoiceId=${id}`);

    // Coming back from Stripe is not proof: still pending and unconfirmed.
    const pending = await status(sessionId);
    expect(pending.status).toBe(200);
    expect(pending.body.data).toMatchObject({ invoiceStatus: "OPEN", confirmed: false, payment: { status: "PENDING", paidAt: null } });
    expect((await status("cs_other")).body.data.payment).toBeNull();

    await sendEvent(makeEvent("checkout.session.completed", paidSession(sessionId, 24500)));
    const paid = await status(sessionId);
    expect(paid.body.data).toMatchObject({ invoiceStatus: "PAID", confirmed: true, payment: { status: "SUCCEEDED" } });
    expect(paid.body.data.payment.paidAt).toBeTruthy();
    expect(JSON.stringify(paid.body)).not.toMatch(/stripe|pi_test/i);

    // Authentication and scoping.
    expect((await request(app).get(`${api}/portal/invoices/${id}/payment-status`)).status).toBe(401);
    const draft = (await request(app).post(`${org(ctx)}/invoices`).set(auth(ctx.owner)).send(invoiceBody(ctx))).body.data.id;
    expect((await request(app).get(`${api}/portal/invoices/${draft}/payment-status`).set(bearer(ctx.clientToken))).status).toBe(404);
    expect((await request(app).get(`${api}/portal/invoices/nope/payment-status`).set(bearer(ctx.clientToken))).status).toBe(400);
  });

  it("marks the invoice PAID from a verified webhook, notifies staff, and is idempotent", async () => {
    const ctx = await setup();
    const id = await openInvoice(ctx);
    const sessionId = await startCheckout(ctx, id);

    const event = makeEvent("checkout.session.completed", paidSession(sessionId, 24500));
    expect((await sendEvent(event)).status).toBe(200);

    const invoice = await prisma.clientInvoice.findUniqueOrThrow({ where: { id }, include: { payments: true } });
    expect(invoice.status).toBe("PAID");
    expect(invoice.paidAt).not.toBeNull();
    expect(invoice.payments[0]).toMatchObject({ status: "SUCCEEDED", stripePaymentIntentId: "pi_test_1" });
    expect(await prisma.notification.count({ where: { type: "INVOICE_PAID" } })).toBe(2); // owner + manager

    // Same event again, and a different event for the same session: still exactly one effect.
    expect((await sendEvent(event)).body.duplicate).toBe(true);
    await sendEvent(makeEvent("checkout.session.async_payment_succeeded", paidSession(sessionId, 24500)));
    expect(await prisma.notification.count({ where: { type: "INVOICE_PAID" } })).toBe(2);
    expect(await prisma.auditLog.count({ where: { action: "invoice.paid" } })).toBe(1);

    expect((await request(app).post(`${api}/portal/invoices/${id}/checkout`).set(bearer(ctx.clientToken))).status).toBe(409);
    expect((await request(app).post(`${org(ctx)}/invoices/${id}/void`).set(auth(ctx.owner))).status).toBe(409);
    const view = await request(app).get(`${org(ctx)}/invoices/${id}`).set(auth(ctx.owner));
    expect(view.body.data.status).toBe("PAID");
  });

  it("refuses to mark paid when the paid amount does not match", async () => {
    const ctx = await setup();
    const id = await openInvoice(ctx);
    const sessionId = await startCheckout(ctx, id);
    await sendEvent(makeEvent("checkout.session.completed", paidSession(sessionId, 100)));

    const invoice = await prisma.clientInvoice.findUniqueOrThrow({ where: { id }, include: { payments: true } });
    expect(invoice.status).toBe("OPEN");
    expect(invoice.payments[0]!.status).toBe("FAILED");
    expect(await prisma.auditLog.count({ where: { action: "invoice.payment.mismatch" } })).toBe(1);
  });

  it("records failed and expired payments without touching the invoice", async () => {
    const ctx = await setup();
    const id = await openInvoice(ctx);
    const s1 = await startCheckout(ctx, id);
    await sendEvent(makeEvent("checkout.session.async_payment_failed", paidSession(s1, 24500, { payment_status: "unpaid" })));
    const s2 = await startCheckout(ctx, id);
    await sendEvent(makeEvent("checkout.session.expired", paidSession(s2, 24500, { payment_status: "unpaid" })));

    const payments = await prisma.clientInvoicePayment.findMany({ where: { invoiceId: id }, orderBy: { createdAt: "asc" } });
    expect(payments.map((p) => p.status)).toEqual(["FAILED", "CANCELED"]);
    expect((await prisma.clientInvoice.findUniqueOrThrow({ where: { id } })).status).toBe("OPEN");
  });

  it("does not mark paid while an async payment is still processing", async () => {
    const ctx = await setup();
    const id = await openInvoice(ctx);
    const sessionId = await startCheckout(ctx, id);
    await sendEvent(makeEvent("checkout.session.completed", paidSession(sessionId, 24500, { payment_status: "unpaid" })));
    expect((await prisma.clientInvoice.findUniqueOrThrow({ where: { id } })).status).toBe("OPEN");
    await sendEvent(makeEvent("checkout.session.async_payment_succeeded", paidSession(sessionId, 24500)));
    expect((await prisma.clientInvoice.findUniqueOrThrow({ where: { id } })).status).toBe("PAID");
  });

  it("voiding cancels pending payments and expires the Stripe session; a late payment is flagged", async () => {
    const ctx = await setup();
    const id = await openInvoice(ctx);
    const sessionId = await startCheckout(ctx, id);
    expect((await request(app).post(`${org(ctx)}/invoices/${id}/void`).set(auth(ctx.owner))).status).toBe(200);

    expect(stripeMock.checkout.sessions.expire).toHaveBeenCalledWith(sessionId);
    expect((await prisma.clientInvoicePayment.findUniqueOrThrow({ where: { stripeCheckoutSessionId: sessionId } })).status).toBe("CANCELED");

    await sendEvent(makeEvent("checkout.session.completed", paidSession(sessionId, 24500)));
    expect((await prisma.clientInvoice.findUniqueOrThrow({ where: { id } })).status).toBe("VOID");
    expect(await prisma.auditLog.count({ where: { action: "invoice.payment.received_on_closed_invoice" } })).toBe(1);
    expect(await prisma.notification.count({ where: { type: "INVOICE_PAYMENT_ATTENTION" } })).toBe(2);
  });
});

describe("invoice PDF", () => {
  const pdfData = {
    number: "INV-0042",
    status: "OPEN" as const,
    issueDate: new Date("2026-10-01"),
    dueDate: new Date("2026-10-31"),
    paidAt: null,
    currency: "usd",
    subtotalCents: 25000,
    taxCents: 500,
    discountCents: 1000,
    totalCents: 24500,
    notes: "Thank you for your business",
    sellerName: "Agency Co",
    clientName: "Acme Corp",
    projectName: "Website",
    items: [{ description: "Design work", quantity: 2, unitAmountCents: 10000, amountCents: 20000 }],
  };

  it("renders a valid PDF containing the invoice details", async () => {
    const buffer = await renderInvoicePdf(pdfData, { compress: false });
    expect(buffer.subarray(0, 5).toString()).toBe("%PDF-");
    expect(buffer.length).toBeGreaterThan(1000);
    const text = buffer.toString("latin1");
    expect(text).toMatch(/%%EOF\s*$/);
    // PDFKit writes text as kerned hex runs: [<494e56> 80 <2d30303432>] TJ — decode them back.
    const shown = [...text.matchAll(/\[(.*?)\] TJ/g)].map((m) =>
      [...(m[1] ?? "").matchAll(/<([0-9a-f]*)>/g)].map((h) => Buffer.from(h[1] ?? "", "hex").toString("latin1")).join(""),
    );
    for (const needle of ["INV-0042", "Acme Corp", "Design work", "$245.00"]) {
      expect(shown).toContain(needle);
    }
  });

  it("paginates long invoices without failing", async () => {
    const items = Array.from({ length: 80 }, (_, i) => ({
      description: `Line item number ${i + 1} with a reasonably long description to wrap`,
      quantity: 1,
      unitAmountCents: 100,
      amountCents: 100,
    }));
    const buffer = await renderInvoicePdf({ ...pdfData, items }, { compress: false });
    const pages = buffer.toString("latin1").match(/\/Type \/Page\b/g) ?? [];
    expect(pages.length).toBeGreaterThan(1);
  });

  it("queues generation when an invoice is sent and when it is paid", async () => {
    const ctx = await setup();
    const id = await openInvoice(ctx);
    expect(enqueueMock).toHaveBeenCalledWith(id);

    enqueueMock.mockClear();
    const sessionId = await startCheckout(ctx, id);
    await sendEvent(makeEvent("checkout.session.completed", paidSession(sessionId, 24500)));
    expect(enqueueMock).toHaveBeenCalledTimes(1);
    expect(enqueueMock).toHaveBeenCalledWith(id);
  });

  it("generates and stores the PDF, replaces it on regeneration, and skips drafts and unknown ids", async () => {
    const ctx = await setup();
    const draft = (await request(app).post(`${org(ctx)}/invoices`).set(auth(ctx.owner)).send(invoiceBody(ctx))).body.data.id as string;
    expect(await generateInvoicePdf(draft)).toBe("skipped");
    expect(await generateInvoicePdf("00000000-0000-4000-8000-000000000000")).toBe("skipped");

    const id = await openInvoice(ctx);
    expect(await generateInvoicePdf(id)).toBe("generated");
    const first = await prisma.clientInvoice.findUniqueOrThrow({ where: { id } });
    expect(first.pdfUrl).toMatch(/invoice-\d+\.pdf$/);
    expect(first.pdfGeneratedAt).not.toBeNull();
    expect(destroyMock).not.toHaveBeenCalled();

    expect(await generateInvoicePdf(id)).toBe("generated");
    const second = await prisma.clientInvoice.findUniqueOrThrow({ where: { id } });
    expect(second.pdfPublicId).not.toBe(first.pdfPublicId);
    expect(destroyMock).toHaveBeenCalledWith(first.pdfPublicId);
  });

  it("exposes the PDF link to staff and the owning client only after generation", async () => {
    const ctx = await setup();
    const id = await openInvoice(ctx);
    const before = await request(app).get(`${api}/portal/invoices/${id}`).set(bearer(ctx.clientToken));
    expect(before.body.data.pdfUrl).toBeNull();

    await generateInvoicePdf(id);
    const portal = await request(app).get(`${api}/portal/invoices/${id}`).set(bearer(ctx.clientToken));
    expect(portal.body.data.pdfUrl).toMatch(/\.pdf$/);
    const staff = await request(app).get(`${org(ctx)}/invoices/${id}`).set(auth(ctx.owner));
    expect(staff.body.data.pdfUrl).toBe(portal.body.data.pdfUrl);
    expect(JSON.stringify(portal.body)).not.toContain("pdfPublicId");

    // Another agency's client contact still cannot see it.
    const other = await request(app).post(`${org(ctx)}/clients`).set(auth(ctx.owner)).send({ name: "Beta LLC" });
    const otherToken = await portalContact(ctx, other.body.data.client.id, "bob@beta.test");
    expect((await request(app).get(`${api}/portal/invoices/${id}`).set(bearer(otherToken))).status).toBe(404);
  });

  it("lets OWNER/MANAGER request regeneration but not members, outsiders or drafts", async () => {
    const ctx = await setup();
    const draft = (await request(app).post(`${org(ctx)}/invoices`).set(auth(ctx.owner)).send(invoiceBody(ctx))).body.data.id as string;
    expect((await request(app).post(`${org(ctx)}/invoices/${draft}/pdf`).set(auth(ctx.owner))).status).toBe(409);

    const id = await openInvoice(ctx);
    enqueueMock.mockClear();
    const res = await request(app).post(`${org(ctx)}/invoices/${id}/pdf`).set(auth(ctx.manager));
    expect(res.status).toBe(202);
    expect(res.body.data).toEqual({ queued: true });
    expect(enqueueMock).toHaveBeenCalledWith(id);

    expect((await request(app).post(`${org(ctx)}/invoices/${id}/pdf`).set(auth(ctx.member))).status).toBe(403);
    expect((await request(app).post(`${org(ctx)}/invoices/${id}/pdf`).set(auth(ctx.outsider))).status).toBe(404);
  });
});
