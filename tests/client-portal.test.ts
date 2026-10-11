import { beforeEach, describe, expect, it, vi } from "vitest";
import { addMember, api, app, auth, createOrg, PASSWORD, prisma, registerUser, request, resetDatabase } from "./helpers.js";
import type { TestUser } from "./helpers.js";

// Cloudinary is the only external dependency here — stub the network calls,
// keep every other real code path (signature check, auth, persistence).
let fileCounter = 0;
vi.mock("../src/lib/cloudinary.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/lib/cloudinary.js")>();
  return {
    ...actual,
    uploadBufferToCloudinary: vi.fn(async () => {
      fileCounter += 1;
      return { publicId: `internal-pid-${fileCounter}`, url: `https://res.cloudinary.test/asset-${fileCounter}` };
    }),
    destroyCloudinaryAsset: vi.fn(async () => undefined),
  };
});

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

const cookieOf = (res: { headers: Record<string, unknown> }): string =>
  (res.headers["set-cookie"] as unknown as string[])[0]!.split(";")[0]!;
const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

interface Ctx {
  owner: TestUser;
  manager: TestUser;
  member: TestUser;
  orgId: string;
  orgSlug: string;
  ownerMembershipId: string;
  memberMembershipId: string;
  clientId: string;
  projectId: string;
  contactId: string;
  clientToken: string; // portal access token for the primary contact
  clientCookie: string; // portal refresh cookie for the primary contact
  email: string;
}

const org = (ctx: { orgId: string }) => `${api}/organizations/${ctx.orgId}`;

async function createContact(ctx: Ctx, clientId: string, email: string) {
  const res = await request(app)
    .post(`${org(ctx)}/clients/${clientId}/contacts`)
    .set(auth(ctx.owner))
    .send({ name: "Jane Client", email });
  expect(res.status).toBe(201);
  return { contactId: res.body.data.contact.id as string, inviteToken: res.body.data.inviteToken as string };
}

async function acceptInvite(token: string, password = PASSWORD) {
  return request(app).post(`${api}/portal/auth/accept-invite`).send({ token, password });
}

async function setup(): Promise<Ctx> {
  const owner = await registerUser("Olivia Owner");
  const manager = await registerUser("Max Manager");
  const member = await registerUser("Tim Member");
  const orgId = await createOrg(owner, "Agency");
  await addMember(orgId, manager, "MANAGER");
  const memberMembershipId = await addMember(orgId, member, "TEAM_MEMBER");

  const orgRow = await prisma.organization.findUniqueOrThrow({ where: { id: orgId } });
  const ownerMembership = await prisma.membership.findFirstOrThrow({ where: { organizationId: orgId, userId: owner.id } });

  const clientRes = await request(app).post(`${api}/organizations/${orgId}/clients`).set(auth(owner)).send({ name: "Acme Corp" });
  const clientId = clientRes.body.data.client.id as string;
  const projectRes = await request(app).post(`${api}/organizations/${orgId}/projects`).set(auth(owner)).send({ name: "Website" });
  const projectId = projectRes.body.data.project.id as string;

  const ctx = {
    owner, manager, member, orgId, orgSlug: orgRow.slug,
    ownerMembershipId: ownerMembership.id, memberMembershipId,
    clientId, projectId, contactId: "", clientToken: "", clientCookie: "", email: "jane@acme.test",
  } satisfies Ctx;

  const link = await request(app).post(`${org(ctx)}/clients/${clientId}/projects`).set(auth(owner)).send({ projectId });
  expect(link.status).toBe(201);

  const { contactId, inviteToken } = await createContact(ctx, clientId, ctx.email);
  const grant = await request(app)
    .post(`${org(ctx)}/clients/${clientId}/contacts/${contactId}/access`)
    .set(auth(owner))
    .send({ projectId });
  expect(grant.status).toBe(201);

  const accepted = await acceptInvite(inviteToken);
  expect(accepted.status).toBe(201);

  return { ...ctx, contactId, clientToken: accepted.body.data.accessToken, clientCookie: cookieOf(accepted) };
}

beforeEach(async () => {
  await resetDatabase();
});

