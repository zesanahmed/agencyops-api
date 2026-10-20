import { beforeAll, describe, expect, it } from "vitest";
import { prisma } from "./helpers.js";
import { call, makeProject, makeSprint, makeTask, seedWorkspace, type Workspace } from "./fixtures.js";

let w: Workspace;
beforeAll(async () => {
  w = await seedWorkspace();
}, 60_000);

const sprints = (projectId: string) => `/organizations/${w.orgId}/projects/${projectId}/sprints`;
const valid = { name: "Sprint 1", goal: "Ship login", startDate: "2026-02-01", endDate: "2026-02-14" };

describe("sprint CRUD", () => {
  it("creates a PLANNED sprint, reads it back and lists it newest-first", async () => {
    const project = await makeProject(w.orgId);
    const created = await call(w.manager, "post", sprints(project.id), valid);
    expect(created.status).toBe(201);
    expect(created.body.data.sprint).toMatchObject({ name: "Sprint 1", goal: "Ship login", status: "PLANNED" });

    await call(w.owner, "post", sprints(project.id), { ...valid, name: "Sprint 2", startDate: "2026-03-01", endDate: "2026-03-14" });
    const list = await call(w.member, "get", sprints(project.id));
    expect(list.body.data.sprints.map((s: { name: string }) => s.name)).toEqual(["Sprint 2", "Sprint 1"]);
    expect(list.body.data.pagination).toMatchObject({ total: 2, totalPages: 1 });

    const one = await call(w.member, "get", `${sprints(project.id)}/${created.body.data.sprint.id}`);
    expect(one.body.data.sprint.name).toBe("Sprint 1");
  });

  it("validates input, including date order on create and on partial updates", async () => {
    const project = await makeProject(w.orgId);
    for (const body of [{}, { ...valid, name: "" }, { ...valid, endDate: "2026-01-01" }, { ...valid, startDate: "not-a-date" }]) {
      expect((await call(w.owner, "post", sprints(project.id), body)).status).toBe(400);
    }
    const sprint = await makeSprint(project.id, { startDate: new Date("2026-05-10"), endDate: new Date("2026-05-20") });
    const path = `${sprints(project.id)}/${sprint.id}`;
    expect((await call(w.owner, "patch", path, { endDate: "2026-05-01" })).status).toBe(400);
    expect((await call(w.owner, "patch", path, { startDate: "2026-06-01" })).status).toBe(400);
    expect((await call(w.owner, "patch", path, { name: "Renamed", endDate: "2026-05-30" })).body.data.sprint).toMatchObject({ name: "Renamed" });
  });

  it("lists with pagination", async () => {
    const project = await makeProject(w.orgId);
    for (let i = 0; i < 3; i++) await makeSprint(project.id, { startDate: new Date(`2026-0${i + 1}-01`), endDate: new Date(`2026-0${i + 1}-10`) });
    const page = await call(w.owner, "get", `${sprints(project.id)}?limit=2&page=2`);
    expect(page.body.data.sprints).toHaveLength(1);
    expect(page.body.data.pagination).toEqual({ page: 2, limit: 2, total: 3, totalPages: 2 });
    expect((await call(w.owner, "get", `${sprints(project.id)}?limit=0`)).status).toBe(400);
  });
});

describe("sprint lifecycle", () => {
  it("moves PLANNED → ACTIVE → COMPLETED and refuses any other transition", async () => {
    const project = await makeProject(w.orgId);
    const sprint = await makeSprint(project.id);
    const path = `${sprints(project.id)}/${sprint.id}`;

    expect((await call(w.owner, "post", `${path}/complete`)).status).toBe(409); // not started yet
    expect((await call(w.owner, "post", `${path}/start`)).body.data.sprint.status).toBe("ACTIVE");
    expect((await call(w.owner, "post", `${path}/start`)).status).toBe(409); // already active
    expect((await call(w.owner, "post", `${path}/complete`)).body.data.sprint.status).toBe("COMPLETED");
    expect((await call(w.owner, "post", `${path}/complete`)).status).toBe(409);
    expect((await call(w.owner, "post", `${path}/start`)).status).toBe(409);
  });

  it("deletes only PLANNED sprints and keeps their tasks, just unassigned", async () => {
    const project = await makeProject(w.orgId);
    const planned = await makeSprint(project.id);
    const task = await makeTask(project.id, { sprintId: planned.id });

    expect((await call(w.owner, "delete", `${sprints(project.id)}/${planned.id}`)).status).toBe(200);
    expect((await prisma.task.findUniqueOrThrow({ where: { id: task.id } })).sprintId).toBeNull();
    expect((await call(w.owner, "get", `${sprints(project.id)}/${planned.id}`)).status).toBe(404);

    const active = await makeSprint(project.id, { status: "ACTIVE" });
    const done = await makeSprint(project.id, { status: "COMPLETED" });
    expect((await call(w.owner, "delete", `${sprints(project.id)}/${active.id}`)).status).toBe(409);
    expect((await call(w.owner, "delete", `${sprints(project.id)}/${done.id}`)).status).toBe(409);
    expect(await prisma.sprint.count({ where: { id: { in: [active.id, done.id] } } })).toBe(2);
  });
});

describe("sprint RBAC and tenancy", () => {
  it("TEAM_MEMBER can read sprints but not create, change or delete them", async () => {
    const project = await makeProject(w.orgId);
    const sprint = await makeSprint(project.id);
    const path = `${sprints(project.id)}/${sprint.id}`;

    expect((await call(w.member, "get", path)).status).toBe(200);
    expect((await call(w.member, "post", sprints(project.id), valid)).status).toBe(403);
    expect((await call(w.member, "patch", path, { name: "x" })).status).toBe(403);
    expect((await call(w.member, "post", `${path}/start`)).status).toBe(403);
    expect((await call(w.member, "delete", path)).status).toBe(403);
    expect((await call(w.outsider, "get", path)).status).toBe(404);
    expect((await call(null, "get", path)).status).toBe(401);
  });

  it("a sprint is only reachable through its own project and organization", async () => {
    const mine = await makeProject(w.orgId);
    const sibling = await makeProject(w.orgId);
    const theirs = await makeProject(w.other.orgId);
    const theirSprint = await makeSprint(theirs.id);
    const sprint = await makeSprint(mine.id);

    expect((await call(w.owner, "get", `${sprints(sibling.id)}/${sprint.id}`)).status).toBe(404); // wrong project
    expect((await call(w.owner, "get", `${sprints(theirs.id)}/${theirSprint.id}`)).status).toBe(404); // other tenant
    expect((await call(w.owner, "post", `${sprints(theirs.id)}/${theirSprint.id}/start`)).status).toBe(404);
    expect((await call(w.owner, "delete", `${sprints(theirs.id)}/${theirSprint.id}`)).status).toBe(404);
    expect((await call(w.owner, "post", sprints(theirs.id), valid)).status).toBe(404);
    expect((await prisma.sprint.findUniqueOrThrow({ where: { id: theirSprint.id } })).status).toBe("PLANNED");
  });
});
