import { beforeAll, describe, expect, it } from "vitest";
import { prisma } from "./helpers.js";
import { call, makeTeam, seedWorkspace, uniq, type Workspace } from "./fixtures.js";

let w: Workspace;
beforeAll(async () => {
  w = await seedWorkspace();
}, 60_000);

const teams = () => `/organizations/${w.orgId}/teams`;

describe("teams", () => {
  it("creates, reads, updates, lists and soft-deletes a team", async () => {
    const name = `Platform ${uniq()}`;
    const created = await call(w.manager, "post", teams(), { name, description: "Infra" });
    expect(created.status).toBe(201);
    const id = created.body.data.team.id as string;

    expect((await call(w.member, "get", `${teams()}/${id}`)).body.data.team).toMatchObject({ name, description: "Infra" });
    const renamed = await call(w.owner, "patch", `${teams()}/${id}`, { name: `${name} 2` });
    expect(renamed.body.data.team.name).toBe(`${name} 2`);
    expect((await call(w.member, "get", teams())).body.data.teams.map((t: { id: string }) => t.id)).toContain(id);

    expect((await call(w.owner, "delete", `${teams()}/${id}`)).status).toBe(200);
    expect((await call(w.owner, "get", `${teams()}/${id}`)).status).toBe(404);
    expect((await call(w.member, "get", teams())).body.data.teams.map((t: { id: string }) => t.id)).not.toContain(id);
    // A deleted team's name can be reused.
    expect((await call(w.owner, "post", teams(), { name: `${name} 2` })).status).toBe(201);
  });

  it("validates input and refuses duplicate names (also on rename)", async () => {
    const a = await makeTeam(w.orgId);
    const b = await makeTeam(w.orgId);
    for (const body of [{}, { name: "" }, { name: "x".repeat(151) }]) {
      expect((await call(w.owner, "post", teams(), body)).status).toBe(400);
    }
    expect((await call(w.owner, "post", teams(), { name: a.name })).status).toBe(409);
    expect((await call(w.owner, "patch", `${teams()}/${b.id}`, { name: a.name })).status).toBe(409);
    expect((await call(w.owner, "patch", `${teams()}/${a.id}`, { name: a.name })).status).toBe(200); // own name is fine
    // The same name in another organization is fine.
    expect((await call(w.other.owner, "post", `/organizations/${w.other.orgId}/teams`, { name: a.name })).status).toBe(201);
  });

  it("lists with pagination", async () => {
    for (let i = 0; i < 3; i++) await makeTeam(w.other.orgId);
    const page = await call(w.other.owner, "get", `/organizations/${w.other.orgId}/teams?limit=2&page=2`);
    expect(page.status).toBe(200);
    expect(page.body.data.pagination.limit).toBe(2);
    expect(page.body.data.teams.length).toBeGreaterThanOrEqual(1);
    expect((await call(w.owner, "get", `${teams()}?page=0`)).status).toBe(400);
  });

  it("manages members: active org members only, once each", async () => {
    const team = await makeTeam(w.orgId);
    const path = `${teams()}/${team.id}/members`;
    const removed = await prisma.membership.create({
      data: { userId: w.outsider.id, organizationId: w.orgId, role: "TEAM_MEMBER", status: "REMOVED", removedAt: new Date() },
    });

    const added = await call(w.manager, "post", path, { membershipId: w.memberMid });
    expect(added.status).toBe(201);
    expect((await call(w.manager, "post", path, { membershipId: w.memberMid })).status).toBe(409);
    expect((await call(w.manager, "post", path, { membershipId: w.other.ownerMid })).status).toBe(404);
    expect((await call(w.manager, "post", path, { membershipId: removed.id })).status).toBe(404);
    expect((await call(w.manager, "post", path, { membershipId: "nope" })).status).toBe(400);
    expect((await call(w.member, "get", path)).body.data.members).toHaveLength(1);

    const id = added.body.data.member.id as string;
    expect((await call(w.manager, "delete", `${path}/${id}`)).status).toBe(200);
    expect((await call(w.manager, "delete", `${path}/${id}`)).status).toBe(404);
    await prisma.membership.delete({ where: { id: removed.id } });
  });

  it("TEAM_MEMBER can only read; outsiders, anonymous callers and other tenants are refused", async () => {
    const team = await makeTeam(w.orgId);
    const theirs = await makeTeam(w.other.orgId);
    const path = `${teams()}/${team.id}`;

    expect((await call(w.member, "get", path)).status).toBe(200);
    expect((await call(w.member, "post", teams(), { name: "Nope" })).status).toBe(403);
    expect((await call(w.member, "patch", path, { name: "Nope" })).status).toBe(403);
    expect((await call(w.member, "delete", path)).status).toBe(403);
    expect((await call(w.member, "post", `${path}/members`, { membershipId: w.memberMid })).status).toBe(403);
    expect((await call(w.outsider, "get", path)).status).toBe(404);
    expect((await call(null, "get", path)).status).toBe(401);
    expect((await call(w.owner, "get", `${teams()}/${theirs.id}`)).status).toBe(404);
    expect((await call(w.owner, "delete", `${teams()}/${theirs.id}`)).status).toBe(404);
    expect((await call(w.owner, "post", `${teams()}/${theirs.id}/members`, { membershipId: w.ownerMid })).status).toBe(404);
    expect((await prisma.team.findUniqueOrThrow({ where: { id: theirs.id } })).deletedAt).toBeNull();
  });
});
