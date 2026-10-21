import { beforeAll, describe, expect, it } from "vitest";
import { prisma } from "./helpers.js";
import { call, makeProject, makeSprint, makeTask, seedWorkspace, type Workspace } from "./fixtures.js";

let w: Workspace;
beforeAll(async () => {
  w = await seedWorkspace();
}, 60_000);

const orgPath = (rest: string) => `/organizations/${w.orgId}${rest}`;

describe("C1: nullable dates", () => {
  it("project: null clears a date, an invalid date is 400, and null never becomes 1970", async () => {
    const project = await makeProject(w.orgId, { startDate: new Date("2026-04-01"), dueDate: new Date("2026-05-01") });
    const path = orgPath(`/projects/${project.id}`);

    const cleared = await call(w.owner, "patch", path, { dueDate: null });
    expect(cleared.status).toBe(200);
    expect(cleared.body.data.project.dueDate).toBeNull();
    expect(cleared.body.data.project.startDate).toBe("2026-04-01T00:00:00.000Z");
    expect((await prisma.project.findUniqueOrThrow({ where: { id: project.id } })).dueDate).toBeNull();

    for (const bad of ["abc", "", "2026-13-45"]) {
      expect((await call(w.owner, "patch", path, { startDate: bad })).status).toBe(400);
    }
    // After clearing the due date, any start date is fine (nothing to compare against).
    expect((await call(w.owner, "patch", path, { startDate: "2030-01-01" })).status).toBe(200);
    // Clearing both in one request is allowed.
    const both = await call(w.owner, "patch", path, { startDate: null, dueDate: null });
    expect(both.body.data.project).toMatchObject({ startDate: null, dueDate: null });
  });

  it("project: creating with null dates stores NULL; the order check still applies", async () => {
    const res = await call(w.owner, "post", orgPath("/projects"), { name: `Nulls ${Date.now()}`, startDate: null, dueDate: null });
    expect(res.status).toBe(201);
    expect(res.body.data.project).toMatchObject({ startDate: null, dueDate: null });
    const bad = await call(w.owner, "post", orgPath("/projects"), { name: `Order ${Date.now()}`, startDate: "2026-05-02", dueDate: "2026-05-01" });
    expect(bad.status).toBe(400);
  });

  it("project: sending only one date is checked against the stored other one", async () => {
    const project = await makeProject(w.orgId, { startDate: new Date("2026-04-10"), dueDate: new Date("2026-04-20") });
    const path = orgPath(`/projects/${project.id}`);
    expect((await call(w.owner, "patch", path, { dueDate: "2026-04-01" })).status).toBe(400);
    expect((await call(w.owner, "patch", path, { startDate: "2026-04-25" })).status).toBe(400);
    // Clearing the start date while moving the due date earlier is valid.
    expect((await call(w.owner, "patch", path, { startDate: null, dueDate: "2026-04-01" })).status).toBe(200);
  });

  it("task: null clears dates, invalid is 400, stored value is compared on partial updates", async () => {
    const project = await makeProject(w.orgId);
    const task = await makeTask(project.id, { startDate: new Date("2026-04-10"), dueDate: new Date("2026-04-20") });
    const path = orgPath(`/projects/${project.id}/tasks/${task.id}`);

    expect((await call(w.member, "patch", path, { dueDate: "2026-04-01" })).status).toBe(400);
    expect((await call(w.member, "patch", path, { dueDate: "nope" })).status).toBe(400);
    const cleared = await call(w.member, "patch", path, { dueDate: null });
    expect(cleared.body.data.task).toMatchObject({ dueDate: null, startDate: "2026-04-10T00:00:00.000Z" });
    expect((await call(w.member, "patch", path, { startDate: null })).body.data.task.startDate).toBeNull();

    const created = await call(w.member, "post", orgPath(`/projects/${project.id}/tasks`), { title: "No dates", startDate: null, dueDate: null });
    expect(created.status).toBe(201);
    expect(created.body.data.task).toMatchObject({ startDate: null, dueDate: null });
  });

  it("sprint: null is rejected (dates are required) and partial updates compare with the stored value", async () => {
    const project = await makeProject(w.orgId);
    const sprint = await makeSprint(project.id, { startDate: new Date("2026-05-10"), endDate: new Date("2026-05-20") });
    const path = orgPath(`/projects/${project.id}/sprints/${sprint.id}`);

    for (const body of [{ startDate: null }, { endDate: null }]) {
      expect((await call(w.owner, "patch", path, body)).status).toBe(400);
    }
    expect((await call(w.owner, "patch", path, { endDate: "2026-05-01" })).status).toBe(400);
    expect((await call(w.owner, "patch", path, { startDate: "2026-06-01" })).status).toBe(400);
    expect((await call(w.owner, "patch", path, { endDate: "bad" })).status).toBe(400);
    const create = (body: object) => call(w.owner, "post", orgPath(`/projects/${project.id}/sprints`), body);
    expect((await create({ name: "S", startDate: null, endDate: "2026-01-02" })).status).toBe(400);
    expect((await prisma.sprint.findUniqueOrThrow({ where: { id: sprint.id } })).startDate.toISOString()).toBe("2026-05-10T00:00:00.000Z");
  });
});

describe("C2: notification link data", () => {
  it("includes data (object or null) in list and mark-read responses", async () => {
    await prisma.notification.deleteMany({ where: { organizationId: w.orgId } });
    const withData = await prisma.notification.create({
      data: { organizationId: w.orgId, recipientMembershipId: w.memberMid, type: "MENTION", title: "T", message: "M", data: { projectId: "p", taskId: "t", commentId: "c" } },
    });
    await prisma.notification.create({
      data: { organizationId: w.orgId, recipientMembershipId: w.memberMid, type: "OTHER", title: "T2", message: "M2" },
    });
    const list = await call(w.member, "get", orgPath("/notifications"));
    const byType = Object.fromEntries(list.body.data.notifications.map((n: { type: string }) => [n.type, n]));
    expect(byType.MENTION.data).toEqual({ projectId: "p", taskId: "t", commentId: "c" });
    expect(byType.OTHER.data).toBeNull();
    const read = await call(w.member, "patch", orgPath(`/notifications/${withData.id}/read`));
    expect(read.body.data.notification.data).toEqual({ projectId: "p", taskId: "t", commentId: "c" });
  });
});

describe("C3: duplicate project name is a field error", () => {
  it("409 with errors pointing at name when the slug was derived, at slug when sent explicitly", async () => {
    const name = `Dup Name ${Date.now()}`;
    expect((await call(w.owner, "post", orgPath("/projects"), { name })).status).toBe(201);

    const derived = await call(w.owner, "post", orgPath("/projects"), { name });
    expect(derived.status).toBe(409);
    expect(derived.body).toEqual({
      success: false,
      message: "A project with this name already exists",
      errors: [{ path: "name", message: "A project with this name already exists" }],
    });

    const explicit = await call(w.owner, "post", orgPath("/projects"), { name: "Other", slug: `dup-name-${name.split(" ")[2]}` });
    expect(explicit.status).toBe(409);
    expect(explicit.body.errors).toEqual([{ path: "slug", message: "A project with this slug already exists" }]);
  });
});
