import { randomBytes, randomUUID } from "node:crypto";
import type {
  Prisma,
  ClientRequestStatus,
  ClientRequestType,
  InvoiceStatus,
  ProjectStatus,
  SprintStatus,
  TaskPriority,
  TaskStatus,
} from "../generated/prisma/client.js";
import { prisma } from "../lib/prisma.js";
import { comparePassword, hashPassword, hashToken, normalizeEmail } from "../modules/auth/auth.utils.js";
import { recordActivity, type ActivityAction } from "../modules/activity/activity.service.js";
import { ensurePlan } from "../modules/billing/billing.plans.js";
import { getBilling } from "../modules/billing/billing.service.js";
import { computeTotals } from "../modules/invoice/invoice.service.js";
import { createOrganization } from "../modules/organization/organization.service.js";

/**
 * Idempotent demo data. Everything is identified by stable keys (the fixed emails and the
 * fixed organization slug), so running it twice never duplicates anything and `reset` can
 * remove exactly what it created. Dates are relative to the run time so "overdue" and
 * "due soon" are always visible.
 *
 * What it deliberately does NOT do: send email or enqueue BullMQ jobs (so it works without
 * Redis/Resend and never contacts the fake .test addresses), call Stripe, or call Cloudinary.
 * Writes go through Prisma directly for the content (the app's own services would enqueue
 * emails/jobs); organization creation, plans, billing row, password hashing, invoice math and
 * the activity recorder reuse the real code.
 */

export const DEMO_ORG_NAME = "Brightline Studio";
export const DEMO_ORG_SLUG = "brightline-studio";
export const DEMO_PASSWORD_DEFAULT = "DemoPass123!";
export const DEMO_INVITEE_EMAIL = "invitee@demo.agencyops.test";
export const DEMO_CLIENT_EMAIL = "client@demo.agencyops.test";

type Key = "owner" | "manager" | "member" | "sara" | "imran";
export const DEMO_USERS: Record<Key, { name: string; email: string; role: "OWNER" | "MANAGER" | "TEAM_MEMBER"; documented: boolean }> = {
  owner: { name: "Nadia Rahman", email: "owner@demo.agencyops.test", role: "OWNER", documented: true },
  manager: { name: "Arif Hossain", email: "manager@demo.agencyops.test", role: "MANAGER", documented: true },
  member: { name: "Tanvir Ahmed", email: "member@demo.agencyops.test", role: "TEAM_MEMBER", documented: true },
  sara: { name: "Sara Khan", email: "sara@demo.agencyops.test", role: "TEAM_MEMBER", documented: false },
  imran: { name: "Imran Chowdhury", email: "imran@demo.agencyops.test", role: "TEAM_MEMBER", documented: false },
};
const USER_KEYS = Object.keys(DEMO_USERS) as Key[];
const DEMO_EMAILS = [...USER_KEYS.map((k) => DEMO_USERS[k].email)];

/** Every notification type the app emits: demo accounts never get an email for any of them. */
const NOTIFICATION_TYPES = [
  "MENTION", "TASK_ASSIGNED", "TASK_STATUS_CHANGED", "SPRINT_STARTED",
  "CLIENT_MESSAGE", "CLIENT_REQUEST", "CLIENT_FILE", "INVOICE_PAID", "INVOICE_PAYMENT_ATTENTION",
];

export interface SeedSummary {
  created: boolean;
  organizationId: string;
  organizationName: string;
  password: string;
}

// ---- time helpers (UTC calendar days, matching how the frontend sends and shows dates) ----
function makeClock(now: Date) {
  const day = (offset: number): Date =>
    new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + offset));
  const ago = (hours: number): Date => new Date(now.getTime() - hours * 3_600_000);
  return { day, ago };
}

// ---------------------------------------------------------------------------------------
// Reset
// ---------------------------------------------------------------------------------------

/** Removes the demo organization's rows (children first: several FKs to Membership are RESTRICT). */
async function deleteDemoOrganization(organizationId: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.clientInvoicePayment.deleteMany({ where: { organizationId } });
    await tx.clientInvoice.deleteMany({ where: { organizationId } }); // items cascade
    await tx.clientFile.deleteMany({ where: { organizationId } });
    await tx.clientMessage.deleteMany({ where: { organizationId } });
    await tx.projectUpdate.deleteMany({ where: { organizationId } });
    await tx.clientRequest.deleteMany({ where: { organizationId } });
    await tx.clientProjectAccess.deleteMany({ where: { project: { organizationId } } });
    await tx.invitation.deleteMany({ where: { organizationId } });
    await tx.notification.deleteMany({ where: { organizationId } });
    await tx.attachment.deleteMany({ where: { organizationId } });
    await tx.commentMention.deleteMany({ where: { comment: { task: { project: { organizationId } } } } });
    await tx.comment.deleteMany({ where: { task: { project: { organizationId } } } });
    await tx.organization.delete({ where: { id: organizationId } });
  });
}

