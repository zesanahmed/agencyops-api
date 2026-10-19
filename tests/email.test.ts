import { beforeEach, describe, expect, it, vi } from "vitest";
import { addMember, api, app, auth, createOrg, prisma, registerUser, request, resetDatabase } from "./helpers.js";
import { env } from "../src/config/env.js";
import { renderEmail } from "../src/modules/email/email.templates.js";
import { notifyInternal } from "../src/modules/client-collaboration/collaboration.service.js";
import { notifyMemberships } from "../src/modules/notification/notification.service.js";
import type { EmailJob } from "../src/modules/email/email.types.js";

// Redis is not touched in tests: the queue is replaced by a recorder.
const enqueueEmailQuietly = vi.fn<(job: EmailJob) => void>();
vi.mock("../src/modules/email/email.queue.js", () => ({
  EMAIL_QUEUE: "email",
  enqueueEmail: vi.fn(),
  enqueueEmailQuietly: (job: EmailJob) => enqueueEmailQuietly(job),
}));

const queued = (type: EmailJob["type"]) => enqueueEmailQuietly.mock.calls.map((c) => c[0]).filter((j) => j.type === type);

describe("email templates", () => {
  it("renders the organization invitation with a tokenized link and escapes dynamic text", () => {
    const message = renderEmail({
      type: "ORGANIZATION_INVITATION",
      to: "new@example.com",
      organizationName: "Acme <script>alert(1)</script>",
      inviterName: "Ana & Co",
      role: "TEAM_MEMBER",
      token: "tok123",
    });
    expect(message.to).toBe("new@example.com");
    expect(message.subject).toContain("Acme");
    expect(message.text).toContain("/invitations/accept?token=tok123");
    expect(message.html).toContain("/invitations/accept?token=tok123");
    expect(message.html).not.toContain("<script>");
    expect(message.html).toContain("Ana &amp; Co");
  });

  it("renders the client portal invite and a generic notification", () => {
    const invite = renderEmail({ type: "CLIENT_PORTAL_INVITE", to: "c@example.com", contactName: "Cleo", organizationName: "Acme", token: "abc" });
    expect(invite.text).toContain("/portal/accept-invite?token=abc");
    expect(invite.subject).toContain("Acme");

    const note = renderEmail({ type: "NOTIFICATION", to: "m@example.com", recipientName: "Max", title: "New client request", message: "Hello <b>x</b>" });
    expect(note.subject).toBe("New client request");
    expect(note.html).toContain("Hello &lt;b&gt;x&lt;/b&gt;");
    expect(note.text).toContain("Hi Max");
  });
});

describe("email provider", () => {
  async function fresh(key: string | undefined, production = false) {
    vi.resetModules();
    const { env: freshEnv } = await import("../src/config/env.js");
    freshEnv.email.resendApiKey = key;
    freshEnv.isProduction = production;
    return import("../src/modules/email/email.provider.js");
  }
  const message = { to: "to@example.com", subject: "Subject line", html: "<p>BODY-WITH-TOKEN</p>", text: "BODY-WITH-TOKEN" };

  it("sends through Resend with auth and an idempotency key", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const { getEmailProvider } = await fresh("re_test_key");
    await getEmailProvider().send(message, "job-1");

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.resend.com/emails");
    expect(init.headers).toMatchObject({ Authorization: "Bearer re_test_key", "Idempotency-Key": "job-1" });
    expect(JSON.parse(init.body as string)).toMatchObject({ to: ["to@example.com"], subject: "Subject line", text: "BODY-WITH-TOKEN" });
    vi.unstubAllGlobals();
  });

  it("fails (so the job is retried) without leaking the key or body when Resend rejects", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response('{"message":"bad"}', { status: 422 })));
    const { getEmailProvider } = await fresh("re_test_key");
    const error = await getEmailProvider().send(message, "job-2").then(
      () => undefined,
      (e: unknown) => e as Error,
    );
    expect(error?.message).toContain("422");
    expect(error?.message).not.toContain("re_test_key");
    expect(error?.message).not.toContain("BODY-WITH-TOKEN");
    vi.unstubAllGlobals();
  });

  it("without a key it only logs recipient and subject in development, and refuses in production", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const dev = await fresh(undefined);
    await dev.getEmailProvider().send(message, "job-3");
    const logged = log.mock.calls.flat().join(" ");
    expect(logged).toContain("to@example.com");
    expect(logged).toContain("Subject line");
    expect(logged).not.toContain("BODY-WITH-TOKEN");
    log.mockRestore();

    const prod = await fresh(undefined, true);
    expect(() => prod.getEmailProvider()).toThrowError(expect.objectContaining({ statusCode: 503 }));
  });
});

