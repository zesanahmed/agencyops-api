import { beforeEach, describe, expect, it, vi } from "vitest";
import { api, app, auth, createOrg, PASSWORD, prisma, request, resetDatabase } from "./helpers.js";
import { enqueueEmailQuietly } from "../src/modules/email/email.queue.js";
import type { EmailJob } from "../src/modules/email/email.types.js";
import { hashToken } from "../src/modules/auth/auth.utils.js";

const sent = () => vi.mocked(enqueueEmailQuietly).mock.calls.map((c) => c[0] as EmailJob);
const lastToken = (type: "VERIFY_EMAIL" | "PASSWORD_RESET"): string => {
  const jobs = sent().filter((j): j is Extract<EmailJob, { type: typeof type }> => j.type === type);
  const job = jobs.at(-1);
  if (!job) throw new Error(`no ${type} email was queued`);
  return job.token;
};

interface Account {
  id: string;
  email: string;
  accessToken: string;
  cookie: string;
}
let counter = 0;
async function signUp(name = "Alex Account"): Promise<Account> {
  counter += 1;
  const email = `acct${counter}-${Date.now()}@example.com`;
  const res = await request(app).post(`${api}/auth/register`).send({ name, email, password: PASSWORD });
  expect(res.status).toBe(201);
  const cookie = (res.headers["set-cookie"] as unknown as string[])[0]!.split(";")[0]!;
  return { id: res.body.data.user.id, email, accessToken: res.body.data.accessToken, cookie };
}
const login = (email: string, password = PASSWORD) => request(app).post(`${api}/auth/login`).send({ email, password });
const refresh = (cookie: string) => request(app).post(`${api}/auth/refresh`).set("Cookie", cookie);
const bearer = (a: Pick<Account, "accessToken">) => auth({ id: "", email: "", accessToken: a.accessToken });
const NEW_PASSWORD = "BrandNewPassword456!";

beforeEach(async () => {
  await resetDatabase();
  vi.mocked(enqueueEmailQuietly).mockClear();
});

