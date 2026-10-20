import { randomBytes } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { hashToken } from "../src/modules/auth/auth.utils.js";
import { prisma, registerUser } from "./helpers.js";
import { call, seedWorkspace, uniq, type Workspace } from "./fixtures.js";

let w: Workspace;
beforeAll(async () => {
  w = await seedWorkspace();
}, 60_000);

const invites = () => `/organizations/${w.orgId}/invitations`;
const newEmail = () => `invitee-${uniq()}@example.com`;

async function invite(email = newEmail(), role: "MANAGER" | "TEAM_MEMBER" = "TEAM_MEMBER", user = w.owner) {
  const res = await call(user, "post", invites(), { email, role });
  return { res, email, token: res.body.data?.inviteToken as string, id: res.body.data?.invitation?.id as string };
}
/** An invitation row with a token we know, for states the API cannot produce directly. */
async function seedInvitation(email: string, over: Record<string, unknown> = {}) {
  const token = randomBytes(16).toString("hex");
  const row = await prisma.invitation.create({
    data: {
      organizationId: w.orgId,
      email,
      role: "TEAM_MEMBER",
      tokenHash: hashToken(token),
      invitedByMembershipId: w.ownerMid,
      expiresAt: new Date(Date.now() + 86_400_000),
      ...over,
    } as never,
  });
  return { token, id: row.id };
}

describe("creating invitations", () => {
  it("OWNER and MANAGER can invite; email is normalised; the token is never stored raw", async () => {
    const email = newEmail().toUpperCase();
    const res = await call(w.manager, "post", invites(), { email, role: "MANAGER" });
    expect(res.status).toBe(201);
    expect(res.body.data.invitation).toMatchObject({ email: email.toLowerCase(), role: "MANAGER", acceptedAt: null, revokedAt: null });
    expect(res.body.data.invitation.tokenHash).toBeUndefined();
    const row = await prisma.invitation.findUniqueOrThrow({ where: { id: res.body.data.invitation.id } });
    expect(row.tokenHash).toBe(hashToken(res.body.data.inviteToken));
    expect(row.tokenHash).not.toBe(res.body.data.inviteToken);
    expect((await invite(newEmail(), "TEAM_MEMBER", w.owner)).res.status).toBe(201);
  });

  it("validates input: role must be MANAGER or TEAM_MEMBER", async () => {
    for (const body of [{}, { email: "nope", role: "MANAGER" }, { email: newEmail(), role: "OWNER" }, { email: newEmail() }]) {
      expect((await call(w.owner, "post", invites(), body)).status).toBe(400);
    }
  });

  it("refuses people who are already active members", async () => {
    expect((await call(w.owner, "post", invites(), { email: w.member.email, role: "MANAGER" })).status).toBe(409);
  });

  it("a new invitation revokes the earlier pending one for the same email", async () => {
    const first = await invite();
    const second = await call(w.owner, "post", invites(), { email: first.email, role: "MANAGER" });
    expect(second.status).toBe(201);
    expect((await prisma.invitation.findUniqueOrThrow({ where: { id: first.id } })).revokedAt).not.toBeNull();
    expect((await call(null, "get", `/invitations/${first.token}`)).status).toBe(404);
    expect((await call(null, "get", `/invitations/${second.body.data.inviteToken}`)).status).toBe(200);
  });

  it("TEAM_MEMBER cannot create, list or revoke; outsiders and anonymous are refused", async () => {
    const { id } = await invite();
    expect((await call(w.member, "post", invites(), { email: newEmail(), role: "TEAM_MEMBER" })).status).toBe(403);
    expect((await call(w.member, "get", invites())).status).toBe(403);
    expect((await call(w.member, "delete", `${invites()}/${id}`)).status).toBe(403);
    expect((await call(w.outsider, "get", invites())).status).toBe(404);
    expect((await call(null, "get", invites())).status).toBe(401);
  });
});

