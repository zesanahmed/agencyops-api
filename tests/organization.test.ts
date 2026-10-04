import { beforeEach, describe, expect, it } from "vitest";
import { addMember, api, app, auth, createOrg, registerUser, request, resetDatabase } from "./helpers.js";

beforeEach(async () => {
  await resetDatabase();
});

describe("organization CRUD", () => {
  it("creates an organization and makes the creator OWNER", async () => {
    const owner = await registerUser();
    const orgId = await createOrg(owner, "Acme");
    const res = await request(app).get(`${api}/organizations/${orgId}`).set(auth(owner));
    expect(res.status).toBe(200);
    expect(res.body.data.organization.name).toBe("Acme");
  });

  it("lets the OWNER update the organization", async () => {
    const owner = await registerUser();
    const orgId = await createOrg(owner);
    const res = await request(app).patch(`${api}/organizations/${orgId}`).set(auth(owner)).send({ name: "Renamed" });
    expect(res.status).toBe(200);
    expect(res.body.data.organization.name).toBe("Renamed");
  });

  it("blocks a TEAM_MEMBER from deleting the organization", async () => {
    const owner = await registerUser();
    const grunt = await registerUser();
    const orgId = await createOrg(owner);
    await addMember(orgId, grunt, "TEAM_MEMBER");
    const res = await request(app).delete(`${api}/organizations/${orgId}`).set(auth(grunt));
    expect(res.status).toBe(403);
  });
});

describe("membership role changes", () => {
  it("OWNER can promote a TEAM_MEMBER to MANAGER", async () => {
    const owner = await registerUser();
    const member = await registerUser();
    const orgId = await createOrg(owner);
    const membershipId = await addMember(orgId, member, "TEAM_MEMBER");

    const res = await request(app)
      .patch(`${api}/organizations/${orgId}/members/${membershipId}/role`)
      .set(auth(owner))
      .send({ role: "MANAGER" });
    expect(res.status).toBe(200);
    expect(res.body.data.member.role).toBe("MANAGER");
  });

  it("TEAM_MEMBER cannot change anyone's role", async () => {
    const owner = await registerUser();
    const grunt = await registerUser();
    const orgId = await createOrg(owner);
    const gruntMembershipId = await addMember(orgId, grunt, "TEAM_MEMBER");

    const res = await request(app)
      .patch(`${api}/organizations/${orgId}/members/${gruntMembershipId}/role`)
      .set(auth(grunt))
      .send({ role: "MANAGER" });
    expect(res.status).toBe(403);
  });

  it("OWNER can remove a member", async () => {
    const owner = await registerUser();
    const member = await registerUser();
    const orgId = await createOrg(owner);
    const membershipId = await addMember(orgId, member, "TEAM_MEMBER");

    const res = await request(app).delete(`${api}/organizations/${orgId}/members/${membershipId}`).set(auth(owner));
    expect(res.status).toBe(200);

    const listRes = await request(app).get(`${api}/organizations/${orgId}/members`).set(auth(owner));
    expect(listRes.body.data.members.some((m: { id: string }) => m.id === membershipId)).toBe(false);
  });
});

describe("tenant isolation", () => {
  it("a member of org A cannot read org B", async () => {
    const ownerA = await registerUser();
    const ownerB = await registerUser();
    await createOrg(ownerA, "Org A");
    const orgB = await createOrg(ownerB, "Org B");

    const res = await request(app).get(`${api}/organizations/${orgB}`).set(auth(ownerA));
    expect([403, 404]).toContain(res.status);
  });

  it("a non-member cannot list org B's members", async () => {
    const ownerA = await registerUser();
    const ownerB = await registerUser();
    await createOrg(ownerA);
    const orgB = await createOrg(ownerB);

    const res = await request(app).get(`${api}/organizations/${orgB}/members`).set(auth(ownerA));
    expect([403, 404]).toContain(res.status);
  });

  it("a non-member cannot create a project in another org", async () => {
    const ownerA = await registerUser();
    const ownerB = await registerUser();
    await createOrg(ownerA);
    const orgB = await createOrg(ownerB);

    const res = await request(app)
      .post(`${api}/organizations/${orgB}/projects`)
      .set(auth(ownerA))
      .send({ name: "Sneaky Project" });
    expect([403, 404]).toContain(res.status);
  });

  it("a project created in org A is not visible when queried through org B's path", async () => {
    const ownerA = await registerUser();
    const ownerB = await registerUser();
    const orgA = await createOrg(ownerA);
    const orgB = await createOrg(ownerB);

    const createRes = await request(app)
      .post(`${api}/organizations/${orgA}/projects`)
      .set(auth(ownerA))
      .send({ name: "Org A Project" });
    const projectId = createRes.body.data.project.id;

    const res = await request(app).get(`${api}/organizations/${orgB}/projects/${projectId}`).set(auth(ownerB));
    expect(res.status).toBe(404);
  });
});

describe("unauthorized access", () => {
  it("rejects organization routes with no token", async () => {
    const res = await request(app).get(`${api}/organizations`);
    expect(res.status).toBe(401);
  });

  it("rejects a non-member entirely (not just wrong role)", async () => {
    const owner = await registerUser();
    const stranger = await registerUser();
    const orgId = await createOrg(owner);
    const res = await request(app).get(`${api}/organizations/${orgId}/teams`).set(auth(stranger));
    expect([403, 404]).toContain(res.status);
  });
});