describe("email verification", () => {
  it("registration queues a verification email whose link verifies the account exactly once", async () => {
    const user = await signUp("Vera Verify");
    expect(sent()).toEqual([{ type: "VERIFY_EMAIL", to: user.email, name: "Vera Verify", token: expect.any(String) }]);

    const before = await request(app).get(`${api}/auth/me`).set(bearer(user));
    expect(before.body.data.user.emailVerifiedAt).toBeNull();

    const token = lastToken("VERIFY_EMAIL");
    expect((await request(app).post(`${api}/auth/verify-email`).send({ token })).status).toBe(200);
    expect((await request(app).get(`${api}/auth/me`).set(bearer(user))).body.data.user.emailVerifiedAt).not.toBeNull();

    // One-time: the same link cannot be replayed.
    expect((await request(app).post(`${api}/auth/verify-email`).send({ token })).status).toBe(400);
  });

  it("stores only a hash of the token and rejects unknown, expired and malformed tokens the same way", async () => {
    const user = await signUp();
    const token = lastToken("VERIFY_EMAIL");
    const stored = await prisma.authToken.findMany({ where: { userId: user.id } });
    expect(stored).toHaveLength(1);
    expect(stored[0]!.tokenHash).toBe(hashToken(token));
    expect(stored[0]!.tokenHash).not.toContain(token);

    await prisma.authToken.update({ where: { id: stored[0]!.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    const expired = await request(app).post(`${api}/auth/verify-email`).send({ token });
    const unknown = await request(app).post(`${api}/auth/verify-email`).send({ token: "f".repeat(64) });
    expect(expired.status).toBe(400);
    expect(unknown.status).toBe(400);
    expect(expired.body.message).toBe(unknown.body.message);
    expect((await request(app).post(`${api}/auth/verify-email`).send({ token: "x" })).status).toBe(400);
  });

  it("a password-reset token cannot be used as a verification token", async () => {
    const user = await signUp();
    await request(app).post(`${api}/auth/forgot-password`).send({ email: user.email });
    const resetToken = lastToken("PASSWORD_RESET");
    expect((await request(app).post(`${api}/auth/verify-email`).send({ token: resetToken })).status).toBe(400);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).emailVerifiedAt).toBeNull();
  });

  it("resend requires sign-in, replaces the old link, and does nothing once verified", async () => {
    const user = await signUp();
    expect((await request(app).post(`${api}/auth/resend-verification`)).status).toBe(401);

    const first = lastToken("VERIFY_EMAIL");
    const again = await request(app).post(`${api}/auth/resend-verification`).set(bearer(user));
    expect(again.status).toBe(200);
    expect(again.body.data.sent).toBe(true);
    const second = lastToken("VERIFY_EMAIL");
    expect(second).not.toBe(first);
    expect((await request(app).post(`${api}/auth/verify-email`).send({ token: first })).status).toBe(400);
    expect((await request(app).post(`${api}/auth/verify-email`).send({ token: second })).status).toBe(200);

    const count = sent().length;
    const done = await request(app).post(`${api}/auth/resend-verification`).set(bearer(user));
    expect(done.body.data.sent).toBe(false);
    expect(sent()).toHaveLength(count);
  });
});

describe("forgot / reset password", () => {
  it("answers identically for known, unknown and deleted addresses, and only emails real accounts", async () => {
    const user = await signUp();
    vi.mocked(enqueueEmailQuietly).mockClear();

    const known = await request(app).post(`${api}/auth/forgot-password`).send({ email: user.email.toUpperCase() });
    const unknown = await request(app).post(`${api}/auth/forgot-password`).send({ email: "nobody@example.com" });
    expect(known.status).toBe(200);
    expect(unknown.status).toBe(200);
    expect(unknown.body).toEqual(known.body);
    expect(sent().map((j) => j.type)).toEqual(["PASSWORD_RESET"]);
    expect(sent()[0]).toMatchObject({ to: user.email });

    await prisma.user.update({ where: { id: user.id }, data: { deletedAt: new Date() } });
    vi.mocked(enqueueEmailQuietly).mockClear();
    expect((await request(app).post(`${api}/auth/forgot-password`).send({ email: user.email })).status).toBe(200);
    expect(sent()).toHaveLength(0);

    expect((await request(app).post(`${api}/auth/forgot-password`).send({ email: "not-an-email" })).status).toBe(400);
  });

  it("resets the password once, signs out every session and verifies the mailbox", async () => {
    const user = await signUp();
    await request(app).post(`${api}/auth/forgot-password`).send({ email: user.email });
    const token = lastToken("PASSWORD_RESET");

    const res = await request(app).post(`${api}/auth/reset-password`).send({ token, password: NEW_PASSWORD });
    expect(res.status).toBe(200);

    expect((await login(user.email)).status).toBe(401);
    expect((await login(user.email, NEW_PASSWORD)).status).toBe(200);
    expect((await refresh(user.cookie)).status).toBe(401); // pre-reset session is dead
    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).emailVerifiedAt).not.toBeNull();

    // One-time use.
    expect((await request(app).post(`${api}/auth/reset-password`).send({ token, password: "AnotherPassword789!" })).status).toBe(400);
  });

  it("rejects weak passwords without burning the token, and rejects expired or replaced links", async () => {
    const user = await signUp();
    await request(app).post(`${api}/auth/forgot-password`).send({ email: user.email });
    const first = lastToken("PASSWORD_RESET");

    expect((await request(app).post(`${api}/auth/reset-password`).send({ token: first, password: "short" })).status).toBe(400);

    await request(app).post(`${api}/auth/forgot-password`).send({ email: user.email });
    const second = lastToken("PASSWORD_RESET");
    expect((await request(app).post(`${api}/auth/reset-password`).send({ token: first, password: NEW_PASSWORD })).status).toBe(400);

    await prisma.authToken.updateMany({ where: { tokenHash: hashToken(second) }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await request(app).post(`${api}/auth/reset-password`).send({ token: second, password: NEW_PASSWORD })).status).toBe(400);
    expect((await login(user.email)).status).toBe(200); // password untouched
  });

  it("lets an account without a password (OAuth-only) set one", async () => {
    const user = await signUp();
    await prisma.user.update({ where: { id: user.id }, data: { passwordHash: null } });
    await request(app).post(`${api}/auth/forgot-password`).send({ email: user.email });
    expect(
      (await request(app).post(`${api}/auth/reset-password`).send({ token: lastToken("PASSWORD_RESET"), password: NEW_PASSWORD })).status,
    ).toBe(200);
    expect((await login(user.email, NEW_PASSWORD)).status).toBe(200);
  });
});

describe("change password", () => {
  it("requires the current password, then revokes every session", async () => {
    const user = await signUp();
    const other = await login(user.email);
    const otherCookie = (other.headers["set-cookie"] as unknown as string[])[0]!.split(";")[0]!;
    const change = (body: object) => request(app).post(`${api}/auth/change-password`).set(bearer(user)).send(body);

    expect((await request(app).post(`${api}/auth/change-password`).send({ currentPassword: PASSWORD, newPassword: NEW_PASSWORD })).status).toBe(401);
    expect((await change({ currentPassword: "WrongPassword123!", newPassword: NEW_PASSWORD })).status).toBe(400);
    expect((await change({ currentPassword: PASSWORD, newPassword: PASSWORD })).status).toBe(400);
    expect((await change({ currentPassword: PASSWORD, newPassword: "short" })).status).toBe(400);

    expect((await change({ currentPassword: PASSWORD, newPassword: NEW_PASSWORD })).status).toBe(200);
    expect((await refresh(user.cookie)).status).toBe(401);
    expect((await refresh(otherCookie)).status).toBe(401);
    expect((await login(user.email)).status).toBe(401);
    expect((await login(user.email, NEW_PASSWORD)).status).toBe(200);
  });

  it("refuses accounts that have no password and points them to the reset flow", async () => {
    const user = await signUp();
    await prisma.user.update({ where: { id: user.id }, data: { passwordHash: null } });
    const res = await request(app).post(`${api}/auth/change-password`).set(bearer(user)).send({ currentPassword: PASSWORD, newPassword: NEW_PASSWORD });
    expect(res.status).toBe(400);
    expect(res.body.message).toContain("forgot password");
  });
});