/** The demo organization, only if it really is the demo one (owned by a demo user). */
async function findDemoOrganization(): Promise<{ id: string } | null> {
  const org = await prisma.organization.findUnique({
    where: { slug: DEMO_ORG_SLUG },
    select: { id: true, owner: { select: { email: true } } },
  });
  if (!org) return null;
  if (!DEMO_EMAILS.includes(org.owner.email)) {
    throw new Error(`Organization slug "${DEMO_ORG_SLUG}" is used by a non-demo organization; refusing to touch it.`);
  }
  return { id: org.id };
}

export async function resetDemo(): Promise<{ warnings: string[] }> {
  const warnings: string[] = [];
  const org = await findDemoOrganization();
  if (org) await deleteDemoOrganization(org.id);

  for (const email of DEMO_EMAILS) {
    const user = await prisma.user.findUnique({
      where: { email },
      select: { id: true, _count: { select: { ownedOrganizations: true, memberships: true } } },
    });
    if (!user) continue;
    // A demo user someone also used elsewhere is kept: we never touch other organizations.
    if (user._count.ownedOrganizations > 0 || user._count.memberships > 0) {
      warnings.push(`Kept ${email}: it also belongs to another organization.`);
      continue;
    }
    await prisma.user.delete({ where: { id: user.id } });
  }
  return { warnings };
}

// ---------------------------------------------------------------------------------------
// Seed
// ---------------------------------------------------------------------------------------

async function ensureUsers(password: string): Promise<Record<Key, string>> {
  const ids = {} as Record<Key, string>;
  const hash = await hashPassword(password);
  for (const key of USER_KEYS) {
    const def = DEMO_USERS[key];
    const email = normalizeEmail(def.email);
    const existing = await prisma.user.findUnique({ where: { email }, select: { id: true, passwordHash: true } });
    if (!existing) {
      const created = await prisma.user.create({
        data: { name: def.name, email, passwordHash: hash, emailVerifiedAt: new Date(), status: "ACTIVE" },
        select: { id: true },
      });
      ids[key] = created.id;
      continue;
    }
    ids[key] = existing.id;
    // Keep the shared demo password in sync with SEED_DEMO_PASSWORD, and keep accounts usable.
    const passwordOk = existing.passwordHash ? await comparePassword(password, existing.passwordHash) : false;
    await prisma.user.update({
      where: { id: existing.id },
      data: { name: def.name, status: "ACTIVE", deletedAt: null, emailVerifiedAt: new Date(), ...(passwordOk ? {} : { passwordHash: hash }) },
    });
  }
  return ids;
}

export async function seedDemo(options: { reset?: boolean; password?: string; now?: Date } = {}): Promise<SeedSummary> {
  const password = options.password ?? process.env["SEED_DEMO_PASSWORD"] ?? DEMO_PASSWORD_DEFAULT;
  if (options.reset) await resetDemo();

  const userIds = await ensureUsers(password);

  const existing = await findDemoOrganization();
  if (existing) {
    // The pending invitation is the last thing the seed writes: its presence means "complete".
    const complete = await prisma.invitation.findFirst({
      where: { organizationId: existing.id, email: DEMO_INVITEE_EMAIL },
      select: { id: true },
    });
    if (complete) {
      return { created: false, organizationId: existing.id, organizationName: DEMO_ORG_NAME, password };
    }
    await deleteDemoOrganization(existing.id); // an earlier run was interrupted; start clean
  }

  const organizationId = await buildDemoOrganization(userIds, options.now ?? new Date());
  return { created: true, organizationId, organizationName: DEMO_ORG_NAME, password };
}

type TaskSpec = {
  key: string;
  title: string;
  description?: string;
  status: TaskStatus;
  priority: TaskPriority;
  sprint?: string;
  assignee?: Key;
  start?: number;
  due?: number;
  parent?: string;
};

