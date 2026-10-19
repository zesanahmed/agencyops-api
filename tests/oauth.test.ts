import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, app, PASSWORD, prisma, request, resetDatabase } from "./helpers.js";
import { env } from "../src/config/env.js";

const WEB = "http://web.test";

interface FakeProvider {
  token?: { ok: boolean; body?: object };
  google?: object;
  githubUser?: object;
  githubEmails?: object[];
}
let provider: FakeProvider;
let tokenRequests: URLSearchParams[];

function stubProviders() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input instanceof Request ? input.url : input);
      const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
      if (url === "https://oauth2.googleapis.com/token" || url === "https://github.com/login/oauth/access_token") {
        tokenRequests.push(new URLSearchParams(String(init?.body)));
        const t = provider.token ?? { ok: true };
        return t.ok ? json(t.body ?? { access_token: "provider-access-token" }) : json({ error: "bad_verification_code" }, 400);
      }
      if (url === "https://openidconnect.googleapis.com/v1/userinfo") return json(provider.google ?? {});
      if (url === "https://api.github.com/user") return json(provider.githubUser ?? {});
      if (url === "https://api.github.com/user/emails") return json(provider.githubEmails ?? []);
      throw new Error(`unexpected fetch ${url}`);
    }),
  );
}

/** Runs the whole browser dance: begin → (provider) → callback. Returns the callback response. */
async function signInWith(
  providerId: "google" | "github",
  opts: { code?: string; state?: "valid" | "wrong" | "missing"; cookie?: "keep" | "drop"; providerError?: string } = {},
) {
  const begin = await request(app).get(`${api}/auth/oauth/${providerId}`);
  expect(begin.status).toBe(302);
  const authorize = new URL(begin.headers.location as string);
  const cookie = (begin.headers["set-cookie"] as unknown as string[])[0]!.split(";")[0]!;
  const state = opts.state === "wrong" ? "tampered" : opts.state === "missing" ? undefined : authorize.searchParams.get("state")!;

  const query = new URLSearchParams();
  if (opts.providerError) query.set("error", opts.providerError);
  else query.set("code", opts.code ?? "auth-code");
  if (state) query.set("state", state);

  const req = request(app).get(`${api}/auth/oauth/${providerId}/callback?${query.toString()}`);
  if (opts.cookie !== "drop") req.set("Cookie", cookie);
  return req;
}

const locationOf = (res: { headers: Record<string, unknown> }) => new URL(res.headers["location"] as string);
const googleProfile = (over: object = {}) => ({ sub: "g-123", email: "Grace@Example.com", email_verified: true, name: "Grace Hopper", picture: "https://pic.test/g.png", ...over });