describe("internal client management (RBAC + tenancy)", () => {
  it("OWNER and MANAGER can create clients; TEAM_MEMBER can read but not create", async () => {
    const ctx = await setup();
    const asManager = await request(app).post(`${org(ctx)}/clients`).set(auth(ctx.manager)).send({ name: "Beta LLC" });
    expect(asManager.status).toBe(201);

    const asMember = await request(app).post(`${org(ctx)}/clients`).set(auth(ctx.member)).send({ name: "Nope Inc" });
    expect(asMember.status).toBe(403);

    const list = await request(app).get(`${org(ctx)}/clients`).set(auth(ctx.member));
    expect(list.status).toBe(200);
    expect(list.body.data.clients).toHaveLength(2);
  });

  it("never exposes password or invite-token hashes on contacts", async () => {
    const ctx = await setup();
    const res = await request(app).get(`${org(ctx)}/clients/${ctx.clientId}/contacts`).set(auth(ctx.owner));
    expect(res.status).toBe(200);
    const raw = JSON.stringify(res.body);
    expect(raw).not.toContain("passwordHash");
    expect(raw).not.toContain("inviteTokenHash");
  });

  it("a member of another organization cannot see or touch this org's clients", async () => {
    const ctx = await setup();
    const outsider = await registerUser("Olga Outsider");
    const otherOrg = await createOrg(outsider, "Other Agency");

    const viaOwnOrg = await request(app).get(`${api}/organizations/${otherOrg}/clients/${ctx.clientId}`).set(auth(outsider));
    expect(viaOwnOrg.status).toBe(404);

    const viaForeignOrg = await request(app).get(`${org(ctx)}/clients/${ctx.clientId}`).set(auth(outsider));
    expect(viaForeignOrg.status).toBe(404);

    const grantAcross = await request(app)
      .post(`${api}/organizations/${otherOrg}/clients/${ctx.clientId}/projects`)
      .set(auth(outsider))
      .send({ projectId: ctx.projectId });
    expect(grantAcross.status).toBe(404);
  });

  it("rejects a duplicate contact email within the organization with 409", async () => {
    const ctx = await setup();
    const dup = await request(app)
      .post(`${org(ctx)}/clients/${ctx.clientId}/contacts`)
      .set(auth(ctx.owner))
      .send({ name: "Dup", email: ctx.email });
    expect(dup.status).toBe(409);
  });

  it("validates input and ids", async () => {
    const ctx = await setup();
    const badBody = await request(app).post(`${org(ctx)}/clients`).set(auth(ctx.owner)).send({ name: "x" });
    expect(badBody.status).toBe(400);
    const badId = await request(app).get(`${org(ctx)}/clients/not-a-uuid`).set(auth(ctx.owner));
    expect(badId.status).toBe(400);
  });

  it("refuses to grant access to a project linked to a different client, or not linked at all", async () => {
    const ctx = await setup();
    const other = await request(app).post(`${org(ctx)}/clients`).set(auth(ctx.owner)).send({ name: "Beta LLC" });
    const otherClientId = other.body.data.client.id as string;
    const { contactId } = await createContact(ctx, otherClientId, "bob@beta.test");

    const wrongClient = await request(app)
      .post(`${org(ctx)}/clients/${otherClientId}/contacts/${contactId}/access`)
      .set(auth(ctx.owner))
      .send({ projectId: ctx.projectId }); // linked to Acme, not Beta
    expect(wrongClient.status).toBe(404);

    const relink = await request(app)
      .post(`${org(ctx)}/clients/${otherClientId}/projects`)
      .set(auth(ctx.owner))
      .send({ projectId: ctx.projectId });
    expect(relink.status).toBe(409);
  });

  it("writes audit log entries for access grant and revoke", async () => {
    const ctx = await setup();
    await request(app).delete(`${org(ctx)}/clients/${ctx.clientId}/contacts/${ctx.contactId}/access/${ctx.projectId}`).set(auth(ctx.owner));
    const actions = (await prisma.auditLog.findMany({ where: { organizationId: ctx.orgId } })).map((a) => a.action);
    expect(actions).toContain("client.access.granted");
    expect(actions).toContain("client.access.revoked");
  });
});

