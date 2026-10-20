import express from "express";
import { afterEach, describe, expect, it, vi } from "vitest";
import { env } from "../src/config/env.js";
import { apiRateLimiter, costlyActionRateLimiter } from "../src/middlewares/rateLimit.js";
import { errorHandler } from "../src/middlewares/errorHandler.js";
import { api, app, request } from "./helpers.js";

// The limiters are switched off under NODE_ENV=test; these tests turn them on for their own tiny app.
const mutableEnv = env as unknown as { nodeEnv: string; isProduction: boolean };
const original = { nodeEnv: mutableEnv.nodeEnv, isProduction: mutableEnv.isProduction };
afterEach(() => {
  mutableEnv.nodeEnv = original.nodeEnv;
  mutableEnv.isProduction = original.isProduction;
  vi.restoreAllMocks();
});

describe("request parsing errors", () => {
  it("malformed JSON is a 400 in the standard envelope, not a 500", async () => {
    const res = await request(app).post(`${api}/auth/login`).set("Content-Type", "application/json").send("{ not json");
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ success: false, message: "Request body is not valid JSON", errors: [] });
  });

  it("an oversized body is a 413", async () => {
    const res = await request(app)
      .post(`${api}/auth/login`)
      .send({ email: "a@example.com", password: "x".repeat(200_000) });
    expect(res.status).toBe(413);
    expect(res.body.success).toBe(false);
  });
});

describe("error handler", () => {
  function run(err: unknown) {
    const json = vi.fn();
    const res = { status: vi.fn(() => ({ json })) };
    errorHandler(err, {} as never, res as never, vi.fn());
    return { status: res.status.mock.calls[0]?.[0], body: json.mock.calls[0]?.[0] };
  }

  it("answers unexpected errors with a generic 500 and logs them even in production", () => {
    mutableEnv.isProduction = true;
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const out = run(new Error("db exploded"));
    expect(out).toEqual({ status: 500, body: { success: false, message: "Something went wrong", errors: [] } });
    expect(log).toHaveBeenCalledOnce();
    expect(String(log.mock.calls[0]?.[1])).toContain("db exploded");
  });

  it("never logs Prisma error messages in production (they can embed query arguments)", () => {
    mutableEnv.isProduction = true;
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const err = Object.assign(new Error("Invalid invocation: passwordHash: $2b$12$secret"), { code: "P2002" });
    err.name = "PrismaClientKnownRequestError";
    run(err);
    const logged = String(log.mock.calls[0]?.[1]);
    expect(logged).toBe("PrismaClientKnownRequestError (P2002)");
    expect(logged).not.toContain("secret");
  });

  it("does not log client mistakes such as AppErrors", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await request(app).get(`${api}/organizations`); // 401
    expect(log).not.toHaveBeenCalled();
  });
});

describe("rate limiting", () => {
  function limitedApp(...limiters: express.RequestHandler[]) {
    mutableEnv.nodeEnv = "production";
    const a = express();
    a.use((req, _res, next) => {
      const uid = req.header("x-test-user");
      if (uid) req.auth = { userId: uid, sessionId: "s" };
      next();
    });
    a.use(...limiters);
    a.get("/health", (_req, res) => void res.json({ ok: true }));
    a.get("/thing", (_req, res) => void res.json({ ok: true }));
    a.use(errorHandler);
    return a;
  }

  it("costly actions: 30 per minute per user, then 429 in the standard envelope; other users unaffected", async () => {
    const a = limitedApp(costlyActionRateLimiter);
    for (let i = 0; i < 30; i++) {
      expect((await request(a).get("/thing").set("x-test-user", "alice")).status).toBe(200);
    }
    const blocked = await request(a).get("/thing").set("x-test-user", "alice");
    expect(blocked.status).toBe(429);
    expect(blocked.body).toMatchObject({ success: false });
    expect((await request(a).get("/thing").set("x-test-user", "bob")).status).toBe(200);
  });

  it("general API limiter: blocks after 1000 requests but never health checks", async () => {
    const a = limitedApp(apiRateLimiter);
    const agent = request(a);
    for (let i = 0; i < 1000; i++) await agent.get("/thing");
    expect((await agent.get("/thing")).status).toBe(429);
    expect((await agent.get("/health")).status).toBe(200);
  }, 60_000);
});

describe("trust proxy", () => {
  it("is off by default and configurable via TRUST_PROXY", async () => {
    expect(env.trustProxy).toBe(false);
    for (const [value, expected] of [["1", 1], ["true", true], ["loopback", "loopback"], ["false", false]] as const) {
      vi.resetModules();
      vi.stubEnv("TRUST_PROXY", value);
      const fresh = await import("../src/config/env.js");
      expect(fresh.env.trustProxy).toBe(expected);
    }
    vi.unstubAllEnvs();
  });
});