describe("invitation emails", () => {
  beforeEach(async () => {
    await resetDatabase();
    enqueueEmailQuietly.mockClear();
  });

  const invite = (token: string, orgId: string, email: string, role = "TEAM_MEMBER") =>
    request(app).post(`${api}/organizations/${orgId}/invitations`).set({ Authorization: `Bearer ${token}` }).send({ email, role });

  it("queues the invitation email with the real token and the right context", async () => {
    const owner = await registerUser("Olivia Owner");
    const orgId = await createOrg(owner, "Acme Studio");

    const res = await invite(owner.accessToken, orgId, "New.Person@Example.com", "MANAGER");
    expect(res.status).toBe(201);

    expect(queued("ORGANIZATION_INVITATION")).toEqual([
      {
        type: "ORGANIZATION_INVITATION",
        to: "new.person@example.com",
        organizationName: "Acme Studio",
        inviterName: "Olivia Owner",
        role: "MANAGER",
        token: res.body.data.inviteToken,
      },
    ]);
  });

  it("does not email when the invitation is rejected", async () => {
    const owner = await registerUser();
    const orgId = await createOrg(owner);
    expect((await invite(owner.accessToken, orgId, owner.email)).status).toBe(409);
    expect((await invite(owner.accessToken, orgId, "not-an-email")).status).toBe(400);
    expect(enqueueEmailQuietly).not.toHaveBeenCalled();
  });

  it("only returns the token to the inviter while email delivery is unconfigured", async () => {
    const owner = await registerUser();
    const orgId = await createOrg(owner);
    const saved = env.email.resendApiKey;
    env.email.resendApiKey = "re_configured";
    try {
      const res = await invite(owner.accessToken, orgId, "hidden@example.com");
      expect(res.status).toBe(201);
      expect(res.body.data.inviteToken).toBeUndefined();
      const [job] = queued("ORGANIZATION_INVITATION") as { token: string }[];
      expect(job).toBeDefined();
      expect(JSON.stringify(res.body)).not.toContain(job!.token);
    } finally {
      env.email.resendApiKey = saved;
    }
  });
});

describe("client portal invite emails", () => {
  beforeEach(async () => {
    await resetDatabase();
    enqueueEmailQuietly.mockClear();
  });

  it("emails the contact on create and on re-invite, and hides the token once email is configured", async () => {
    const owner = await registerUser("Olivia Owner");
    const orgId = await createOrg(owner, "Acme Studio");
    const h = auth(owner);
    const client = await request(app).post(`${api}/organizations/${orgId}/clients`).set(h).send({ name: "Globex" });
    const clientId = client.body.data.client.id as string;

    const created = await request(app)
      .post(`${api}/organizations/${orgId}/clients/${clientId}/contacts`)
      .set(h)
      .send({ name: "Cleo", email: "Cleo@Globex.test" });
    expect(created.status).toBe(201);
    const contactId = created.body.data.contact.id as string;
    expect(queued("CLIENT_PORTAL_INVITE")).toEqual([
      { type: "CLIENT_PORTAL_INVITE", to: "cleo@globex.test", contactName: "Cleo", organizationName: "Acme Studio", token: created.body.data.inviteToken },
    ]);

    const saved = env.email.resendApiKey;
    env.email.resendApiKey = "re_configured";
    try {
      const again = await request(app).post(`${api}/organizations/${orgId}/clients/${clientId}/contacts/${contactId}/reinvite`).set(h);
      expect(again.status).toBe(200);
      expect(again.body.data.inviteToken).toBeUndefined();
      const jobs = queued("CLIENT_PORTAL_INVITE") as { token: string }[];
      expect(jobs).toHaveLength(2);
      expect(jobs[1]!.token).not.toBe(jobs[0]!.token);
      expect(JSON.stringify(again.body)).not.toContain(jobs[1]!.token);
    } finally {
      env.email.resendApiKey = saved;
    }
  });
});