describe("portal authentication", () => {
  it("accept-invite activates the contact, sets a client refresh cookie, and is one-time", async () => {
    const ctx = await setup();
    const { inviteToken } = await createContact(ctx, ctx.clientId, "second@acme.test");

    const first = await acceptInvite(inviteToken);
    expect(first.status).toBe(201);
    expect(first.body.data.accessToken).toBeTypeOf("string");
    expect(first.headers["set-cookie"]).toBeDefined();
    expect(JSON.stringify(first.body)).not.toContain("passwordHash");

    const second = await acceptInvite(inviteToken);
    expect(second.status).toBe(400);
  });

  it("rejects an expired invitation and a garbage token", async () => {
    const ctx = await setup();
    const { contactId, inviteToken } = await createContact(ctx, ctx.clientId, "late@acme.test");
    await prisma.clientContact.update({ where: { id: contactId }, data: { inviteExpiresAt: new Date(Date.now() - 1000) } });
    expect((await acceptInvite(inviteToken)).status).toBe(400);
    expect((await acceptInvite("0".repeat(64))).status).toBe(400);
  });

  it("login works for an active contact and gives the SAME generic error for every failure", async () => {
    const ctx = await setup();
    const ok = await request(app).post(`${api}/portal/auth/login`).send({ organizationSlug: ctx.orgSlug, email: ctx.email, password: PASSWORD });
    expect(ok.status).toBe(200);

    const wrongPassword = await request(app).post(`${api}/portal/auth/login`).send({ organizationSlug: ctx.orgSlug, email: ctx.email, password: "WrongPassword999" });
    const unknownEmail = await request(app).post(`${api}/portal/auth/login`).send({ organizationSlug: ctx.orgSlug, email: "ghost@acme.test", password: PASSWORD });
    const unknownOrg = await request(app).post(`${api}/portal/auth/login`).send({ organizationSlug: "no-such-agency", email: ctx.email, password: PASSWORD });
    for (const res of [wrongPassword, unknownEmail, unknownOrg]) {
      expect(res.status).toBe(401);
      expect(res.body.message).toBe("Invalid credentials");
    }
  });

  it("a contact who has not accepted their invitation cannot log in", async () => {
    const ctx = await setup();
    await createContact(ctx, ctx.clientId, "pending@acme.test");
    const res = await request(app).post(`${api}/portal/auth/login`).send({ organizationSlug: ctx.orgSlug, email: "pending@acme.test", password: PASSWORD });
    expect(res.status).toBe(401);
  });

  it("refresh rotates the cookie and the old one stops working", async () => {
    const ctx = await setup();
    const refreshed = await request(app).post(`${api}/portal/auth/refresh`).set("Cookie", ctx.clientCookie);
    expect(refreshed.status).toBe(200);
    expect(refreshed.body.data.accessToken).toBeTypeOf("string");

    const reuse = await request(app).post(`${api}/portal/auth/refresh`).set("Cookie", ctx.clientCookie);
    expect(reuse.status).toBe(401);
  });

  it("logout revokes the session; logout-all revokes every session", async () => {
    const ctx = await setup();
    await request(app).post(`${api}/portal/auth/logout`).set("Cookie", ctx.clientCookie);
    expect((await request(app).post(`${api}/portal/auth/refresh`).set("Cookie", ctx.clientCookie)).status).toBe(401);
    expect((await request(app).get(`${api}/portal/projects`).set(bearer(ctx.clientToken))).status).toBe(401);

    const login = await request(app).post(`${api}/portal/auth/login`).send({ organizationSlug: ctx.orgSlug, email: ctx.email, password: PASSWORD });
    const token = login.body.data.accessToken as string;
    const cookie = cookieOf(login);
    expect((await request(app).post(`${api}/portal/auth/logout-all`).set(bearer(token))).status).toBe(200);
    expect((await request(app).post(`${api}/portal/auth/refresh`).set("Cookie", cookie)).status).toBe(401);
  });

  it("requires authentication on portal data routes", async () => {
    const ctx = await setup();
    expect((await request(app).get(`${api}/portal/projects`)).status).toBe(401);
    expect((await request(app).get(`${api}/portal/projects/${ctx.projectId}`)).status).toBe(401);
    expect((await request(app).get(`${api}/portal/projects`).set(bearer("garbage"))).status).toBe(401);
  });
});