describe("sessions", () => {
  it("lists only active sessions, flags the current one, and revokes a chosen one", async () => {
    const user = await signUp();
    const second = await login(user.email);
    const secondCookie = (second.headers["set-cookie"] as unknown as string[])[0]!.split(";")[0]!;

    const list = await request(app).get(`${api}/auth/sessions`).set(bearer(user));
    expect(list.status).toBe(200);
    const sessions = list.body.data.sessions as { id: string; current: boolean }[];
    expect(sessions).toHaveLength(2);
    expect(sessions.filter((s) => s.current)).toHaveLength(1);
    expect(JSON.stringify(list.body)).not.toMatch(/refreshToken|tokenHash/i);

    const target = sessions.find((s) => !s.current)!;
    expect((await request(app).delete(`${api}/auth/sessions/${target.id}`).set(bearer(user))).status).toBe(200);
    expect((await refresh(secondCookie)).status).toBe(401);
    expect((await request(app).get(`${api}/auth/sessions`).set(bearer(user))).body.data.sessions).toHaveLength(1);
    expect((await request(app).delete(`${api}/auth/sessions/${target.id}`).set(bearer(user))).status).toBe(404);
  });

  it("never lets one user see or revoke another user's session", async () => {
    const alice = await signUp("Alice");
    const bob = await signUp("Bob");
    const bobSession = (await request(app).get(`${api}/auth/sessions`).set(bearer(bob))).body.data.sessions[0].id as string;

    expect((await request(app).delete(`${api}/auth/sessions/${bobSession}`).set(bearer(alice))).status).toBe(404);
    expect((await refresh(bob.cookie)).status).toBe(200);
    expect((await request(app).get(`${api}/auth/sessions`).set(bearer(alice))).body.data.sessions.map((s: { id: string }) => s.id)).not.toContain(bobSession);
    expect((await request(app).delete(`${api}/auth/sessions/not-a-uuid`).set(bearer(alice))).status).toBe(400);
    expect((await request(app).get(`${api}/auth/sessions`)).status).toBe(401);
  });
});

describe("account deletion", () => {
  it("needs the password, is blocked while the user owns an organization, then disables the account", async () => {
    const user = await signUp("Dana Delete");
    const orgId = await createOrg({ id: user.id, email: user.email, accessToken: user.accessToken }, "Dana Co");
    const del = (body: object = {}) => request(app).delete(`${api}/auth/account`).set(bearer(user)).send(body);

    expect((await request(app).delete(`${api}/auth/account`).send({ password: PASSWORD })).status).toBe(401);
    expect((await del()).status).toBe(400);
    expect((await del({ password: "WrongPassword123!" })).status).toBe(400);
    const blocked = await del({ password: PASSWORD });
    expect(blocked.status).toBe(409);
    expect(blocked.body.message).toContain("Dana Co");

    await prisma.organization.update({ where: { id: orgId }, data: { deletedAt: new Date() } });
    expect((await del({ password: PASSWORD })).status).toBe(200);

    expect((await login(user.email)).status).toBe(401);
    expect((await refresh(user.cookie)).status).toBe(401);
    const row = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(row.deletedAt).not.toBeNull();
    expect(row.email).not.toBe(user.email);
    expect(row.passwordHash).toBeNull();
    expect(await prisma.membership.count({ where: { userId: user.id, status: "ACTIVE" } })).toBe(0);
    expect(await prisma.membership.count({ where: { userId: user.id } })).toBe(1); // history kept

    // The address is free again.
    const again = await request(app).post(`${api}/auth/register`).send({ name: "Dana Again", email: user.email, password: PASSWORD });
    expect(again.status).toBe(201);
  });

  it("does not need a password for an account that has none", async () => {
    const user = await signUp();
    await prisma.user.update({ where: { id: user.id }, data: { passwordHash: null } });
    expect((await request(app).delete(`${api}/auth/account`).set(bearer(user))).status).toBe(200);
  });
});
