import { beforeAll, describe, expect, it } from "vitest";
import { prisma } from "./helpers.js";
import { call, seedWorkspace, type Workspace } from "./fixtures.js";

let w: Workspace;
beforeAll(async () => {
  w = await seedWorkspace();
}, 60_000);

const base = () => `/organizations/${w.orgId}/notifications`;
async function notify(recipientMembershipId: string, over: Record<string, unknown> = {}) {
  return prisma.notification.create({
    data: { organizationId: w.orgId, recipientMembershipId, type: "MENTION", title: "T", message: "M", ...over } as never,
  });
}
const clear = () => prisma.notification.deleteMany({ where: { organizationId: w.orgId } });

describe("notifications", () => {
  it("lists only the caller's own notifications, newest first, with pagination", async () => {
    await clear();
    await notify(w.memberMid, { title: "old", createdAt: new Date(Date.now() - 5000) });
    await notify(w.memberMid, { title: "new" });
    await notify(w.ownerMid, { title: "not yours" });

    const mine = await call(w.member, "get", base());
    expect(mine.body.data.notifications.map((n: { title: string }) => n.title)).toEqual(["new", "old"]);
    const page = await call(w.member, "get", `${base()}?limit=1&page=2`);
    expect(page.body.data.notifications.map((n: { title: string }) => n.title)).toEqual(["old"]);
    expect(page.body.data.pagination).toEqual({ page: 2, limit: 1, total: 2, totalPages: 2 });
    expect((await call(w.member, "get", `${base()}?limit=101`)).status).toBe(400);
  });

  it("unreadOnly=true filters, unreadOnly=false does not", async () => {
    await clear();
    await notify(w.memberMid, { title: "read", readAt: new Date() });
    await notify(w.memberMid, { title: "unread" });
    const titles = async (q: string) =>
      (await call(w.member, "get", `${base()}?${q}`)).body.data.notifications.map((n: { title: string }) => n.title).sort();
    expect(await titles("unreadOnly=true")).toEqual(["unread"]);
    expect(await titles("unreadOnly=false")).toEqual(["read", "unread"]);
    expect(await titles("")).toEqual(["read", "unread"]);
  });

  it("marks one as read (idempotently) and refuses someone else's", async () => {
    await clear();
    const mine = await notify(w.memberMid);
    const theirs = await notify(w.ownerMid);
    const first = await call(w.member, "patch", `${base()}/${mine.id}/read`);
    expect(first.status).toBe(200);
    const stamp = first.body.data.notification.readAt as string;
    expect(stamp).toBeTruthy();
    expect((await call(w.member, "patch", `${base()}/${mine.id}/read`)).body.data.notification.readAt).toBe(stamp);

    expect((await call(w.member, "patch", `${base()}/${theirs.id}/read`)).status).toBe(404);
    expect((await prisma.notification.findUniqueOrThrow({ where: { id: theirs.id } })).readAt).toBeNull();
    expect((await call(w.member, "patch", `${base()}/nope/read`)).status).toBe(400);
  });

  it("read-all only affects the caller's own notifications", async () => {
    await clear();
    await notify(w.memberMid);
    await notify(w.memberMid);
    const other = await notify(w.managerMid);
    expect((await call(w.member, "post", `${base()}/read-all`)).status).toBe(200);
    expect(await prisma.notification.count({ where: { recipientMembershipId: w.memberMid, readAt: null } })).toBe(0);
    expect((await prisma.notification.findUniqueOrThrow({ where: { id: other.id } })).readAt).toBeNull();
  });

  it("is scoped to the organization: outsiders get 404, anonymous 401, and a notification id from another tenant is not reachable", async () => {
    const theirs = await prisma.notification.create({
      data: { organizationId: w.other.orgId, recipientMembershipId: w.other.ownerMid, type: "MENTION", title: "T", message: "M" },
    });
    expect((await call(w.outsider, "get", base())).status).toBe(404);
    expect((await call(null, "get", base())).status).toBe(401);
    expect((await call(w.owner, "patch", `${base()}/${theirs.id}/read`)).status).toBe(404);
  });
});

describe("notification preferences", () => {
  it("upserts per type, merges partial updates and defaults the other channel to on", async () => {
    expect((await call(w.member, "get", `${base()}/preferences`)).body.data.preferences).toEqual([]);
    const first = await call(w.member, "put", `${base()}/preferences/MENTION`, { emailEnabled: false });
    expect(first.status).toBe(200);
    expect(first.body.data.preference).toMatchObject({ notificationType: "MENTION", emailEnabled: false, inAppEnabled: true });
    const second = await call(w.member, "put", `${base()}/preferences/MENTION`, { inAppEnabled: false });
    expect(second.body.data.preference).toMatchObject({ emailEnabled: false, inAppEnabled: false });
    expect((await call(w.member, "get", `${base()}/preferences`)).body.data.preferences).toHaveLength(1);
    expect(await prisma.notificationPreference.count({ where: { membershipId: w.memberMid } })).toBe(1);
  });

  it("validates the body and keeps each member's preferences separate", async () => {
    expect((await call(w.member, "put", `${base()}/preferences/MENTION`, { emailEnabled: "yes" })).status).toBe(400);
    expect((await call(w.owner, "get", `${base()}/preferences`)).body.data.preferences).toEqual([]);
  });
});