describe("security boundary between internal users and client contacts", () => {
  it("a client access token is rejected by every internal endpoint", async () => {
    const ctx = await setup();
    expect((await request(app).get(`${api}/auth/me`).set(bearer(ctx.clientToken))).status).toBe(401);
    expect((await request(app).get(`${api}/organizations`).set(bearer(ctx.clientToken))).status).toBe(401);
    expect((await request(app).get(`${org(ctx)}/clients`).set(bearer(ctx.clientToken))).status).toBe(401);
    expect((await request(app).get(`${org(ctx)}/projects/${ctx.projectId}/tasks`).set(bearer(ctx.clientToken))).status).toBe(401);
  });

  it("an internal access token is rejected by the portal", async () => {
    const ctx = await setup();
    expect((await request(app).get(`${api}/portal/projects`).set(auth(ctx.owner))).status).toBe(401);
    expect((await request(app).get(`${api}/portal/auth/me`).set(auth(ctx.owner))).status).toBe(401);
  });

  it("an internal refresh cookie cannot be used at the portal refresh endpoint", async () => {
    const ctx = await setup();
    const login = await request(app).post(`${api}/auth/login`).send({ email: ctx.owner.email, password: PASSWORD });
    const internalCookie = cookieOf(login);
    expect((await request(app).post(`${api}/portal/auth/refresh`).set("Cookie", internalCookie)).status).toBe(401);
  });
});

describe("explicit project access", () => {
  it("lists only granted projects and returns 404 for anything else", async () => {
    const ctx = await setup();
    const second = await request(app).post(`${org(ctx)}/projects`).set(auth(ctx.owner)).send({ name: "Secret Internal Tool" });
    const secretProjectId = second.body.data.project.id as string;
    // Same client, but NO access grant for this contact.
    await request(app).post(`${org(ctx)}/clients/${ctx.clientId}/projects`).set(auth(ctx.owner)).send({ projectId: secretProjectId });

    const list = await request(app).get(`${api}/portal/projects`).set(bearer(ctx.clientToken));
    expect(list.status).toBe(200);
    expect(list.body.data.projects.map((p: { id: string }) => p.id)).toEqual([ctx.projectId]);

    for (const path of ["", "/tasks", "/updates", "/messages", "/requests", "/files"]) {
      const res = await request(app).get(`${api}/portal/projects/${secretProjectId}${path}`).set(bearer(ctx.clientToken));
      expect(res.status, `GET ${path}`).toBe(404);
    }
    expect((await request(app).post(`${api}/portal/projects/${secretProjectId}/messages`).set(bearer(ctx.clientToken)).send({ content: "hi" })).status).toBe(404);
  });

  it("a contact of one agency can never reach another agency's project", async () => {
    const ctx = await setup();
    const rival = await registerUser("Rita Rival");
    const rivalOrg = await createOrg(rival, "Rival Agency");
    const proj = await request(app).post(`${api}/organizations/${rivalOrg}/projects`).set(auth(rival)).send({ name: "Rival Project" });
    const res = await request(app).get(`${api}/portal/projects/${proj.body.data.project.id}`).set(bearer(ctx.clientToken));
    expect(res.status).toBe(404);
  });

  it("revoking access takes effect immediately for a still-valid token", async () => {
    const ctx = await setup();
    expect((await request(app).get(`${api}/portal/projects/${ctx.projectId}`).set(bearer(ctx.clientToken))).status).toBe(200);
    await request(app).delete(`${org(ctx)}/clients/${ctx.clientId}/contacts/${ctx.contactId}/access/${ctx.projectId}`).set(auth(ctx.owner));
    expect((await request(app).get(`${api}/portal/projects/${ctx.projectId}`).set(bearer(ctx.clientToken))).status).toBe(404);
  });

  it("unlinking a project from its client removes access for all contacts", async () => {
    const ctx = await setup();
    const res = await request(app).delete(`${org(ctx)}/clients/${ctx.clientId}/projects/${ctx.projectId}`).set(auth(ctx.owner));
    expect(res.status).toBe(200);
    expect((await request(app).get(`${api}/portal/projects/${ctx.projectId}`).set(bearer(ctx.clientToken))).status).toBe(404);
    expect(await prisma.clientProjectAccess.count({ where: { projectId: ctx.projectId } })).toBe(0);
  });

  it("disabling a contact cuts off an existing access token and refresh immediately", async () => {
    const ctx = await setup();
    const res = await request(app).delete(`${org(ctx)}/clients/${ctx.clientId}/contacts/${ctx.contactId}`).set(auth(ctx.owner));
    expect(res.status).toBe(200);
    expect((await request(app).get(`${api}/portal/projects`).set(bearer(ctx.clientToken))).status).toBe(401);
    expect((await request(app).post(`${api}/portal/auth/refresh`).set("Cookie", ctx.clientCookie)).status).toBe(401);
    const login = await request(app).post(`${api}/portal/auth/login`).send({ organizationSlug: ctx.orgSlug, email: ctx.email, password: PASSWORD });
    expect(login.status).toBe(401);
  });

  it("soft-deleting the client organization cuts off every contact", async () => {
    const ctx = await setup();
    expect((await request(app).delete(`${org(ctx)}/clients/${ctx.clientId}`).set(auth(ctx.owner))).status).toBe(200);
    expect((await request(app).get(`${api}/portal/projects`).set(bearer(ctx.clientToken))).status).toBe(401);
    expect((await request(app).get(`${org(ctx)}/clients/${ctx.clientId}`).set(auth(ctx.owner))).status).toBe(404);
  });
});