beforeEach(async () => {
  await resetDatabase();
  provider = {};
  tokenRequests = [];
  stubProviders();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("starting the flow", () => {
  it("redirects to the provider with state and PKCE, and binds the browser with an HttpOnly cookie", async () => {
    const res = await request(app).get(`${api}/auth/oauth/google`);
    expect(res.status).toBe(302);
    const url = new URL(res.headers.location as string);
    expect(url.origin + url.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(url.searchParams.get("client_id")).toBe("google-test-client");
    expect(url.searchParams.get("redirect_uri")).toBe("http://api.test/api/v1/auth/oauth/google/callback");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("state")!.length).toBeGreaterThanOrEqual(32);
    expect(url.searchParams.get("code_challenge")).toBeTruthy();
    expect(res.headers.location).not.toContain("google-test-secret");

    const cookie = (res.headers["set-cookie"] as unknown as string[])[0]!;
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
    expect(cookie).toContain("Path=/api/v1/auth/oauth");
  });

  it("uses a fresh state every time, rejects unknown providers, and 503s when a provider is not configured", async () => {
    const a = new URL((await request(app).get(`${api}/auth/oauth/github`)).headers.location as string);
    const b = new URL((await request(app).get(`${api}/auth/oauth/github`)).headers.location as string);
    expect(a.searchParams.get("state")).not.toBe(b.searchParams.get("state"));

    expect((await request(app).get(`${api}/auth/oauth/facebook`)).status).toBe(400);

    const saved = env.oauth.google;
    env.oauth.google = undefined;
    try {
      expect((await request(app).get(`${api}/auth/oauth/google`)).status).toBe(503);
    } finally {
      env.oauth.google = saved;
    }
  });
});

describe("Google callback", () => {
  it("creates a verified passwordless user, sends the code verifier, and opens a normal session", async () => {
    provider.google = googleProfile();
    const res = await signInWith("google");

    expect(res.status).toBe(302);
    expect(locationOf(res).origin + locationOf(res).pathname).toBe(`${WEB}/oauth/callback`);
    expect(locationOf(res).searchParams.get("error")).toBeNull();

    const user = await prisma.user.findFirstOrThrow({ where: { email: "grace@example.com" }, include: { accounts: true } });
    expect(user.passwordHash).toBeNull();
    expect(user.emailVerifiedAt).not.toBeNull();
    expect(user.name).toBe("Grace Hopper");
    expect(user.accounts).toMatchObject([{ provider: "GOOGLE", providerAccountId: "g-123" }]);

    // PKCE verifier and client secret went to the token endpoint, not to the browser.
    expect(tokenRequests[0]!.get("code_verifier")!.length).toBeGreaterThanOrEqual(43);
    expect(tokenRequests[0]!.get("client_secret")).toBe("google-test-secret");
    expect(tokenRequests[0]!.get("redirect_uri")).toBe("http://api.test/api/v1/auth/oauth/google/callback");

    const cookies = res.headers["set-cookie"] as unknown as string[];
    const refreshCookie = cookies.find((c) => c.startsWith(`${env.refreshCookie.name}=`))!;
    expect(refreshCookie).toMatch(/HttpOnly/i);
    const refreshed = await request(app).post(`${api}/auth/refresh`).set("Cookie", refreshCookie.split(";")[0]!);
    expect(refreshed.status).toBe(200);
    const me = await request(app).get(`${api}/auth/me`).set("Authorization", `Bearer ${refreshed.body.data.accessToken}`);
    expect(me.body.data.user.email).toBe("grace@example.com");

    // The state cookie is cleared after one use.
    expect(cookies.some((c) => c.startsWith(`${env.refreshCookie.name}_oauth=;`))).toBe(true);
    // And the user cannot password-login (no password exists).
    expect((await request(app).post(`${api}/auth/login`).send({ email: "grace@example.com", password: PASSWORD })).status).toBe(401);
  });

  it("recognises a returning user by provider id even when their provider email changed", async () => {
    provider.google = googleProfile();
    await signInWith("google");
    provider.google = googleProfile({ email: "grace.new@example.com" });
    const res = await signInWith("google");

    expect(locationOf(res).searchParams.get("error")).toBeNull();
    expect(await prisma.user.count()).toBe(1);
    expect(await prisma.account.count()).toBe(1);
  });

  it("links to an existing verified account without touching its password", async () => {
    const reg = await request(app).post(`${api}/auth/register`).send({ name: "Grace", email: "grace@example.com", password: PASSWORD });
    await prisma.user.update({ where: { id: reg.body.data.user.id }, data: { emailVerifiedAt: new Date() } });

    provider.google = googleProfile();
    expect(locationOf(await signInWith("google")).searchParams.get("error")).toBeNull();

    expect(await prisma.user.count()).toBe(1);
    expect(await prisma.account.count({ where: { userId: reg.body.data.user.id } })).toBe(1);
    expect((await request(app).post(`${api}/auth/login`).send({ email: "grace@example.com", password: PASSWORD })).status).toBe(200);
  });

  it("defeats pre-hijacking: an unverified password account loses its unproven password and sessions when the real owner signs in", async () => {
    // Attacker registers the victim's address in advance and keeps a live session.
    const attacker = await request(app).post(`${api}/auth/register`).send({ name: "Mallory", email: "grace@example.com", password: PASSWORD });
    const attackerCookie = (attacker.headers["set-cookie"] as unknown as string[])[0]!.split(";")[0]!;

    // The real owner signs in with Google, which vouches for the address.
    provider.google = googleProfile();
    expect(locationOf(await signInWith("google")).searchParams.get("error")).toBeNull();

    const user = await prisma.user.findUniqueOrThrow({ where: { id: attacker.body.data.user.id } });
    expect(user.passwordHash).toBeNull();
    expect(user.emailVerifiedAt).not.toBeNull();
    expect((await request(app).post(`${api}/auth/login`).send({ email: "grace@example.com", password: PASSWORD })).status).toBe(401);
    expect((await request(app).post(`${api}/auth/refresh`).set("Cookie", attackerCookie)).status).toBe(401);
  });

  it("never links or creates anything when the provider does not vouch for the email", async () => {
    await request(app).post(`${api}/auth/register`).send({ name: "Victim", email: "grace@example.com", password: PASSWORD });

    provider.google = googleProfile({ email_verified: false });
    const unverified = await signInWith("google");
    expect(locationOf(unverified).searchParams.get("error")).toBe("email_not_verified");
    expect(unverified.headers["set-cookie"]).not.toEqual(expect.arrayContaining([expect.stringContaining(`${env.refreshCookie.name}=ey`)]));

    provider.google = googleProfile({ sub: "g-999", email: undefined });
    expect(locationOf(await signInWith("google")).searchParams.get("error")).toBe("email_not_verified");

    expect(await prisma.account.count()).toBe(0);
    expect(await prisma.user.count()).toBe(1);
  });

  it("refuses suspended and deleted accounts", async () => {
    provider.google = googleProfile();
    await signInWith("google");
    const user = await prisma.user.findFirstOrThrow({ where: { email: "grace@example.com" } });

    await prisma.user.update({ where: { id: user.id }, data: { status: "SUSPENDED" } });
    expect(locationOf(await signInWith("google")).searchParams.get("error")).toBe("account_disabled");

    await prisma.user.update({ where: { id: user.id }, data: { status: "ACTIVE", deletedAt: new Date() } });
    expect(locationOf(await signInWith("google")).searchParams.get("error")).toBe("account_disabled");
  });
});

describe("callback integrity", () => {
  it("rejects a missing, wrong or cookie-less state and never calls the provider", async () => {
    provider.google = googleProfile();
    for (const opts of [{ state: "wrong" as const }, { state: "missing" as const }, { cookie: "drop" as const }]) {
      const res = await signInWith("google", opts);
      expect(locationOf(res).searchParams.get("error")).toBe("invalid_state");
    }
    expect(tokenRequests).toHaveLength(0);
    expect(await prisma.user.count()).toBe(0);
  });

  it("rejects a state cookie that was issued for a different provider", async () => {
    const begin = await request(app).get(`${api}/auth/oauth/github`);
    const cookie = (begin.headers["set-cookie"] as unknown as string[])[0]!.split(";")[0]!;
    const state = new URL(begin.headers.location as string).searchParams.get("state")!;
    const res = await request(app).get(`${api}/auth/oauth/google/callback?code=x&state=${state}`).set("Cookie", cookie);
    expect(locationOf(res).searchParams.get("error")).toBe("invalid_state");
  });

  it("maps a denied consent screen and a failed code exchange to fixed error codes", async () => {
    expect(locationOf(await signInWith("google", { providerError: "access_denied" })).searchParams.get("error")).toBe("access_denied");

    provider.token = { ok: false };
    const failed = await signInWith("google");
    expect(locationOf(failed).searchParams.get("error")).toBe("oauth_failed");
    expect(failed.headers.location).not.toContain("bad_verification_code");

    provider.token = { ok: true, body: {} };
    expect(locationOf(await signInWith("google")).searchParams.get("error")).toBe("oauth_failed");
    expect(await prisma.user.count()).toBe(0);
  });

  it("a state cookie works for one attempt only", async () => {
    provider.google = googleProfile();
    const begin = await request(app).get(`${api}/auth/oauth/google`);
    const cookie = (begin.headers["set-cookie"] as unknown as string[])[0]!.split(";")[0]!;
    const state = new URL(begin.headers.location as string).searchParams.get("state")!;
    const url = `${api}/auth/oauth/google/callback?code=c&state=${state}`;

    expect(locationOf(await request(app).get(url).set("Cookie", cookie)).searchParams.get("error")).toBeNull();
    // The browser deleted the cookie after the first callback; replaying the URL without it fails.
    expect(locationOf(await request(app).get(url)).searchParams.get("error")).toBe("invalid_state");
  });
});

describe("GitHub callback", () => {
  it("trusts only the primary verified address from /user/emails, never the public profile email", async () => {
    provider.githubUser = { id: 4242, login: "octo", name: null, avatar_url: "https://pic.test/o.png", email: "public@example.com" };
    provider.githubEmails = [
      { email: "unverified@example.com", primary: false, verified: false },
      { email: "Other@Example.com", primary: false, verified: true },
      { email: "Octo@Example.com", primary: true, verified: true },
    ];
    const res = await signInWith("github");
    expect(locationOf(res).searchParams.get("error")).toBeNull();

    const user = await prisma.user.findFirstOrThrow({ include: { accounts: true } });
    expect(user.email).toBe("octo@example.com");
    expect(user.name).toBe("octo"); // falls back to the login
    expect(user.accounts).toMatchObject([{ provider: "GITHUB", providerAccountId: "4242" }]);
  });

  it("rejects an account that has no verified email at all", async () => {
    provider.githubUser = { id: 7, login: "ghost", email: "public@example.com" };
    provider.githubEmails = [{ email: "public@example.com", primary: true, verified: false }];
    expect(locationOf(await signInWith("github")).searchParams.get("error")).toBe("email_not_verified");
    expect(await prisma.user.count()).toBe(0);
  });
});
