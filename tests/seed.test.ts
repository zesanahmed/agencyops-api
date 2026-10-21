import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { beforeAll, describe, expect, it } from "vitest";
import { DEMO_CLIENT_EMAIL, DEMO_ORG_SLUG, DEMO_PASSWORD_DEFAULT, DEMO_USERS, resetDemo, seedDemo } from "../src/seed/demo.js";
import { api, app, auth, createOrg, prisma, registerUser, request, resetDatabase } from "./helpers.js";
import type { TestUser } from "./helpers.js";

const run = promisify(execFile);

async function counts() {
  const entries = await Promise.all([
    ["users", prisma.user.count()], ["orgs", prisma.organization.count()], ["memberships", prisma.membership.count()],
    ["teams", prisma.team.count()], ["projects", prisma.project.count()], ["sprints", prisma.sprint.count()],
    ["tasks", prisma.task.count()], ["collaborators", prisma.taskCollaborator.count()], ["comments", prisma.comment.count()],
    ["mentions", prisma.commentMention.count()], ["notifications", prisma.notification.count()],
    ["prefs", prisma.notificationPreference.count()], ["invitations", prisma.invitation.count()],
    ["activities", prisma.activity.count()], ["clients", prisma.clientOrganization.count()], ["contacts", prisma.clientContact.count()],
    ["access", prisma.clientProjectAccess.count()], ["updates", prisma.projectUpdate.count()], ["messages", prisma.clientMessage.count()],
    ["requests", prisma.clientRequest.count()], ["files", prisma.clientFile.count()], ["invoices", prisma.clientInvoice.count()],
    ["items", prisma.clientInvoiceItem.count()], ["payments", prisma.clientInvoicePayment.count()],
    ["subscriptions", prisma.platformSubscription.count()],
  ].map(async ([k, v]) => [k, await v] as const));
  return Object.fromEntries(entries);
}

async function login(email: string, password = DEMO_PASSWORD_DEFAULT) {
  const res = await request(app).post(`${api}/auth/login`).send({ email, password });
  return { status: res.status, user: { id: res.body.data?.user?.id as string, email, accessToken: res.body.data?.accessToken as string } satisfies TestUser };
}