describe("tasks, progress and updates as seen by the client", () => {
  it("shows only client-visible tasks, with no internal fields, and reports progress", async () => {
    const ctx = await setup();
    const mk = (title: string, status?: string) =>
      request(app).post(`${org(ctx)}/projects/${ctx.projectId}/tasks`).set(auth(ctx.owner)).send({ title, ...(status ? { status } : {}), assigneeMembershipId: ctx.memberMembershipId });
    const visible = (await mk("Design homepage", "DONE")).body.data.task.id as string;
    await mk("Internal refactor");
    await mk("Write copy", "IN_PROGRESS");

    // Default is hidden.
    const before = await request(app).get(`${api}/portal/projects/${ctx.projectId}/tasks`).set(bearer(ctx.clientToken));
    expect(before.body.data.tasks).toHaveLength(0);

    // TEAM_MEMBER cannot flip visibility; MANAGER can.
    const denied = await request(app).patch(`${org(ctx)}/client-portal/projects/${ctx.projectId}/tasks/${visible}/visibility`).set(auth(ctx.member)).send({ clientVisible: true });
    expect(denied.status).toBe(403);
    const ok = await request(app).patch(`${org(ctx)}/client-portal/projects/${ctx.projectId}/tasks/${visible}/visibility`).set(auth(ctx.manager)).send({ clientVisible: true });
    expect(ok.status).toBe(200);

    const after = await request(app).get(`${api}/portal/projects/${ctx.projectId}/tasks`).set(bearer(ctx.clientToken));
    expect(after.body.data.tasks).toHaveLength(1);
    expect(after.body.data.tasks[0].title).toBe("Design homepage");
    const raw = JSON.stringify(after.body);
    for (const leaked of ["assignee", "collaborator", "organizationId", "projectId", "clientVisible", ctx.memberMembershipId]) {
      expect(raw, `leaked ${leaked}`).not.toContain(leaked);
    }

    // Progress counts every top-level task (counts only — no titles leaked).
    const project = await request(app).get(`${api}/portal/projects/${ctx.projectId}`).set(bearer(ctx.clientToken));
    expect(project.body.data.project.progress).toMatchObject({ totalTasks: 3, completedTasks: 1, percentComplete: 33 });
    expect(JSON.stringify(project.body)).not.toContain("Internal refactor");
    expect(JSON.stringify(project.body)).not.toContain("organizationId");
  });

  it("clients read staff updates; only staff can post them", async () => {
    const ctx = await setup();
    const post = await request(app).post(`${org(ctx)}/client-portal/projects/${ctx.projectId}/updates`).set(auth(ctx.manager)).send({ title: "Milestone 1", body: "Homepage is live on staging." });
    expect(post.status).toBe(201);
    expect((await request(app).post(`${org(ctx)}/client-portal/projects/${ctx.projectId}/updates`).set(auth(ctx.member)).send({ title: "x", body: "y" })).status).toBe(403);

    const seen = await request(app).get(`${api}/portal/projects/${ctx.projectId}/updates`).set(bearer(ctx.clientToken));
    expect(seen.body.data.updates).toHaveLength(1);
    expect(seen.body.data.updates[0]).toMatchObject({ title: "Milestone 1", author: { name: "Max Manager" } });

    // The portal exposes no write route for updates.
    expect((await request(app).post(`${api}/portal/projects/${ctx.projectId}/updates`).set(bearer(ctx.clientToken)).send({ title: "x", body: "y" })).status).toBe(404);
  });
});

