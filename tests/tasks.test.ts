import { beforeAll, describe, expect, it } from "vitest";
import { prisma } from "./helpers.js";
import { call, makeProject, makeSprint, makeTask, seedWorkspace, type Workspace } from "./fixtures.js";

let w: Workspace;
beforeAll(async () => {
  w = await seedWorkspace();
}, 60_000);

const tasks = (projectId: string) => `/organizations/${w.orgId}/projects/${projectId}/tasks`;

describe("task CRUD", () => {
  it("creates with defaults, reads, updates and soft-deletes", async () => {
    const project = await makeProject(w.orgId);
    const created = await call(w.member, "post", tasks(project.id), { title: "Build login" });
    expect(created.status).toBe(201);
    const task = created.body.data.task;
    expect(task).toMatchObject({ title: "Build login", status: "BACKLOG", priority: "MEDIUM", assigneeMembershipId: null });

    const path = `${tasks(project.id)}/${task.id}`;
    expect((await call(w.owner, "get", path)).body.data.task.id).toBe(task.id);
    const upd = await call(w.member, "patch", path, { status: "IN_PROGRESS", priority: "URGENT", description: "Now" });
    expect(upd.body.data.task).toMatchObject({ status: "IN_PROGRESS", priority: "URGENT", description: "Now" });

    expect((await call(w.manager, "delete", path)).status).toBe(200);
    expect((await call(w.owner, "get", path)).status).toBe(404);
    expect((await call(w.owner, "delete", path)).status).toBe(404);
    expect((await prisma.task.findUniqueOrThrow({ where: { id: task.id } })).deletedAt).not.toBeNull();
  });

  it("validates input", async () => {
    const project = await makeProject(w.orgId);
    const bad: object[] = [
      {},
      { title: "" },
      { title: "x".repeat(301) },
      { title: "T", status: "WAITING" },
      { title: "T", priority: "SOON" },
      { title: "T", sprintId: "nope" },
      { title: "T", startDate: "2026-04-10", dueDate: "2026-04-01" },
    ];
    for (const body of bad) expect((await call(w.owner, "post", tasks(project.id), body)).status).toBe(400);
  });

  it("rejects a partial update that would put dueDate before the stored startDate", async () => {
    const project = await makeProject(w.orgId);
    const task = await makeTask(project.id, { startDate: new Date("2026-04-10"), dueDate: new Date("2026-04-20") });
    const path = `${tasks(project.id)}/${task.id}`;
    expect((await call(w.owner, "patch", path, { dueDate: "2026-04-01" })).status).toBe(400);
    expect((await call(w.owner, "patch", path, { startDate: "2026-04-25" })).status).toBe(400);
    expect((await call(w.owner, "patch", path, { dueDate: "2026-05-01" })).status).toBe(200);
  });

  it("can unassign and unsprint a task with null", async () => {
    const project = await makeProject(w.orgId);
    const sprint = await makeSprint(project.id);
    const task = await makeTask(project.id, { sprintId: sprint.id, assigneeMembershipId: w.memberMid });
    const res = await call(w.owner, "patch", `${tasks(project.id)}/${task.id}`, { sprintId: null, assigneeMembershipId: null });
    expect(res.body.data.task).toMatchObject({ sprintId: null, assigneeMembershipId: null });
  });
});