async function buildDemoOrganization(userIds: Record<Key, string>, now: Date): Promise<string> {
  const { day, ago } = makeClock(now);

  // --- organization + OWNER membership via the real service, FREE plan + subscription row ---
  const { organization, membership: ownerMembership } = await createOrganization({
    name: DEMO_ORG_NAME,
    ownerId: userIds.owner,
  });
  if (organization.slug !== DEMO_ORG_SLUG) throw new Error(`Unexpected organization slug "${organization.slug}"`);
  const organizationId = organization.id;
  await ensurePlan("FREE");
  await getBilling(organizationId); // lazily creates the FREE subscription (no Stripe ids)

  const mid = { owner: ownerMembership.id } as Record<Key, string>;
  for (const key of USER_KEYS) {
    if (key === "owner") continue;
    const m = await prisma.membership.create({
      data: { userId: userIds[key], organizationId, role: DEMO_USERS[key].role, joinedAt: ago(24 * 100) },
      select: { id: true },
    });
    mid[key] = m.id;
    await recordActivity({
      organizationId,
      actorMembershipId: m.id,
      action: "member.joined",
      entityType: "Membership",
      entityId: m.id,
      metadata: { memberMembershipId: m.id, role: DEMO_USERS[key].role },
      createdAt: ago(24 * 100),
    });
  }

  // --- teams ---
  const teams = {
    design: await prisma.team.create({ data: { organizationId, name: "Design", description: "Product and brand design" } }),
    engineering: await prisma.team.create({ data: { organizationId, name: "Engineering", description: "Web and mobile engineering" } }),
  };
  await prisma.teamMember.createMany({
    data: [
      { teamId: teams.design.id, membershipId: mid.sara },
      { teamId: teams.design.id, membershipId: mid.member },
      { teamId: teams.engineering.id, membershipId: mid.imran },
      { teamId: teams.engineering.id, membershipId: mid.member },
      { teamId: teams.engineering.id, membershipId: mid.manager },
    ],
  });

  // --- client organization (needed to link projects) ---
  const client = await prisma.clientOrganization.create({
    data: { organizationId, name: "Harbor & Co", website: "https://harborco.example", notes: "Demo client. Internal notes are never shown in the portal." },
  });

  // --- projects ---
  const projectDefs: { key: string; name: string; slug: string; description: string; status: ProjectStatus; start: number; due: number; client: boolean }[] = [
    { key: "web", name: "Website Redesign", slug: "website-redesign", description: "Full redesign of the Harbor & Co marketing site: new IA, design system and CMS.", status: "ACTIVE", start: -30, due: 21, client: true },
    { key: "mobile", name: "Mobile App MVP", slug: "mobile-app-mvp", description: "First release of the customer mobile app (iOS + Android).", status: "ACTIVE", start: -60, due: -5, client: true },
    { key: "brand", name: "Brand Guidelines", slug: "brand-guidelines", description: "Logo usage, colour, typography and tone-of-voice guidelines.", status: "COMPLETED", start: -90, due: -20, client: false },
  ];
  const projects: Record<string, { id: string; name: string }> = {};
  for (const def of projectDefs) {
    const p = await prisma.project.create({
      data: {
        organizationId,
        name: def.name,
        slug: def.slug,
        description: def.description,
        status: def.status,
        startDate: day(def.start),
        dueDate: day(def.due),
        clientOrganizationId: def.client ? client.id : null,
        createdAt: day(def.start),
      },
    });
    projects[def.key] = { id: p.id, name: p.name };
    await recordActivity({
      organizationId, actorMembershipId: mid.owner, action: "project.created", entityType: "Project",
      entityId: p.id, projectId: p.id, metadata: { title: p.name }, createdAt: day(def.start),
    });
  }
  await prisma.projectTeam.createMany({
    data: [
      { projectId: projects.web!.id, teamId: teams.design.id },
      { projectId: projects.web!.id, teamId: teams.engineering.id },
      { projectId: projects.mobile!.id, teamId: teams.engineering.id },
      { projectId: projects.brand!.id, teamId: teams.design.id },
    ],
  });
  await prisma.projectMember.createMany({ data: USER_KEYS.map((k) => ({ projectId: projects.web!.id, membershipId: mid[k] })) });

  // --- sprints ---
  const sprintDefs: { key: string; project: string; name: string; goal?: string; status: SprintStatus; start: number; end: number }[] = [
    { key: "web1", project: "web", name: "Sprint 1", goal: "Discovery, IA and delivery pipeline", status: "COMPLETED", start: -28, end: -14 },
    { key: "web2", project: "web", name: "Sprint 2", goal: "Ship the homepage, navigation and contact flow", status: "ACTIVE", start: -5, end: 9 },
    { key: "web3", project: "web", name: "Sprint 3", goal: "Content migration and launch readiness", status: "PLANNED", start: 10, end: 24 },
    { key: "mob1", project: "mobile", name: "Sprint 1", goal: "Auth, push notifications and offline basics", status: "ACTIVE", start: -10, end: 4 },
    { key: "brand1", project: "brand", name: "Sprint 1", goal: "Guidelines v1", status: "COMPLETED", start: -85, end: -45 },
  ];
  const sprints: Record<string, string> = {};
  for (const def of sprintDefs) {
    const s = await prisma.sprint.create({
      data: {
        projectId: projects[def.project]!.id, name: def.name, goal: def.goal ?? null, status: def.status,
        startDate: day(def.start), endDate: day(def.end),
      },
    });
    sprints[def.key] = s.id;
    if (def.status !== "PLANNED") {
      const action: ActivityAction = def.status === "COMPLETED" ? "sprint.completed" : "sprint.started";
      await recordActivity({
        organizationId, actorMembershipId: mid.manager, action, entityType: "Sprint", entityId: s.id,
        projectId: projects[def.project]!.id, metadata: { title: def.name }, createdAt: day(def.status === "COMPLETED" ? def.end : def.start),
      });
    }
  }

  // --- tasks ---
  const longDescription = [
    "Establish a performance budget for the new site and enforce it in CI.",
    "",
    "Scope:",
    "- Lighthouse CI on every pull request with thresholds: performance >= 90, accessibility >= 95.",
    "- Bundle size budget per route (JS <= 170 kB gzipped, images served as AVIF/WebP with explicit dimensions).",
    "- Real-user monitoring for LCP, INP and CLS, reported weekly to the project channel.",
    "- Document the budget and the escalation path when a change exceeds it.",
    "",
    "Out of scope: third-party widgets owned by the client (chat, analytics); those get a separate review.",
  ].join("\n");

  const specs: Record<string, TaskSpec[]> = {
    web: [
      { key: "t1", title: "Audit existing site content", status: "DONE", priority: "LOW", sprint: "web1", assignee: "sara", start: -28, due: -20 },
      { key: "t2", title: "Define sitemap and navigation", status: "DONE", priority: "MEDIUM", sprint: "web1", assignee: "member", start: -27, due: -18 },
      { key: "t3", title: "Set up CI and staging environment", status: "DONE", priority: "HIGH", sprint: "web1", assignee: "imran", start: -26, due: -16 },
      { key: "t4", title: "Design homepage hero", status: "DONE", priority: "HIGH", sprint: "web2", assignee: "sara", start: -5, due: -1 },
      { key: "t5", title: "Build responsive navigation component", status: "DONE", priority: "MEDIUM", sprint: "web2", assignee: "imran", start: -5, due: -2 },
      { key: "t6", title: "Implement contact form with validation", status: "IN_REVIEW", priority: "HIGH", sprint: "web2", assignee: "member", start: -4, due: 2 },
      { key: "t7", title: "Integrate CMS for blog posts", status: "IN_PROGRESS", priority: "HIGH", sprint: "web2", assignee: "imran", start: -3, due: 3 },
      { key: "t8", title: "Write homepage copy", status: "TODO", priority: "MEDIUM", sprint: "web2", assignee: "sara", start: -4, due: -2 },
      { key: "t9", title: "Fix Safari layout bug on pricing page", status: "TODO", priority: "URGENT", assignee: "manager", start: -8, due: -4 },
      { key: "t10", title: "Accessibility audit (WCAG AA)", status: "IN_PROGRESS", priority: "HIGH", assignee: "member", start: -20, due: -9 },
      { key: "t11", title: "Add dark mode", status: "BACKLOG", priority: "LOW" },
      { key: "t12", title: "Set up analytics dashboard", status: "BACKLOG", priority: "MEDIUM" },
      { key: "t13", title: "Localize site into Bangla", status: "BACKLOG", priority: "MEDIUM", assignee: "sara" },
      { key: "t14", title: "Performance budget and Lighthouse CI", description: longDescription, status: "BACKLOG", priority: "HIGH", assignee: "imran" },
      { key: "t15", title: "Migrate blog content", status: "TODO", priority: "MEDIUM", sprint: "web3", assignee: "manager", start: 10, due: 18 },
      { key: "t16", title: "Launch checklist and go-live plan", status: "TODO", priority: "MEDIUM", sprint: "web3", assignee: "member", start: 18, due: 24 },
      // subtasks (inherit the parent's sprint)
      { key: "s6a", title: "Client-side validation rules", status: "DONE", priority: "MEDIUM", parent: "t6", assignee: "member" },
      { key: "s6b", title: "Server-side validation and spam protection", status: "DONE", priority: "HIGH", parent: "t6", assignee: "imran" },
      { key: "s6c", title: "Error and success states", status: "IN_REVIEW", priority: "MEDIUM", parent: "t6", assignee: "sara" },
      { key: "s6d", title: "Accessibility pass on the form", status: "TODO", priority: "LOW", parent: "t6" },
      { key: "s7a", title: "Model blog content types", status: "DONE", priority: "MEDIUM", parent: "t7", assignee: "imran" },
      { key: "s7b", title: "Build preview mode", status: "IN_PROGRESS", priority: "MEDIUM", parent: "t7", assignee: "imran" },
      { key: "s7c", title: "Webhook for publish events", status: "TODO", priority: "LOW", parent: "t7" },
      { key: "s8a", title: "Headline options (3 variants)", status: "TODO", priority: "MEDIUM", parent: "t8", assignee: "sara" },
      { key: "s8b", title: "Tone-of-voice review", status: "TODO", priority: "LOW", parent: "t8", assignee: "manager" },
      { key: "s8c", title: "Client approval", status: "TODO", priority: "MEDIUM", parent: "t8" },
    ],
    mobile: [
      { key: "m1", title: "Set up React Native project", status: "DONE", priority: "HIGH", sprint: "mob1", assignee: "imran", start: -58, due: -50 },
      { key: "m2", title: "Authentication screens", status: "DONE", priority: "HIGH", sprint: "mob1", assignee: "member", start: -50, due: -35 },
      { key: "m3", title: "Design system tokens for mobile", status: "DONE", priority: "MEDIUM", sprint: "mob1", assignee: "manager", start: -45, due: -30 },
      { key: "m4", title: "Push notifications", status: "IN_PROGRESS", priority: "HIGH", sprint: "mob1", assignee: "imran", start: -12, due: -1 },
      { key: "m5", title: "Offline sync for task list", status: "IN_REVIEW", priority: "MEDIUM", sprint: "mob1", assignee: "member", start: -10, due: 2 },
      { key: "m6", title: "App store listing assets", status: "TODO", priority: "LOW", sprint: "mob1", assignee: "manager", start: -3, due: 4 },
    ],
    brand: [
      { key: "b1", title: "Logo usage rules", status: "DONE", priority: "MEDIUM", sprint: "brand1", assignee: "sara", start: -85, due: -70 },
      { key: "b2", title: "Colour and typography", status: "DONE", priority: "MEDIUM", sprint: "brand1", assignee: "sara", start: -80, due: -60 },
      { key: "b3", title: "Tone of voice guide", status: "DONE", priority: "LOW", sprint: "brand1", assignee: "member", start: -70, due: -50 },
      { key: "b4", title: "Publish guidelines PDF", status: "DONE", priority: "HIGH", sprint: "brand1", assignee: "manager", start: -50, due: -22 },
    ],
  };

  const taskIds: Record<string, string> = {};
  const taskRows: Prisma.TaskCreateManyInput[] = [];
  const taskMeta = new Map<string, { project: string; spec: TaskSpec; createdAt: Date }>();
  let order = 0;
  for (const [projectKey, list] of Object.entries(specs)) {
    // parents first so subtasks can inherit their sprint
    const ordered = [...list.filter((s) => !s.parent), ...list.filter((s) => s.parent)];
    for (const spec of ordered) {
      const id = randomUUID();
      taskIds[spec.key] = id;
      const parentSpec = spec.parent ? list.find((s) => s.key === spec.parent) : undefined;
      const sprintKey = spec.sprint ?? parentSpec?.sprint;
      // Tasks planned for a future start were still *created* in the past: never backdate into the future.
      const base = Math.min(day(spec.start ?? parentSpec?.start ?? -10).getTime(), ago(2).getTime());
      const createdAt = new Date(base + order++ * 60_000);
      taskMeta.set(spec.key, { project: projectKey, spec, createdAt });
      taskRows.push({
        id,
        projectId: projects[projectKey]!.id,
        sprintId: sprintKey ? sprints[sprintKey]! : null,
        parentTaskId: spec.parent ? taskIds[spec.parent]! : null,
        assigneeMembershipId: spec.assignee ? mid[spec.assignee] : null,
        title: spec.title,
        description: spec.description ?? null,
        status: spec.status,
        priority: spec.priority,
        startDate: spec.start !== undefined ? day(spec.start) : null,
        dueDate: spec.due !== undefined ? day(spec.due) : null,
        createdAt,
      });
    }
  }
  await prisma.task.createMany({ data: taskRows });

  await prisma.taskCollaborator.createMany({
    data: [
      { taskId: taskIds.t6!, membershipId: mid.sara },
      { taskId: taskIds.t6!, membershipId: mid.manager },
      { taskId: taskIds.t7!, membershipId: mid.member },
      { taskId: taskIds.t9!, membershipId: mid.imran },
    ],
  });

  // Activity feed: creation of the top-level tasks, plus completion of finished ones.
  for (const [key, meta] of taskMeta) {
    if (meta.spec.parent) continue;
    const projectId = projects[meta.project]!.id;
    await recordActivity({
      organizationId, actorMembershipId: mid.manager, action: "task.created", entityType: "Task",
      entityId: taskIds[key]!, projectId, taskId: taskIds[key]!, metadata: { title: meta.spec.title }, createdAt: meta.createdAt,
    });
    if (meta.spec.status === "DONE" && meta.spec.due !== undefined) {
      await recordActivity({
        organizationId, actorMembershipId: meta.spec.assignee ? mid[meta.spec.assignee] : mid.manager, action: "task.status_changed",
        entityType: "Task", entityId: taskIds[key]!, projectId, taskId: taskIds[key]!,
        metadata: { title: meta.spec.title, from: "IN_PROGRESS", to: "DONE" }, createdAt: day(Math.min(meta.spec.due, 0)),
      });
    }
  }

  // --- comments with @Full Name mentions (+ real mention rows and MENTION notifications) ---
  const comments: { task: string; author: Key; text: string; hoursAgo: number; mentions: Key[] }[] = [
    { task: "t6", author: "manager", text: "Looks good @Tanvir Ahmed, can you check the mobile layout?", hoursAgo: 2, mentions: ["member"] },
    { task: "t6", author: "member", text: "Thanks @Arif Hossain, will do. @Sara Khan can you review the error-state copy?", hoursAgo: 1.5, mentions: ["manager", "sara"] },
    { task: "t6", author: "sara", text: "Error copy updated, ready for another look.", hoursAgo: 1, mentions: [] },
    { task: "t6", author: "sara", text: "@Nadia Rahman need your call on the tone of the success message.", hoursAgo: 4, mentions: ["owner"] },
    { task: "t7", author: "owner", text: "@Imran Chowdhury what's the ETA on the CMS integration? The client demo is in a few days.", hoursAgo: 26, mentions: ["imran"] },
    { task: "t7", author: "imran", text: "@Nadia Rahman should land tomorrow, I was blocked on API keys until this morning.", hoursAgo: 24, mentions: ["owner"] },
    { task: "t4", author: "owner", text: "Hero looks great @Sara Khan, approved.", hoursAgo: 24 * 6, mentions: ["sara"] },
    { task: "t4", author: "sara", text: "@Nadia Rahman hero v2 with the new illustration is uploaded to the shared folder.", hoursAgo: 24 * 8, mentions: ["owner"] },
    { task: "t9", author: "manager", text: "@Imran Chowdhury can you pair on this tomorrow? It only reproduces on iOS 16.", hoursAgo: 30, mentions: ["imran"] },
    { task: "t9", author: "imran", text: "Sure @Arif Hossain, I can reproduce it now.", hoursAgo: 28, mentions: ["manager"] },
    { task: "t10", author: "member", text: "Found 14 issues so far; contrast on the footer links is the worst offender. @Arif Hossain FYI this may push the launch.", hoursAgo: 24 * 7, mentions: ["manager"] },
    { task: "t10", author: "owner", text: "@Tanvir Ahmed please prioritise the keyboard-navigation issues first.", hoursAgo: 25, mentions: ["member"] },
    { task: "t6", author: "sara", text: "@Tanvir Ahmed pushed the new spacing tokens, please rebase.", hoursAgo: 24 * 5, mentions: ["member"] },
  ];
  for (const c of comments) {
    const createdAt = ago(c.hoursAgo);
    const taskMetaRow = taskMeta.get(c.task)!;
    const projectId = projects[taskMetaRow.project]!.id;
    const row = await prisma.comment.create({
      data: { taskId: taskIds[c.task]!, authorMembershipId: mid[c.author], content: c.text, createdAt, updatedAt: createdAt },
      select: { id: true },
    });
    await recordActivity({
      organizationId, actorMembershipId: mid[c.author], action: "comment.added", entityType: "Comment", entityId: row.id,
      projectId, taskId: taskIds[c.task]!, metadata: { title: taskMetaRow.spec.title }, createdAt,
    });
    for (const m of c.mentions) {
      await prisma.commentMention.create({ data: { commentId: row.id, membershipId: mid[m], createdAt } });
      // Same row notifyMemberships() would write, backdated; read state: today = unread, older = mixed.
      const hours = c.hoursAgo;
      const isRead = hours > 48 || (hours > 24 && hours % 2 === 0);
      await prisma.notification.create({
        data: {
          organizationId, recipientMembershipId: mid[m], type: "MENTION", title: "You were mentioned in a comment",
          message: c.text.slice(0, 200), data: { projectId, taskId: taskIds[c.task]!, commentId: row.id },
          readAt: isRead ? new Date(createdAt.getTime() + 3_600_000) : null, createdAt,
        },
      });
    }
  }

  // --- notification preferences: in-app on, email OFF for every type (never email fake addresses) ---
  await prisma.notificationPreference.createMany({
    data: USER_KEYS.flatMap((k) =>
      NOTIFICATION_TYPES.map((notificationType) => ({ membershipId: mid[k], notificationType, inAppEnabled: true, emailEnabled: false })),
    ),
  });

  // --- client portal ---
  const contact = await prisma.clientContact.create({
    data: {
      organizationId, clientOrganizationId: client.id, name: "Dana Whitfield", email: DEMO_CLIENT_EMAIL, jobTitle: "Head of Marketing",
      passwordHash: await hashPassword(process.env["SEED_DEMO_PASSWORD"] ?? DEMO_PASSWORD_DEFAULT), status: "ACTIVE",
    },
  });
  for (const key of ["web", "mobile"] as const) {
    const projectId = projects[key]!.id;
    await prisma.clientProjectAccess.create({ data: { clientContactId: contact.id, projectId, grantedByMembershipId: mid.owner } });

    const updateTitles: [string, string, number, Key][] =
      key === "web"
        ? [
            ["Kick-off complete", "Discovery finished and the sitemap is signed off. Design starts this sprint.", -26, "owner"],
            ["Homepage design approved", "The homepage hero and layout were approved internally; build is under way.", -4, "manager"],
            ["Staging site is live", "A password-protected staging site is available for review.", -1, "manager"],
          ]
        : [
            ["Beta build available", "A TestFlight/Play internal beta is ready for the first review round.", -9, "manager"],
            ["Push notifications in progress", "Notification delivery works on Android; iOS certificates are being finalised.", -2, "owner"],
          ];
    for (const [title, body, offset, author] of updateTitles) {
      await prisma.projectUpdate.create({
        data: { organizationId, projectId, authorMembershipId: mid[author], title, body, createdAt: day(offset), updatedAt: day(offset) },
      });
    }

    const thread: ["client" | Key, string, number][] =
      key === "web"
        ? [
            ["client", "Hi team, could we see the homepage on a phone-sized screen before the next review?", 30],
            ["manager", "Of course, we'll share a mobile preview on the staging site tomorrow.", 28],
            ["client", "Perfect, thank you!", 5],
          ]
        : [
            ["client", "Is the Android build still on track for the end of the month?", 50],
            ["imran", "Yes, push notifications are the last big item; we expect to wrap up this week.", 48],
            ["client", "Great, keep us posted.", 6],
          ];
    for (const [who, content, hours] of thread) {
      await prisma.clientMessage.create({
        data: {
          organizationId, projectId, content, createdAt: ago(hours),
          ...(who === "client" ? { authorClientContactId: contact.id } : { authorMembershipId: mid[who] }),
        },
      });
    }

    const requests: { type: ClientRequestType; title: string; description: string; status: ClientRequestStatus; offset: number; resolved?: string }[] =
      key === "web"
        ? [
            { type: "CHANGE_REQUEST", title: "Add a testimonials section", description: "Could we add a testimonials carousel below the hero? We can supply three quotes.", status: "OPEN", offset: -3 },
            { type: "QUESTION", title: "Which analytics tool will be used?", description: "We'd like to confirm the analytics setup before launch.", status: "RESOLVED", offset: -12, resolved: "We'll use a privacy-friendly analytics tool configured by our team; details are in the staging notes." },
          ]
        : [
            { type: "FEEDBACK", title: "Onboarding copy is too long", description: "The three onboarding screens feel wordy; can we shorten them?", status: "OPEN", offset: -2 },
            { type: "ISSUE", title: "Login fails on older Android versions", description: "On Android 9 the login screen shows a blank page.", status: "RESOLVED", offset: -20, resolved: "Fixed in build 0.4.2 (WebView compatibility)." },
          ];
    for (const r of requests) {
      await prisma.clientRequest.create({
        data: {
          organizationId, projectId, clientContactId: contact.id, type: r.type, title: r.title, description: r.description,
          status: r.status, createdAt: day(r.offset), updatedAt: day(r.offset),
          ...(r.resolved ? { resolutionNote: r.resolved, handledByMembershipId: mid.manager, resolvedAt: day(r.offset + 2) } : {}),
        },
      });
    }

    // Metadata only, pointing at a public sample PDF; no Cloudinary call (deleting it in the app is best-effort).
    await prisma.clientFile.create({
      data: {
        organizationId, projectId, uploadedByMembershipId: mid.manager, originalFilename: `${key === "web" ? "website" : "mobile"}-project-brief.pdf`,
        publicId: `demo/${organizationId}/${key}-project-brief`, url: "https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf",
        mimeType: "application/pdf", sizeBytes: 13264, createdAt: day(-20),
      },
    });
  }

  // --- invoices (no PDF job, no Stripe ids; the OPEN one is payable through real Stripe test checkout) ---
  const invoiceDefs: { status: InvoiceStatus; project: string; issue: number; due: number; items: { description: string; quantity: number; unitAmountCents: number }[]; tax: number; discount: number; notes?: string }[] = [
    { status: "PAID", project: "web", issue: -40, due: -26, items: [{ description: "Discovery workshop", quantity: 1, unitAmountCents: 250000 }, { description: "Information architecture", quantity: 12, unitAmountCents: 9500 }], tax: 0, discount: 0, notes: "Thank you for your payment." },
    { status: "OPEN", project: "web", issue: -4, due: 10, items: [{ description: "Homepage and navigation design", quantity: 24, unitAmountCents: 11000 }, { description: "Front-end build (sprint 2)", quantity: 40, unitAmountCents: 9000 }, { description: "Staging environment hosting", quantity: 1, unitAmountCents: 15000 }], tax: 30000, discount: 20000, notes: "Net 14. Payable online through the client portal." },
    { status: "DRAFT", project: "mobile", issue: 0, due: 14, items: [{ description: "Mobile MVP milestone 2", quantity: 1, unitAmountCents: 480000 }], tax: 0, discount: 0 },
  ];
  let invoiceNumber = 0;
  for (const def of invoiceDefs) {
    invoiceNumber += 1;
    const totals = computeTotals(def.items, def.tax, def.discount);
    const number = `INV-${String(invoiceNumber).padStart(4, "0")}`;
    const invoice = await prisma.clientInvoice.create({
      data: {
        organizationId, clientOrganizationId: client.id, projectId: projects[def.project]!.id, number, status: def.status,
        issueDate: day(def.issue), dueDate: day(def.due), currency: "usd", subtotalCents: totals.subtotalCents, taxCents: def.tax,
        discountCents: def.discount, totalCents: totals.totalCents, notes: def.notes ?? null, createdByMembershipId: mid.owner,
        sentAt: def.status === "DRAFT" ? null : day(def.issue), paidAt: def.status === "PAID" ? day(def.issue + 10) : null,
        items: { create: totals.rows }, createdAt: day(def.issue),
      },
    });
    if (def.status === "PAID") {
      await prisma.clientInvoicePayment.create({
        data: {
          organizationId, invoiceId: invoice.id, clientContactId: contact.id, amountCents: totals.totalCents, currency: "usd",
          status: "SUCCEEDED", paidAt: day(def.issue + 10),
          // Required + unique, but not a Stripe id: marks a seeded payment, never looked up at Stripe.
          stripeCheckoutSessionId: `seed:${organizationId}:${number}`,
        },
      });
    }
  }

  // --- last: the pending invitation (also the "seed complete" marker) ---
  await prisma.invitation.create({
    data: {
      organizationId, email: DEMO_INVITEE_EMAIL, role: "TEAM_MEMBER", tokenHash: hashToken(randomBytes(32).toString("hex")),
      invitedByMembershipId: mid.owner, expiresAt: day(7),
    },
  });

  return organizationId;
}