describe("messages and requests", () => {
  it("client and staff share a message thread; soft-deleted messages disappear", async () => {
    const ctx = await setup();
    const fromClient = await request(app).post(`${api}/portal/projects/${ctx.projectId}/messages`).set(bearer(ctx.clientToken)).send({ content: "When is the next demo?" });
    expect(fromClient.status).toBe(201);
    expect(fromClient.body.data.message.author).toEqual({ type: "CLIENT", name: "Jane Client" });

    const reply = await request(app).post(`${org(ctx)}/client-portal/projects/${ctx.projectId}/messages`).set(auth(ctx.manager)).send({ content: "Friday at 3pm." });
    expect(reply.status).toBe(201);

    const thread = await request(app).get(`${api}/portal/projects/${ctx.projectId}/messages`).set(bearer(ctx.clientToken));
    expect(thread.body.data.messages.map((m: { author: { type: string } }) => m.author.type)).toEqual(["CLIENT", "STAFF"]);

    const del = await request(app).delete(`${org(ctx)}/client-portal/projects/${ctx.projectId}/messages/${fromClient.body.data.message.id}`).set(auth(ctx.manager));
    expect(del.status).toBe(200);
    const after = await request(app).get(`${api}/portal/projects/${ctx.projectId}/messages`).set(bearer(ctx.clientToken));
    expect(after.body.data.messages).toHaveLength(1);
  });

  it("client requests reach the staff inbox, notify the right people, and show status back to the client", async () => {
    const ctx = await setup();
    const created = await request(app)
      .post(`${api}/portal/projects/${ctx.projectId}/requests`)
      .set(bearer(ctx.clientToken))
      .send({ type: "CHANGE_REQUEST", title: "Add dark mode", description: "Please add a dark theme to the dashboard." });
    expect(created.status).toBe(201);
    const requestId = created.body.data.request.id as string;

    // Invalid type is rejected.
    const bad = await request(app).post(`${api}/portal/projects/${ctx.projectId}/requests`).set(bearer(ctx.clientToken)).send({ type: "WISH", title: "x", description: "y" });
    expect(bad.status).toBe(400);

    // Staff inbox.
    const inbox = await request(app).get(`${org(ctx)}/client-portal/requests?status=OPEN`).set(auth(ctx.member));
    expect(inbox.status).toBe(200);
    expect(inbox.body.data.requests[0]).toMatchObject({ id: requestId, contact: { name: "Jane Client", email: ctx.email } });

    // Owner/manager notified; an unrelated TEAM_MEMBER (not on the project) is not.
    const ownerNotes = await prisma.notification.count({ where: { recipientMembershipId: ctx.ownerMembershipId, type: "CLIENT_REQUEST" } });
    const memberNotes = await prisma.notification.count({ where: { recipientMembershipId: ctx.memberMembershipId, type: "CLIENT_REQUEST" } });
    expect(ownerNotes).toBe(1);
    expect(memberNotes).toBe(0);

    // TEAM_MEMBER cannot triage; MANAGER can.
    expect((await request(app).patch(`${org(ctx)}/client-portal/requests/${requestId}`).set(auth(ctx.member)).send({ status: "RESOLVED" })).status).toBe(403);
    const resolved = await request(app).patch(`${org(ctx)}/client-portal/requests/${requestId}`).set(auth(ctx.manager)).send({ status: "RESOLVED", resolutionNote: "Shipped in v1.2" });
    expect(resolved.status).toBe(200);
    expect(resolved.body.data.request.resolvedAt).not.toBeNull();

    const mine = await request(app).get(`${api}/portal/projects/${ctx.projectId}/requests`).set(bearer(ctx.clientToken));
    expect(mine.body.data.requests[0]).toMatchObject({ status: "RESOLVED", resolutionNote: "Shipped in v1.2" });
    expect(JSON.stringify(mine.body)).not.toContain("handledByMembershipId");
  });

  it("a contact sees only their own requests, not a colleague's", async () => {
    const ctx = await setup();
    await request(app).post(`${api}/portal/projects/${ctx.projectId}/requests`).set(bearer(ctx.clientToken)).send({ type: "QUESTION", title: "Jane's question", description: "details" });

    const { contactId, inviteToken } = await createContact(ctx, ctx.clientId, "colleague@acme.test");
    await request(app).post(`${org(ctx)}/clients/${ctx.clientId}/contacts/${contactId}/access`).set(auth(ctx.owner)).send({ projectId: ctx.projectId });
    const colleague = await acceptInvite(inviteToken);
    const token = colleague.body.data.accessToken as string;

    const theirs = await request(app).get(`${api}/portal/projects/${ctx.projectId}/requests`).set(bearer(token));
    expect(theirs.body.data.requests).toHaveLength(0);
  });

  it("respects a staff member's in-app notification preference", async () => {
    const ctx = await setup();
    await prisma.notificationPreference.create({
      data: { membershipId: ctx.ownerMembershipId, notificationType: "CLIENT_MESSAGE", inAppEnabled: false },
    });
    await request(app).post(`${api}/portal/projects/${ctx.projectId}/messages`).set(bearer(ctx.clientToken)).send({ content: "ping" });
    expect(await prisma.notification.count({ where: { recipientMembershipId: ctx.ownerMembershipId, type: "CLIENT_MESSAGE" } })).toBe(0);
  });
});