describe("demo seed", () => {
  beforeAll(async () => {
    await resetDatabase();
  }, 30_000);

  it("creates the demo workspace, is idempotent, and every demo account can log in", async () => {
    const first = await seedDemo();
    expect(first).toMatchObject({ created: true, organizationName: "Brightline Studio" });
    const afterFirst = await counts();

    const second = await seedDemo();
    expect(second).toMatchObject({ created: false, organizationId: first.organizationId });
    expect(await counts()).toEqual(afterFirst);

    for (const user of Object.values(DEMO_USERS)) {
      const res = await login(user.email);
      expect(res.status, user.email).toBe(200);
    }
    const portal = await request(app).post(`${api}/portal/auth/login`).send({ organizationSlug: DEMO_ORG_SLUG, email: DEMO_CLIENT_EMAIL, password: DEMO_PASSWORD_DEFAULT });
    expect(portal.status).toBe(200);
    expect((await login(DEMO_USERS.owner.email, "WrongPassword999")).status).toBe(401);
  }, 120_000);

  it("fits the FREE plan, uses the documented roles and keeps Stripe fields empty", async () => {
    const org = await prisma.organization.findUniqueOrThrow({ where: { slug: DEMO_ORG_SLUG } });
    const members = await prisma.membership.findMany({ where: { organizationId: org.id }, include: { user: true } });
    expect(members).toHaveLength(5);
    expect(members.every((m) => m.status === "ACTIVE" && m.user.emailVerifiedAt && m.user.status === "ACTIVE")).toBe(true);
    const roleOf = (email: string) => members.find((m) => m.user.email === email)!.role;
    expect(roleOf(DEMO_USERS.owner.email)).toBe("OWNER");
    expect(roleOf(DEMO_USERS.manager.email)).toBe("MANAGER");
    expect(roleOf(DEMO_USERS.member.email)).toBe("TEAM_MEMBER");

    expect(await prisma.project.count({ where: { organizationId: org.id } })).toBe(3);
    const sub = await prisma.platformSubscription.findUniqueOrThrow({ where: { organizationId: org.id }, include: { plan: true } });
    expect(sub).toMatchObject({ stripeCustomerId: null, stripeSubscriptionId: null, plan: { code: "FREE" } });
    expect(await prisma.invitation.findFirst({ where: { organizationId: org.id, email: "invitee@demo.agencyops.test", acceptedAt: null, revokedAt: null } })).not.toBeNull();
  });

  it("builds rich, relative-to-now project data", async () => {
    const org = await prisma.organization.findUniqueOrThrow({ where: { slug: DEMO_ORG_SLUG } });
    const project = (slug: string) => prisma.project.findFirstOrThrow({ where: { organizationId: org.id, slug } });
    const today = new Date();
    const dayStart = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
    const web = await project("website-redesign");
    const mobile = await project("mobile-app-mvp");
    const brand = await project("brand-guidelines");
    expect([web.status, mobile.status, brand.status]).toEqual(["ACTIVE", "ACTIVE", "COMPLETED"]);
    expect(mobile.dueDate!.getTime()).toBeLessThan(dayStart.getTime()); // overdue yet ACTIVE

    // Nothing that "already happened" (creation, activity) may be dated in the future.
    const now = new Date();
    expect(await prisma.task.count({ where: { project: { organizationId: org.id }, createdAt: { gt: now } } })).toBe(0);
    expect(await prisma.activity.count({ where: { organizationId: org.id, createdAt: { gt: now } } })).toBe(0);
    expect(web.dueDate!.getTime()).toBeGreaterThan(dayStart.getTime());

    const sprints = await prisma.sprint.findMany({ where: { projectId: web.id }, orderBy: { startDate: "asc" } });
    expect(sprints.map((s) => s.status)).toEqual(["COMPLETED", "ACTIVE", "PLANNED"]);
    expect(sprints[1]!.goal).toBeTruthy();

    const tasks = await prisma.task.findMany({ where: { projectId: web.id, deletedAt: null } });
    const top = tasks.filter((t) => !t.parentTaskId);
    expect(top.length).toBeGreaterThanOrEqual(16);
    expect(new Set(top.map((t) => t.status))).toEqual(new Set(["BACKLOG", "TODO", "IN_PROGRESS", "IN_REVIEW", "DONE"]));
    expect(new Set(top.map((t) => t.priority))).toEqual(new Set(["LOW", "MEDIUM", "HIGH", "URGENT"]));
    const overdueOpen = top.filter((t) => t.status !== "DONE" && t.dueDate && t.dueDate.getTime() < dayStart.getTime());
    expect(overdueOpen).toHaveLength(3);
    expect(overdueOpen.some((t) => t.priority === "URGENT")).toBe(true);
    const soon = top.filter((t) => t.status !== "DONE" && t.dueDate && t.dueDate.getTime() >= dayStart.getTime() && t.dueDate.getTime() <= dayStart.getTime() + 3 * 86_400_000);
    expect(soon).toHaveLength(2);
    expect(top.filter((t) => t.status !== "DONE" && !t.assigneeMembershipId)).toHaveLength(2);
    expect(top.filter((t) => !t.sprintId && t.status === "BACKLOG")).toHaveLength(4);
    expect(top.some((t) => (t.description?.length ?? 0) > 400)).toBe(true);
    expect(top.some((t) => t.startDate && t.dueDate)).toBe(true);
    const active = top.filter((t) => t.sprintId === sprints[1]!.id);
    expect(active.map((t) => t.status).sort()).toEqual(["DONE", "DONE", "IN_PROGRESS", "IN_REVIEW", "TODO"]);

    const subtasks = tasks.filter((t) => t.parentTaskId);
    const parentIds = new Set(subtasks.map((s) => s.parentTaskId));
    expect(parentIds.size).toBe(3);
    for (const parentId of parentIds) {
      const kids = subtasks.filter((s) => s.parentTaskId === parentId);
      expect(kids.length).toBeGreaterThanOrEqual(3);
      expect(kids.length).toBeLessThanOrEqual(4);
      expect(kids.every((k) => k.sprintId === tasks.find((t) => t.id === parentId)!.sprintId)).toBe(true);
    }
    expect(await prisma.taskCollaborator.count({ where: { task: { projectId: web.id } } })).toBeGreaterThanOrEqual(3);
    expect(await prisma.task.count({ where: { projectId: brand.id, status: "DONE" } })).toBe(4);
  });

  it("writes comments whose @Full Name text matches real mention rows, and consistent notifications", async () => {
    const org = await prisma.organization.findUniqueOrThrow({ where: { slug: DEMO_ORG_SLUG } });
    const comments = await prisma.comment.findMany({ where: { task: { project: { organizationId: org.id } } }, include: { mentions: { include: { membership: { include: { user: true } } } } } });
    expect(comments.length).toBeGreaterThanOrEqual(10);
    expect(new Set(comments.map((c) => c.authorMembershipId)).size).toBeGreaterThanOrEqual(4);
    expect(new Set(comments.map((c) => c.taskId)).size).toBeLessThanOrEqual(5);
    for (const comment of comments) {
      for (const mention of comment.mentions) expect(comment.content).toContain(`@${mention.membership.user.name}`);
    }
    expect(comments.reduce((n, c) => n + c.mentions.length, 0)).toBeGreaterThan(0);

    for (const key of ["owner", "manager", "member"] as const) {
      const membership = await prisma.membership.findFirstOrThrow({ where: { organizationId: org.id, user: { email: DEMO_USERS[key].email } } });
      const list = await prisma.notification.findMany({ where: { recipientMembershipId: membership.id } });
      expect(list.length, key).toBeGreaterThanOrEqual(3);
      expect(list.length, key).toBeLessThanOrEqual(5);
      expect(list.some((n) => n.readAt === null), key).toBe(true);
      expect(list.some((n) => n.readAt !== null), key).toBe(true);
      for (const n of list) {
        expect(n.type).toBe("MENTION");
        const data = n.data as { projectId: string; taskId: string; commentId: string };
        expect(await prisma.comment.count({ where: { id: data.commentId, taskId: data.taskId, task: { projectId: data.projectId } } })).toBe(1);
      }
    }
    const prefs = await prisma.notificationPreference.findMany({ where: { membership: { organizationId: org.id }, notificationType: "MENTION" } });
    expect(prefs).toHaveLength(5);
    expect(prefs.every((p) => p.inAppEnabled && !p.emailEnabled)).toBe(true);
    expect(await prisma.notificationPreference.count({ where: { emailEnabled: true, membership: { organizationId: org.id } } })).toBe(0);
  });

  it("populates the client portal: scoped access, thread, requests, files and the three invoices", async () => {
    const org = await prisma.organization.findUniqueOrThrow({ where: { slug: DEMO_ORG_SLUG } });
    const contact = await prisma.clientContact.findFirstOrThrow({ where: { organizationId: org.id, email: DEMO_CLIENT_EMAIL }, include: { projectAccess: { include: { project: true } } } });
    expect(contact.status).toBe("ACTIVE");
    expect(contact.projectAccess.map((a) => a.project.slug).sort()).toEqual(["mobile-app-mvp", "website-redesign"]);
    for (const access of contact.projectAccess) {
      const projectId = access.projectId;
      expect(await prisma.projectUpdate.count({ where: { projectId } })).toBeGreaterThanOrEqual(2);
      const messages = await prisma.clientMessage.findMany({ where: { projectId } });
      expect(messages).toHaveLength(3);
      expect(messages.some((m) => m.authorClientContactId)).toBe(true);
      expect(messages.some((m) => m.authorMembershipId)).toBe(true);
      const requests = await prisma.clientRequest.findMany({ where: { projectId } });
      expect(requests.map((r) => r.status).sort()).toEqual(["OPEN", "RESOLVED"]);
      expect(await prisma.clientFile.count({ where: { projectId } })).toBe(1);
    }

    const invoices = await prisma.clientInvoice.findMany({ where: { organizationId: org.id }, include: { payments: true, items: true }, orderBy: { number: "asc" } });
    expect(invoices.map((i) => i.status)).toEqual(["PAID", "OPEN", "DRAFT"]);
    expect(invoices.every((i) => i.items.length > 0 && i.currency === "usd" && i.pdfUrl === null)).toBe(true);
    expect(invoices[0]!.payments[0]).toMatchObject({ status: "SUCCEEDED", amountCents: invoices[0]!.totalCents });
    expect(invoices[1]!.payments).toHaveLength(0);
    expect(invoices[1]!.totalCents).toBe(invoices[1]!.subtotalCents - invoices[1]!.discountCents + invoices[1]!.taxCents);

    // Through the real portal API: the client sees PAID + OPEN only, and can start paying the OPEN one.
    const portal = await request(app).post(`${api}/portal/auth/login`).send({ organizationSlug: DEMO_ORG_SLUG, email: DEMO_CLIENT_EMAIL, password: DEMO_PASSWORD_DEFAULT });
    const token = { Authorization: `Bearer ${portal.body.data.accessToken}` };
    const list = await request(app).get(`${api}/portal/invoices`).set(token);
    expect(list.body.data.invoices.map((i: { status: string }) => i.status).sort()).toEqual(["OPEN", "PAID"]);
    const projects = await request(app).get(`${api}/portal/projects`).set(token);
    expect(projects.body.data.projects.map((p: { name: string }) => p.name).sort()).toEqual(["Mobile App MVP", "Website Redesign"]);
  });

  it("serves the seeded data through the API for each documented role", async () => {
    const org = await prisma.organization.findUniqueOrThrow({ where: { slug: DEMO_ORG_SLUG } });
    const owner = (await login(DEMO_USERS.owner.email)).user;
    const manager = (await login(DEMO_USERS.manager.email)).user;
    const member = (await login(DEMO_USERS.member.email)).user;

    for (const [user, name, role] of [[owner, "Nadia Rahman", "OWNER"], [manager, "Arif Hossain", "MANAGER"], [member, "Tanvir Ahmed", "TEAM_MEMBER"]] as const) {
      const me = await request(app).get(`${api}/auth/me`).set(auth(user));
      expect(me.body.data.user).toMatchObject({ name, email: user.email });
      const orgs = await request(app).get(`${api}/organizations`).set(auth(user));
      expect(orgs.body.data.organizations).toHaveLength(1);
      expect(orgs.body.data.organizations[0]).toMatchObject({ slug: DEMO_ORG_SLUG });
      expect(orgs.body.data.organizations[0].membership.role).toBe(role);
      const detail = await request(app).get(`${api}/organizations/${org.id}`).set(auth(user));
      expect(detail.body.data.membership.role).toBe(role);
      expect(detail.body.data.membership.permissions.includes("project:create")).toBe(role !== "TEAM_MEMBER");

      const projects = await request(app).get(`${api}/organizations/${org.id}/projects`).set(auth(user));
      expect(projects.body.data.projects).toHaveLength(3);
      const web = projects.body.data.projects.find((p: { slug: string }) => p.slug === "website-redesign");
      expect(web).toMatchObject({ memberCount: 5, activeSprint: { name: "Sprint 2" }, taskCounts: { BACKLOG: 4, DONE: 5 } });

      const tasks = await request(app).get(`${api}/organizations/${org.id}/projects/${web.id}/tasks?limit=100`).set(auth(user));
      expect(tasks.body.data.pagination.total).toBe(16);
      const t6 = tasks.body.data.tasks.find((t: { title: string }) => t.title.startsWith("Implement contact form"));
      expect(t6).toMatchObject({ subtaskCount: 4, doneSubtaskCount: 2, assignee: { user: { name: "Tanvir Ahmed" } } });
      expect(t6.commentCount).toBeGreaterThan(0);

      const notes = await request(app).get(`${api}/organizations/${org.id}/notifications`).set(auth(user));
      expect(notes.body.data.notifications.length).toBeGreaterThanOrEqual(3);
      expect(notes.body.data.notifications[0].data).toMatchObject({ projectId: expect.any(String), taskId: expect.any(String), commentId: expect.any(String) });

      const feed = await request(app).get(`${api}/organizations/${org.id}/activity?limit=100`).set(auth(user));
      expect(feed.body.data.activities.length).toBeGreaterThan(10);
    }

    expect((await request(app).post(`${api}/organizations/${org.id}/projects`).set(auth(member)).send({ name: "Nope" })).status).toBe(403);
    expect((await request(app).post(`${api}/organizations/${org.id}/projects`).set(auth(manager)).send({ name: "Manager can create" })).status).toBe(201);
    await prisma.project.deleteMany({ where: { name: "Manager can create" } });
  }, 60_000);

  it("--reset removes only the demo rows and re-seeds; other organizations and users are untouched", async () => {
    const other = await registerUser("Real Customer");
    const otherOrgId = await createOrg(other, "Real Agency");
    const before = await prisma.membership.count({ where: { organizationId: otherOrgId } });

    const { warnings } = await resetDemo();
    expect(warnings).toEqual([]);
    expect(await prisma.organization.findUnique({ where: { slug: DEMO_ORG_SLUG } })).toBeNull();
    expect(await prisma.user.count({ where: { email: { endsWith: "@demo.agencyops.test" } } })).toBe(0);
    expect(await prisma.organization.findUnique({ where: { id: otherOrgId } })).not.toBeNull();
    expect(await prisma.user.findUnique({ where: { id: other.id } })).not.toBeNull();
    expect(await prisma.membership.count({ where: { organizationId: otherOrgId } })).toBe(before);
    expect((await login(other.email, "StrongPassword123!")).status).toBe(200);

    const again = await seedDemo();
    expect(again.created).toBe(true);
    expect((await login(DEMO_USERS.owner.email)).status).toBe(200);
    expect(await prisma.organization.count()).toBe(2);
  }, 120_000);

  it("re-seeding with --reset rebuilds identical counts; an interrupted run is repaired", async () => {
    const baseline = await counts();
    await seedDemo({ reset: true });
    expect(await counts()).toEqual(baseline);

    // Simulate an interrupted run (the invitation is written last): the next seed starts clean.
    await prisma.invitation.deleteMany({ where: { email: "invitee@demo.agencyops.test" } });
    const repaired = await seedDemo();
    expect(repaired.created).toBe(true);
    expect(await counts()).toEqual(baseline);
  }, 120_000);

  it("a demo user who also belongs to another organization is kept by --reset", async () => {
    const owner = await prisma.user.findUniqueOrThrow({ where: { email: DEMO_USERS.owner.email } });
    const stranger = await registerUser("Stranger");
    const strangerOrg = await createOrg(stranger, "Stranger Org");
    await prisma.membership.create({ data: { userId: owner.id, organizationId: strangerOrg, role: "TEAM_MEMBER" } });

    const { warnings } = await resetDemo();
    expect(warnings).toHaveLength(1);
    expect(await prisma.membership.count({ where: { organizationId: strangerOrg } })).toBe(2);
    expect(await prisma.user.findUnique({ where: { id: owner.id } })).not.toBeNull();
    expect(await seedDemo().then((s) => s.created)).toBe(true); // re-seeds on top of the kept user
  }, 120_000);

  it("the CLI refuses to run in production unless explicitly allowed", async () => {
    const before = await counts();
    const env = { ...process.env, NODE_ENV: "production", JWT_ACCESS_SECRET: "x".repeat(40), JWT_REFRESH_SECRET: "y".repeat(40) };
    delete (env as Record<string, string | undefined>)["ALLOW_SEED_IN_PRODUCTION"];
    const result = await run(process.execPath, ["--import", "tsx", "src/scripts/seed.ts", "--reset"], { env, cwd: process.cwd() }).then(
      (r) => ({ code: 0, out: r.stdout + r.stderr }),
      (e: { code?: number; stdout?: string; stderr?: string }) => ({ code: e.code ?? 1, out: `${e.stdout ?? ""}${e.stderr ?? ""}` }),
    );
    expect(result.code).toBe(1);
    expect(result.out).toContain("Refusing to seed");
    expect(await counts()).toEqual(before); // --reset did not run either
  }, 60_000);
});