describe("listing and revoking", () => {
  it("lists newest first with pagination, only for this organization", async () => {
    await invite();
    await call(w.other.owner, "post", `/organizations/${w.other.orgId}/invitations`, { email: newEmail(), role: "MANAGER" });
    const list = await call(w.manager, "get", `${invites()}?limit=2`);
    expect(list.status).toBe(200);
    expect(list.body.data.invitations.length).toBeLessThanOrEqual(2);
    expect(list.body.data.invitations.every((i: { organizationId: string }) => i.organizationId === w.orgId)).toBe(true);
    expect(list.body.data.pagination.limit).toBe(2);
  });

  it("revokes (idempotently), refuses accepted ones, and cannot touch another tenant's invitation", async () => {
    const { id, token } = await invite();
    expect((await call(w.manager, "delete", `${invites()}/${id}`)).status).toBe(200);
    expect((await call(w.manager, "delete", `${invites()}/${id}`)).status).toBe(200);
    expect((await call(null, "get", `/invitations/${token}`)).status).toBe(404);

    const accepted = await seedInvitation(newEmail(), { acceptedAt: new Date() });
    expect((await call(w.owner, "delete", `${invites()}/${accepted.id}`)).status).toBe(409);

    const theirs = await call(w.other.owner, "post", `/organizations/${w.other.orgId}/invitations`, { email: newEmail(), role: "MANAGER" });
    const theirId = theirs.body.data.invitation.id as string;
    expect((await call(w.owner, "delete", `${invites()}/${theirId}`)).status).toBe(404);
    expect((await prisma.invitation.findUniqueOrThrow({ where: { id: theirId } })).revokedAt).toBeNull();
    expect((await call(w.owner, "delete", `${invites()}/nope`)).status).toBe(400);
  });
});

describe("preview and accept", () => {
  it("previews a usable invitation without auth and exposes nothing sensitive", async () => {
    const { token, email } = await invite(newEmail(), "MANAGER");
    const res = await call(null, "get", `/invitations/${token}`);
    expect(res.status).toBe(200);
    expect(res.body.data.invitation).toMatchObject({ organizationName: "Acme", email, role: "MANAGER" });
    expect(JSON.stringify(res.body)).not.toContain(token);
  });

  it("treats unknown, expired and revoked tokens identically (404)", async () => {
    const expired = await seedInvitation(newEmail(), { expiresAt: new Date(Date.now() - 1000) });
    const revoked = await seedInvitation(newEmail(), { revokedAt: new Date() });
    for (const token of ["f".repeat(64), expired.token, revoked.token]) {
      const res = await call(null, "get", `/invitations/${token}`);
      expect(res.status).toBe(404);
      expect(res.body.message).toBe("This invitation is invalid or no longer available");
    }
  });

  it("accepting creates the membership with the invited role and consumes the token", async () => {
    const user = await registerUser("Newcomer");
    const { token, id } = await invite(user.email, "MANAGER");
    expect((await call(null, "post", `/invitations/${token}/accept`)).status).toBe(401);

    expect((await call(user, "post", `/invitations/${token}/accept`)).status).toBe(200);
    const m = await prisma.membership.findFirstOrThrow({ where: { userId: user.id, organizationId: w.orgId } });
    expect(m).toMatchObject({ role: "MANAGER", status: "ACTIVE" });
    expect((await prisma.invitation.findUniqueOrThrow({ where: { id } })).acceptedAt).not.toBeNull();
    expect((await call(user, "post", `/invitations/${token}/accept`)).status).toBe(404); // single use
    expect((await call(user, "get", `/organizations/${w.orgId}`)).status).toBe(200);
  });

  it("only the invited email can accept it", async () => {
    const { token, id } = await invite(newEmail());
    expect((await call(w.outsider, "post", `/invitations/${token}/accept`)).status).toBe(403);
    expect(await prisma.membership.count({ where: { userId: w.outsider.id, organizationId: w.orgId } })).toBe(0);
    expect((await prisma.invitation.findUniqueOrThrow({ where: { id } })).acceptedAt).toBeNull();
  });

  it("refuses expired or revoked tokens and people who are already members", async () => {
    const user = await registerUser("Late");
    const expired = await seedInvitation(user.email, { expiresAt: new Date(Date.now() - 1000) });
    const revoked = await seedInvitation(user.email, { revokedAt: new Date() });
    expect((await call(user, "post", `/invitations/${expired.token}/accept`)).status).toBe(404);
    expect((await call(user, "post", `/invitations/${revoked.token}/accept`)).status).toBe(404);

    const dup = await seedInvitation(w.member.email);
    expect((await call(w.member, "post", `/invitations/${dup.token}/accept`)).status).toBe(409);
  });

  it("re-accepting after removal reactivates the old membership with the new role", async () => {
    const user = await registerUser("Boomerang");
    const old = await prisma.membership.create({
      data: { userId: user.id, organizationId: w.orgId, role: "TEAM_MEMBER", status: "REMOVED", removedAt: new Date() },
    });
    const { token } = await invite(user.email, "MANAGER");
    expect((await call(user, "post", `/invitations/${token}/accept`)).status).toBe(200);
    const m = await prisma.membership.findUniqueOrThrow({ where: { id: old.id } });
    expect(m).toMatchObject({ status: "ACTIVE", role: "MANAGER", removedAt: null });
    expect(await prisma.membership.count({ where: { userId: user.id, organizationId: w.orgId } })).toBe(1);
  });
});