describe("shared files", () => {
  const upload = (path: string, token: string, buffer: Buffer, mime: string, name = "file.png") =>
    request(app).post(path).set(bearer(token)).attach("file", buffer, { filename: name, contentType: mime });

  it("a client can upload a valid file; the stored asset id is never exposed", async () => {
    const ctx = await setup();
    const res = await upload(`${api}/portal/projects/${ctx.projectId}/files`, ctx.clientToken, PNG, "image/png", "logo.png");
    expect(res.status).toBe(201);
    expect(res.body.data.file).toMatchObject({ originalFilename: "logo.png", uploadedBy: { type: "CLIENT", name: "Jane Client" } });
    expect(JSON.stringify(res.body)).not.toContain("publicId");
    expect(JSON.stringify(res.body)).not.toContain("internal-pid");

    const list = await request(app).get(`${org(ctx)}/client-portal/projects/${ctx.projectId}/files`).set(auth(ctx.member));
    expect(list.body.data.files).toHaveLength(1);
  });

  it("rejects disallowed types and files whose content does not match the declared type", async () => {
    const ctx = await setup();
    const path = `${api}/portal/projects/${ctx.projectId}/files`;
    const exe = await upload(path, ctx.clientToken, Buffer.from("MZ..."), "application/x-msdownload", "x.exe");
    expect(exe.status).toBe(400);
    const spoofed = await upload(path, ctx.clientToken, Buffer.from("<script>alert(1)</script>"), "image/png", "evil.png");
    expect(spoofed.status).toBe(400);
    expect(await prisma.clientFile.count()).toBe(0);
  });

  it("a client without access cannot upload or list; clients cannot delete; staff can delete", async () => {
    const ctx = await setup();
    const other = await request(app).post(`${org(ctx)}/projects`).set(auth(ctx.owner)).send({ name: "Other" });
    const otherId = other.body.data.project.id as string;
    expect((await upload(`${api}/portal/projects/${otherId}/files`, ctx.clientToken, PNG, "image/png")).status).toBe(404);

    const ok = await upload(`${api}/portal/projects/${ctx.projectId}/files`, ctx.clientToken, PNG, "image/png");
    const fileId = ok.body.data.file.id as string;
    expect((await request(app).delete(`${api}/portal/projects/${ctx.projectId}/files/${fileId}`).set(bearer(ctx.clientToken))).status).toBe(404);
    expect((await request(app).delete(`${org(ctx)}/client-portal/projects/${ctx.projectId}/files/${fileId}`).set(auth(ctx.member))).status).toBe(403);
    expect((await request(app).delete(`${org(ctx)}/client-portal/projects/${ctx.projectId}/files/${fileId}`).set(auth(ctx.manager))).status).toBe(200);
    expect(await prisma.clientFile.count()).toBe(0);
  });
});
