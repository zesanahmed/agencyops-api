import { beforeAll, describe, expect, it } from "vitest";
import { prisma } from "./helpers.js";
import { call, makeProject, makeTask, makeTeam, seedWorkspace, uniq, type Workspace } from "./fixtures.js";

let w: Workspace;
beforeAll(async () => {
  w = await seedWorkspace();
}, 60_000);

const base = () => `/organizations/${w.orgId}/projects`;

describe("project CRUD", () => {
  it("creates a project with a generated slug and PLANNING status", async () => {
    const res = await call(w.owner, "post", base(), { name: `Website Redesign ${uniq()}`, description: "Q1 refresh" });
    expect(res.status).toBe(201);
    const project = res.body.data.project;
    expect(project).toMatchObject({ organizationId: w.orgId, status: "PLANNING", description: "Q1 refresh" });
    expect(project.slug).toMatch(/^website-redesign-/);
  });

  it("rejects duplicate slugs inside an organization but allows them in another", async () => {
    const slug = `shared-${uniq()}`;
    expect((await call(w.owner, "post", base(), { name: "One", slug })).status).toBe(201);
    expect((await call(w.owner, "post", base(), { name: "Two", slug })).status).toBe(409);
    expect((await call(w.other.owner, "post", `/organizations/${w.other.orgId}/projects`, { name: "Three", slug })).status).toBe(201);
  });

  it("validates input", async () => {
    const bad: object[] = [
      { name: "" },
      { name: "x".repeat(201) },
      { name: "Ok", status: "NOPE" },
      { name: "Ok", slug: "Not A Slug!" },
      { name: "Ok", startDate: "2026-05-10", dueDate: "2026-05-01" },
      {},
    ];
    for (const body of bad) expect((await call(w.owner, "post", base(), body)).status).toBe(400);
  });

  it("refuses a name that cannot produce a slug", async () => {
    const res = await call(w.owner, "post", base(), { name: "!!!" });
    expect(res.status).toBe(400);
    expect(res.body.message).toContain("slug");
  });

  it("reads, updates and reports a conflicting slug", async () => {
    const a = await makeProject(w.orgId);
    const b = await makeProject(w.orgId);
    expect((await call(w.owner, "get", `${base()}/${a.id}`)).body.data.project.id).toBe(a.id);

    const upd = await call(w.manager, "patch", `${base()}/${a.id}`, { name: "Renamed", status: "ACTIVE" });
    expect(upd.status).toBe(200);
    expect(upd.body.data.project).toMatchObject({ name: "Renamed", status: "ACTIVE" });

    expect((await call(w.owner, "patch", `${base()}/${a.id}`, { slug: b.slug })).status).toBe(409);
    expect((await call(w.owner, "patch", `${base()}/${a.id}`, { slug: a.slug })).status).toBe(200); // own slug is fine
  });

  it("rejects a partial update that would leave dueDate before the stored startDate", async () => {
    const project = await makeProject(w.orgId, { startDate: new Date("2026-03-10"), dueDate: new Date("2026-03-20") });
    const res = await call(w.owner, "patch", `${base()}/${project.id}`, { dueDate: "2026-03-01" });
    expect(res.status).toBe(400);
    expect((await prisma.project.findUniqueOrThrow({ where: { id: project.id } })).dueDate?.toISOString().slice(0, 10)).toBe("2026-03-20");
    expect((await call(w.owner, "patch", `${base()}/${project.id}`, { startDate: "2026-03-25" })).status).toBe(400);
    expect((await call(w.owner, "patch", `${base()}/${project.id}`, { dueDate: "2026-04-01" })).status).toBe(200);
  });

  it("soft-deletes: the project disappears from reads, lists and its task routes but the row stays", async () => {
    const project = await makeProject(w.orgId);
    const task = await makeTask(project.id);
    expect((await call(w.manager, "delete", `${base()}/${project.id}`)).status).toBe(200);

    expect((await call(w.owner, "get", `${base()}/${project.id}`)).status).toBe(404);
    expect((await call(w.owner, "get", `${base()}/${project.id}/tasks/${task.id}`)).status).toBe(404);
    expect((await call(w.owner, "delete", `${base()}/${project.id}`)).status).toBe(404);
    const ids = (await call(w.owner, "get", `${base()}?limit=100`)).body.data.projects.map((p: { id: string }) => p.id);
    expect(ids).not.toContain(project.id);
    expect((await prisma.project.findUniqueOrThrow({ where: { id: project.id } })).deletedAt).not.toBeNull();
  });
});

describe("project list", () => {
  it("paginates, filters, searches and sorts", async () => {
    const tag = uniq();
    const org = (await call(w.owner, "post", "/organizations", { name: `List Org ${tag}` })).body.data.organization.id as string;
    await makeProject(org, { name: `Charlie ${tag}`, slug: `c-${tag}`, status: "ACTIVE" });
    await makeProject(org, { name: `Alpha ${tag}`, slug: `a-${tag}`, status: "PLANNING" });
    await makeProject(org, { name: `Bravo ${tag}`, slug: `b-${tag}`, status: "ACTIVE" });
    const list = (q: string) => call(w.owner, "get", `/organizations/${org}/projects?${q}`);

    const page1 = await list("limit=2&sortBy=name&sortOrder=asc");
    expect(page1.body.data.pagination).toEqual({ page: 1, limit: 2, total: 3, totalPages: 2 });
    expect(page1.body.data.projects.map((p: { name: string }) => p.name)).toEqual([`Alpha ${tag}`, `Bravo ${tag}`]);
    expect((await list("limit=2&page=2&sortBy=name&sortOrder=asc")).body.data.projects).toHaveLength(1);

    expect((await list("status=ACTIVE")).body.data.pagination.total).toBe(2);
    expect((await list("search=BRAVO")).body.data.projects).toHaveLength(1);
    expect((await list("search=nothing-matches")).body.data.projects).toHaveLength(0);

    for (const q of ["limit=0", "limit=101", "page=0", "status=NOPE", "sortBy=password", "sortOrder=sideways"]) {
      expect((await list(q)).status).toBe(400);
    }
  });
});

