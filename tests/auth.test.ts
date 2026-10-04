import { beforeEach, describe, expect, it } from "vitest";
import { api, app, PASSWORD, registerUser, request, resetDatabase } from "./helpers.js";

function cookieValue(res: { headers: Record<string, unknown> }): string {
  const raw = (res.headers["set-cookie"] as unknown as string[])[0]!;
  return raw.split(";")[0]!; // "name=value" only, stripped of Path/HttpOnly/SameSite attrs
}

beforeEach(async () => {
  await resetDatabase();
});

describe("POST /auth/register", () => {
  it("registers successfully and returns safe user + access token", async () => {
    const res = await request(app)
      .post(`${api}/auth/register`)
      .send({ name: "Alice", email: "alice@example.com", password: PASSWORD });
    expect(res.status).toBe(201);
    expect(res.body.data.accessToken).toBeTypeOf("string");
    expect(res.body.data.user.email).toBe("alice@example.com");
    expect(res.body.data.user.passwordHash).toBeUndefined();
    expect(res.body.data.refreshToken).toBeUndefined();
  });

  it("sets an HttpOnly refresh cookie", async () => {
    const res = await request(app)
      .post(`${api}/auth/register`)
      .send({ name: "Bob", email: "bob@example.com", password: PASSWORD });
    const cookie = (res.headers["set-cookie"] as unknown as string[])[0]!;
    expect(cookie).toContain("HttpOnly");
    expect(cookie.toLowerCase()).toContain("samesite=strict");
  });

  it("rejects a duplicate email with 409", async () => {
    const res = await request(app)
      .post(`${api}/auth/register`)
      .send({ name: "Dup", email: "dup@example.com", password: PASSWORD });
    expect(res.status).toBe(201);
    const res2 = await request(app)
      .post(`${api}/auth/register`)
      .send({ name: "Dup2", email: "dup@example.com", password: PASSWORD });
    expect(res2.status).toBe(409);
  });

  it("rejects invalid input with 400", async () => {
    const res = await request(app)
      .post(`${api}/auth/register`)
      .send({ name: "", email: "not-an-email", password: "short" });
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(Array.isArray(res.body.errors)).toBe(true);
  });
});

describe("POST /auth/login", () => {
  it("logs in with correct credentials", async () => {
    await request(app).post(`${api}/auth/register`).send({ name: "Carl", email: "carl@example.com", password: PASSWORD });
    const res = await request(app).post(`${api}/auth/login`).send({ email: "carl@example.com", password: PASSWORD });
    expect(res.status).toBe(200);
    expect(res.body.data.accessToken).toBeTypeOf("string");
  });

  it("rejects wrong password with a generic 401", async () => {
    await request(app).post(`${api}/auth/register`).send({ name: "Dana", email: "dana@example.com", password: PASSWORD });
    const res = await request(app).post(`${api}/auth/login`).send({ email: "dana@example.com", password: "WrongPassword!" });
    expect(res.status).toBe(401);
    expect(res.body.message).toBe("Invalid email or password");
  });

  it("rejects a nonexistent email with the SAME generic message", async () => {
    const res = await request(app).post(`${api}/auth/login`).send({ email: "nobody@example.com", password: PASSWORD });
    expect(res.status).toBe(401);
    expect(res.body.message).toBe("Invalid email or password");
  });
});

describe("refresh / logout lifecycle", () => {
  it("refreshes with a valid cookie and rotates it, invalidating the old refresh token", async () => {
    const registerRes = await request(app)
      .post(`${api}/auth/register`)
      .send({ name: "Eve2", email: "eve2@example.com", password: PASSWORD });
    const originalCookie = cookieValue(registerRes);

    const r1 = await request(app).post(`${api}/auth/refresh`).set("Cookie", originalCookie);
    expect(r1.status).toBe(200);
    expect(r1.body.data.accessToken).toBeTypeOf("string");

    // Reusing the SAME (now-rotated-away) cookie again must fail.
    const r2 = await request(app).post(`${api}/auth/refresh`).set("Cookie", originalCookie);
    expect(r2.status).toBe(401);
  });

  it("an already-used-and-rotated cookie stays invalid even after a valid rotation", async () => {
    const registerRes = await request(app)
      .post(`${api}/auth/register`)
      .send({ name: "Heidi", email: "heidi@example.com", password: PASSWORD });
    const cookie1 = cookieValue(registerRes);

    const refreshRes = await request(app).post(`${api}/auth/refresh`).set("Cookie", cookie1);
    const cookie2 = cookieValue(refreshRes);

    // New cookie works.
    const r3 = await request(app).post(`${api}/auth/refresh`).set("Cookie", cookie2);
    expect(r3.status).toBe(200);

    // Old (first) cookie is permanently dead now, not just "used once".
    const r4 = await request(app).post(`${api}/auth/refresh`).set("Cookie", cookie1);
    expect(r4.status).toBe(401);
  });

  it("logout is idempotent with no cookie", async () => {
    const res = await request(app).post(`${api}/auth/logout`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it("logout-all requires authentication", async () => {
    const res = await request(app).post(`${api}/auth/logout-all`);
    expect(res.status).toBe(401);
  });

  it("logout-all revokes sessions so a prior refresh cookie stops working", async () => {
    const registerRes = await request(app)
      .post(`${api}/auth/register`)
      .send({ name: "Ivan", email: "ivan@example.com", password: PASSWORD });
    const cookie = cookieValue(registerRes);
    const accessToken = registerRes.body.data.accessToken as string;

    const logoutAllRes = await request(app)
      .post(`${api}/auth/logout-all`)
      .set("Authorization", `Bearer ${accessToken}`);
    expect(logoutAllRes.status).toBe(200);

    const refreshAfter = await request(app).post(`${api}/auth/refresh`).set("Cookie", cookie);
    expect(refreshAfter.status).toBe(401);
  });
});

describe("GET /auth/me", () => {
  it("returns safe user data for a valid token", async () => {
    const user = await registerUser("Grace");
    const res = await request(app).get(`${api}/auth/me`).set("Authorization", `Bearer ${user.accessToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.user.id).toBe(user.id);
    expect(res.body.data.user.passwordHash).toBeUndefined();
  });

  it("rejects a missing token", async () => {
    const res = await request(app).get(`${api}/auth/me`);
    expect(res.status).toBe(401);
  });

  it("rejects a garbage token", async () => {
    const res = await request(app).get(`${api}/auth/me`).set("Authorization", "Bearer garbage.token.here");
    expect(res.status).toBe(401);
  });
});
