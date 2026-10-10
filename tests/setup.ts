/// <reference types="node" />
import { afterAll, beforeAll, vi } from "vitest";

try {
  process.loadEnvFile(".env.test");
} catch {
  // No .env.test — rely on variables already in the environment (CI).
}

process.env.NODE_ENV = "test";
process.env.JWT_ACCESS_SECRET ??= "test-access-secret-not-for-production";
process.env.JWT_REFRESH_SECRET ??= "test-refresh-secret-not-for-production";

const dbUrl = process.env.DATABASE_URL ?? "";
const dbName = dbUrl.split("?")[0]?.split("/").pop() ?? "";
if (!/test/i.test(dbName)) {
  throw new Error(
    `Refusing to run tests: DATABASE_URL database name "${dbName}" does not contain "test". ` +
      `Create a separate test database and set DATABASE_URL in .env.test.`,
  );
}

beforeAll(() => {
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

afterAll(() => {
  vi.restoreAllMocks();
});
