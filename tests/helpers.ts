import request from "supertest";
import { createApp } from "../src/app/app.js";
import { prisma } from "../src/lib/prisma.js";
import type { MembershipRole } from "../src/generated/prisma/client.js";

export const app = createApp();
export const api = "/api/v1";
export const PASSWORD = "StrongPassword123!";

export async function resetDatabase(): Promise<void> {
  const rows = await prisma.$queryRawUnsafe<{ tablename: string }[]>(
    `SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`,
  );
  if (rows.length === 0) return;
  const list = rows.map((r) => `"${r.tablename}"`).join(", ");
  await prisma.$executeRawUnsafe(`TRUNCATE ${list} CASCADE`);
}

export interface TestUser {
  id: string;
  email: string;
  accessToken: string;
}

let counter = 0;
export async function registerUser(name = "Test User"): Promise<TestUser> {
  counter += 1;
  const email = `user${counter}-${Date.now()}@example.com`;
  const res = await request(app).post(`${api}/auth/register`).send({ name, email, password: PASSWORD });
  if (res.status !== 201) throw new Error(`register failed: ${res.status} ${JSON.stringify(res.body)}`);
  return { id: res.body.data.user.id, email, accessToken: res.body.data.accessToken };
}

export const auth = (u: TestUser) => ({ Authorization: `Bearer ${u.accessToken}` });

export async function createOrg(owner: TestUser, name = "Acme"): Promise<string> {
  const res = await request(app).post(`${api}/organizations`).set(auth(owner)).send({ name });
  if (res.status !== 201) throw new Error(`createOrg failed: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body.data.organization.id as string;
}

export async function addMember(orgId: string, user: TestUser, role: MembershipRole): Promise<string> {
  const m = await prisma.membership.create({ data: { userId: user.id, organizationId: orgId, role } });
  return m.id;
}

export { request, prisma };