describe("project RBAC and tenancy", () => {
  it("OWNER and MANAGER manage projects; TEAM_MEMBER can only read; non-members and anonymous callers get nothing", async () => {
    const project = await makeProject(w.orgId);
    const one = `${base()}/${project.id}`;

    expect((await call(w.member, "get", one)).status).toBe(200);
    expect((await call(w.member, "get", base())).status).toBe(200);
    expect((await call(w.member, "post", base(), { name: "Nope" })).status).toBe(403);
    expect((await call(w.member, "patch", one, { name: "Nope" })).status).toBe(403);
    expect((await call(w.member, "delete", one)).status).toBe(403);

    expect((await call(w.outsider, "get", one)).status).toBe(404);
    expect((await call(w.outsider, "post", base(), { name: "Nope" })).status).toBe(404);
    expect((await call(null, "get", one)).status).toBe(401);
    expect((await call(w.owner, "get", `${base()}/not-a-uuid`)).status).toBe(400);
  });

  it("never exposes another organization's project, even with its id", async () => {
    const theirs = await makeProject(w.other.orgId);
    const one = `${base()}/${theirs.id}`;
    expect((await call(w.owner, "get", one)).status).toBe(404);
    expect((await call(w.owner, "patch", one, { name: "Hijack" })).status).toBe(404);
    expect((await call(w.owner, "delete", one)).status).toBe(404);
    expect((await call(w.owner, "get", `${one}/tasks`)).status).toBe(404);
    expect((await call(w.owner, "get", `${base()}?limit=100`)).body.data.projects.map((p: { id: string }) => p.id)).not.toContain(theirs.id);
    expect((await prisma.project.findUniqueOrThrow({ where: { id: theirs.id } })).name).toBe(theirs.name);
  });
});

describe("project teams", () => {
  it("assigns teams once, lists them, and removes them", async () => {
    const project = await makeProject(w.orgId);
    const team = await makeTeam(w.orgId);
    const path = `${base()}/${project.id}/teams`;

    const created = await call(w.manager, "post", path, { teamId: team.id });
    expect(created.status).toBe(201);
    expect((await call(w.owner, "post", path, { teamId: team.id })).status).toBe(409);
    expect((await call(w.member, "get", path)).body.data.teams).toHaveLength(1);

    const linkId = created.body.data.projectTeam.id as string;
    expect((await call(w.owner, "delete", `${path}/${linkId}`)).status).toBe(200);
    expect((await call(w.owner, "delete", `${path}/${linkId}`)).status).toBe(404);
    expect((await call(w.owner, "get", path)).body.data.teams).toHaveLength(0);
  });

  it("only accepts teams of the same organization, and only managers may assign", async () => {
    const project = await makeProject(w.orgId);
    const path = `${base()}/${project.id}/teams`;
    const foreign = await makeTeam(w.other.orgId);
    const deleted = await makeTeam(w.orgId, { deletedAt: new Date() });

    expect((await call(w.owner, "post", path, { teamId: foreign.id })).status).toBe(404);
    expect((await call(w.owner, "post", path, { teamId: deleted.id })).status).toBe(404);
    expect((await call(w.owner, "post", path, { teamId: "nope" })).status).toBe(400);
    expect((await call(w.member, "post", path, { teamId: (await makeTeam(w.orgId)).id })).status).toBe(403);
    expect(await prisma.projectTeam.count({ where: { projectId: project.id } })).toBe(0);
  });
});

describe("project members", () => {
  it("adds active members once, lists them, and removes them", async () => {
    const project = await makeProject(w.orgId);
    const path = `${base()}/${project.id}/members`;

    const added = await call(w.owner, "post", path, { membershipId: w.memberMid });
    expect(added.status).toBe(201);
    expect((await call(w.manager, "post", path, { membershipId: w.memberMid })).status).toBe(409);
    expect((await call(w.member, "get", path)).body.data.members).toHaveLength(1);

    const id = added.body.data.member.id as string;
    expect((await call(w.owner, "delete", `${path}/${id}`)).status).toBe(200);
    expect((await call(w.owner, "delete", `${path}/${id}`)).status).toBe(404);
  });

  it("rejects memberships from another organization and removed members; members cannot manage", async () => {
    const project = await makeProject(w.orgId);
    const path = `${base()}/${project.id}/members`;
    expect((await call(w.owner, "post", path, { membershipId: w.other.ownerMid })).status).toBe(404);

    const gone = await prisma.membership.create({
      data: { userId: w.outsider.id, organizationId: w.orgId, role: "TEAM_MEMBER", status: "REMOVED", removedAt: new Date() },
    });
    expect((await call(w.owner, "post", path, { membershipId: gone.id })).status).toBe(404);
    await prisma.membership.delete({ where: { id: gone.id } });

    expect((await call(w.member, "post", path, { membershipId: w.managerMid })).status).toBe(403);
    expect(await prisma.projectMember.count({ where: { projectId: project.id } })).toBe(0);
  });
});