describe("notification delivery", () => {
  let orgId: string;
  let projectId: string;
  let taskId: string;
  let owner: Awaited<ReturnType<typeof registerUser>>;
  let manager: Awaited<ReturnType<typeof registerUser>>;
  let member: Awaited<ReturnType<typeof registerUser>>;
  let ownerMid: string;
  let managerMid: string;
  let memberMid: string;

  beforeEach(async () => {
    await resetDatabase();
    enqueueEmailQuietly.mockClear();
    owner = await registerUser("Olivia Owner");
    manager = await registerUser("Manny Manager");
    member = await registerUser("Maya Member");
    orgId = await createOrg(owner);
    ownerMid = (await prisma.membership.findFirstOrThrow({ where: { organizationId: orgId, userId: owner.id } })).id;
    managerMid = await addMember(orgId, manager, "MANAGER");
    memberMid = await addMember(orgId, member, "TEAM_MEMBER");
    const project = await prisma.project.create({ data: { organizationId: orgId, name: "P", slug: "p" } });
    projectId = project.id;
    taskId = (await prisma.task.create({ data: { projectId, title: "T" } })).id;
  });

  const comment = (mentioned: string[]) =>
    request(app)
      .post(`${api}/organizations/${orgId}/projects/${projectId}/tasks/${taskId}/comments`)
      .set(auth(owner))
      .send({ content: "Please look at this", mentionedMembershipIds: mentioned });
  const notificationsFor = (membershipId: string) => prisma.notification.findMany({ where: { recipientMembershipId: membershipId } });
  const emailsTo = () => (queued("NOTIFICATION") as { to: string }[]).map((j) => j.to).sort();

  it("a mention creates an in-app notification and an email for each mentioned member, never for the author", async () => {
    expect((await comment([memberMid, managerMid, ownerMid])).status).toBe(201);

    expect(await notificationsFor(memberMid)).toHaveLength(1);
    expect(await notificationsFor(managerMid)).toHaveLength(1);
    expect(await notificationsFor(ownerMid)).toHaveLength(0);
    expect(emailsTo()).toEqual([manager.email, member.email].sort());
    expect(queued("NOTIFICATION")[0]).toMatchObject({ title: "You were mentioned in a comment", message: "Please look at this" });
  });

  it("honours each channel's preference independently", async () => {
    const put = (user: typeof member, body: object) =>
      request(app).put(`${api}/organizations/${orgId}/notifications/preferences/MENTION`).set(auth(user)).send(body);
    expect((await put(member, { emailEnabled: false })).status).toBe(200);
    expect((await put(manager, { inAppEnabled: false })).status).toBe(200);

    await comment([memberMid, managerMid]);

    expect(await notificationsFor(memberMid)).toHaveLength(1); // in-app only
    expect(await notificationsFor(managerMid)).toHaveLength(0); // email only
    expect(emailsTo()).toEqual([manager.email]);
  });

  it("client activity reaches OWNERs, MANAGERs and project members — not other members", async () => {
    await notifyInternal({ organizationId: orgId, projectId, type: "CLIENT_MESSAGE", title: "New client message", message: "Hi", data: { projectId } });
    expect(emailsTo()).toEqual([manager.email, owner.email].sort());
    expect(await notificationsFor(memberMid)).toHaveLength(0);

    enqueueEmailQuietly.mockClear();
    await prisma.projectMember.create({ data: { projectId, membershipId: memberMid } });
    await notifyInternal({ organizationId: orgId, projectId, type: "CLIENT_MESSAGE", title: "New client message", message: "Hi", data: { projectId } });
    expect(emailsTo()).toEqual([manager.email, member.email, owner.email].sort());
  });

  it("never notifies or emails memberships outside the organization or removed members", async () => {
    const otherOwner = await registerUser("Other Owner");
    const otherOrgId = await createOrg(otherOwner, "Other");
    const otherMid = (await prisma.membership.findFirstOrThrow({ where: { organizationId: otherOrgId, userId: otherOwner.id } })).id;
    await prisma.membership.update({ where: { id: memberMid }, data: { status: "REMOVED", removedAt: new Date() } });

    await notifyMemberships({ organizationId: orgId, membershipIds: [otherMid, memberMid], type: "X", title: "T", message: "M" });

    expect(enqueueEmailQuietly).not.toHaveBeenCalled();
    expect(await prisma.notification.count()).toBe(0);
  });
});