describe("task references stay inside the tenant", () => {
  it("only active members of this organization can be assignees", async () => {
    const project = await makeProject(w.orgId);
    const removed = await prisma.membership.create({
      data: { userId: w.outsider.id, organizationId: w.orgId, role: "TEAM_MEMBER", status: "REMOVED", removedAt: new Date() },
    });
    const ok = await call(w.owner, "post", tasks(project.id), { title: "A", assigneeMembershipId: w.memberMid });
    expect(ok.status).toBe(201);
    expect(ok.body.data.task.assigneeMembershipId).toBe(w.memberMid);

    expect((await call(w.owner, "post", tasks(project.id), { title: "B", assigneeMembershipId: w.other.ownerMid })).status).toBe(404);
    expect((await call(w.owner, "post", tasks(project.id), { title: "C", assigneeMembershipId: removed.id })).status).toBe(404);
    const task = await makeTask(project.id);
    expect((await call(w.owner, "patch", `${tasks(project.id)}/${task.id}`, { assigneeMembershipId: w.other.ownerMid })).status).toBe(404);
    await prisma.membership.delete({ where: { id: removed.id } });
  });

  it("only sprints of the same project can be used", async () => {
    const project = await makeProject(w.orgId);
    const sibling = await makeProject(w.orgId);
    const foreignSprint = await makeSprint(sibling.id);
    const otherTenantSprint = await makeSprint((await makeProject(w.other.orgId)).id);

    expect((await call(w.owner, "post", tasks(project.id), { title: "A", sprintId: foreignSprint.id })).status).toBe(404);
    expect((await call(w.owner, "post", tasks(project.id), { title: "B", sprintId: otherTenantSprint.id })).status).toBe(404);
    const task = await makeTask(project.id);
    expect((await call(w.owner, "patch", `${tasks(project.id)}/${task.id}`, { sprintId: foreignSprint.id })).status).toBe(404);
    expect((await prisma.task.findUniqueOrThrow({ where: { id: task.id } })).sprintId).toBeNull();
  });

  it("a task is only reachable through its own project and organization", async () => {
    const mine = await makeProject(w.orgId);
    const sibling = await makeProject(w.orgId);
    const theirs = await makeProject(w.other.orgId);
    const task = await makeTask(mine.id);
    const theirTask = await makeTask(theirs.id);

    expect((await call(w.owner, "get", `${tasks(sibling.id)}/${task.id}`)).status).toBe(404);
    expect((await call(w.owner, "get", `${tasks(theirs.id)}/${theirTask.id}`)).status).toBe(404);
    expect((await call(w.owner, "patch", `${tasks(theirs.id)}/${theirTask.id}`, { title: "Hijack" })).status).toBe(404);
    expect((await call(w.owner, "delete", `${tasks(theirs.id)}/${theirTask.id}`)).status).toBe(404);
    expect((await call(w.owner, "post", tasks(theirs.id), { title: "Injected" })).status).toBe(404);
    expect((await prisma.task.findUniqueOrThrow({ where: { id: theirTask.id } })).title).toBe(theirTask.title);
  });
});

describe("task list", () => {
  it("filters, searches, sorts and paginates, and hides subtasks and deleted tasks", async () => {
    const project = await makeProject(w.orgId);
    const sprint = await makeSprint(project.id);
    const parent = await makeTask(project.id, { title: "Parent Alpha", status: "TODO", priority: "LOW", sprintId: sprint.id });
    await makeTask(project.id, { title: "Bravo job", status: "DONE", priority: "URGENT", assigneeMembershipId: w.memberMid });
    await makeTask(project.id, { title: "Charlie job", status: "TODO", priority: "HIGH", dueDate: new Date("2026-09-01") });
    await makeTask(project.id, { title: "Gone", deletedAt: new Date() });
    await makeTask(project.id, { title: "Child of Alpha", parentTaskId: parent.id });
    const list = (q = "") => call(w.member, "get", `${tasks(project.id)}?${q}`);
    const titles = (res: { body: { data: { tasks: { title: string }[] } } }) => res.body.data.tasks.map((t) => t.title);

    expect((await list()).body.data.pagination.total).toBe(3);
    expect(titles(await list("status=TODO&sortBy=priority&sortOrder=asc")).sort()).toEqual(["Charlie job", "Parent Alpha"]);
    expect(titles(await list("priority=URGENT"))).toEqual(["Bravo job"]);
    expect(titles(await list(`sprintId=${sprint.id}`))).toEqual(["Parent Alpha"]);
    expect(titles(await list(`assigneeMembershipId=${w.memberMid}`))).toEqual(["Bravo job"]);
    expect(titles(await list("search=CHARLIE"))).toEqual(["Charlie job"]);
    expect(titles(await list("search=Gone"))).toEqual([]);
    expect(titles(await list("search=Child"))).toEqual([]);

    const page = await list("limit=2&page=2&sortBy=createdAt&sortOrder=asc");
    expect(page.body.data.tasks).toHaveLength(1);
    expect(page.body.data.pagination).toEqual({ page: 2, limit: 2, total: 3, totalPages: 2 });

    for (const q of ["limit=101", "status=NOPE", "sortBy=title", "sprintId=nope", "assigneeMembershipId=nope"]) {
      expect((await list(q)).status).toBe(400);
    }
  });
});

