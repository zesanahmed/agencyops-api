/// <reference types="node" />
import { afterAll, beforeAll, vi } from "vitest";

try {
  process.loadEnvFile(".env.test");
} catch {
  // No .env.test — rely on variables already in the environment (CI).
}

process.env.NODE_ENV = "test";
// A developer's real keys must never change test behaviour (.env is not loaded here,
// but a shell variable could be): email and AI stay unconfigured, OAuth gets fakes.
delete process.env.RESEND_API_KEY;
process.env.GOOGLE_CLIENT_ID = "google-test-client";
process.env.GOOGLE_CLIENT_SECRET = "google-test-secret";
process.env.GITHUB_CLIENT_ID = "github-test-client";
process.env.GITHUB_CLIENT_SECRET = "github-test-secret";
process.env.API_PUBLIC_URL = "http://api.test";
process.env.FRONTEND_URL = "http://web.test";
process.env.JWT_ACCESS_SECRET ??= "test-access-secret-not-for-production";
process.env.STRIPE_SECRET_KEY ??= "sk_test_dummy";
process.env.STRIPE_WEBHOOK_SECRET ??= "whsec_test_secret";
process.env.STRIPE_PRO_PRICE_ID ??= "price_pro_test";
process.env.JWT_REFRESH_SECRET ??= "test-refresh-secret-not-for-production";

const dbUrl = process.env.DATABASE_URL ?? "";
const dbName = dbUrl.split("?")[0]?.split("/").pop() ?? "";
if (!/test/i.test(dbName)) {
  throw new Error(
    `Refusing to run tests: DATABASE_URL database name "${dbName}" does not contain "test". ` +
      `Create a separate test database and set DATABASE_URL in .env.test.`,
  );
}

// No test may open a Redis connection: mail is recorded, never queued. Individual
// tests import the mocked functions to assert on what would have been sent.
vi.mock("../src/modules/email/email.queue.js", () => ({
  EMAIL_QUEUE: "email",
  enqueueEmail: vi.fn(),
  enqueueEmailQuietly: vi.fn(),
}));

beforeAll(() => {
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

afterAll(() => {
  vi.restoreAllMocks();
});