describe("subtasks", () => {
  it("creates one level of subtasks that inherit the sprint, and lists them under the parent only", async () => {
    const project = await makeProject(w.orgId);
    const sprint = await makeSprint(project.id);
    const parent = await makeTask(project.id, { sprintId: sprint.id });
    const path = `${tasks(project.id)}/${parent.id}/subtasks`;

    const created = await call(w.member, "post", path, { title: "Write tests", priority: "HIGH", assigneeMembershipId: w.managerMid });
    expect(created.status).toBe(201);
    expect(created.body.data.subtask).toMatchObject({ parentTaskId: parent.id, sprintId: sprint.id, priority: "HIGH", assigneeMembershipId: w.managerMid });
    expect((await call(w.owner, "get", path)).body.data.subtasks).toHaveLength(1);
    expect((await call(w.owner, "get", `${tasks(project.id)}?limit=100`)).body.data.tasks.map((t: { id: string }) => t.id)).not.toContain(created.body.data.subtask.id);
  });

  it("refuses a second level and foreign assignees", async () => {
    const project = await makeProject(w.orgId);
    const parent = await makeTask(project.id);
    const child = await makeTask(project.id, { parentTaskId: parent.id });

    const nested = await call(w.owner, "post", `${tasks(project.id)}/${child.id}/subtasks`, { title: "Grandchild" });
    expect(nested.status).toBe(409);
    expect(await prisma.task.count({ where: { parentTaskId: child.id } })).toBe(0);

    const foreign = await call(w.owner, "post", `${tasks(project.id)}/${parent.id}/subtasks`, { title: "X", assigneeMembershipId: w.other.ownerMid });
    expect(foreign.status).toBe(404);
    expect((await call(w.owner, "post", `${tasks(project.id)}/${parent.id}/subtasks`, { title: "" })).status).toBe(400);
  });
});

describe("collaborators", () => {
  it("adds active org members once, lists them and removes them", async () => {
    const project = await makeProject(w.orgId);
    const task = await makeTask(project.id);
    const path = `${tasks(project.id)}/${task.id}/collaborators`;

    const added = await call(w.member, "post", path, { membershipId: w.managerMid });
    expect(added.status).toBe(201);
    expect((await call(w.owner, "post", path, { membershipId: w.managerMid })).status).toBe(409);
    expect((await call(w.owner, "get", path)).body.data.collaborators).toHaveLength(1);

    const id = added.body.data.collaborator.id as string;
    expect((await call(w.owner, "delete", `${path}/${id}`)).status).toBe(200);
    expect((await call(w.owner, "delete", `${path}/${id}`)).status).toBe(404);
  });

  it("rejects members of another organization and invalid ids", async () => {
    const project = await makeProject(w.orgId);
    const task = await makeTask(project.id);
    const path = `${tasks(project.id)}/${task.id}/collaborators`;
    expect((await call(w.owner, "post", path, { membershipId: w.other.ownerMid })).status).toBe(404);
    expect((await call(w.owner, "post", path, { membershipId: "nope" })).status).toBe(400);
    expect(await prisma.taskCollaborator.count({ where: { taskId: task.id } })).toBe(0);
  });
});

describe("task RBAC", () => {
  it("TEAM_MEMBER can create and update tasks but not delete them; outsiders and anonymous callers are refused", async () => {
    const project = await makeProject(w.orgId);
    const task = await makeTask(project.id);
    const path = `${tasks(project.id)}/${task.id}`;

    expect((await call(w.member, "post", tasks(project.id), { title: "Mine" })).status).toBe(201);
    expect((await call(w.member, "patch", path, { status: "DONE" })).status).toBe(200);
    expect((await call(w.member, "delete", path)).status).toBe(403);
    expect((await prisma.task.findUniqueOrThrow({ where: { id: task.id } })).deletedAt).toBeNull();

    expect((await call(w.outsider, "get", path)).status).toBe(404);
    expect((await call(w.outsider, "post", tasks(project.id), { title: "x" })).status).toBe(404);
    expect((await call(null, "get", path)).status).toBe(401);
  });
});
