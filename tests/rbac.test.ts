import { beforeAll, describe, expect, it } from "vitest";
import { call, seedWorkspace, type Workspace } from "./fixtures.js";

/**
 * Table-driven guard check across every org-scoped module. Per-module files test the
 * business rules; this one makes sure no route family is ever left unauthenticated,
 * reachable by non-members, or open to a role that lacks its permission.
 */
let w: Workspace;
beforeAll(async () => {
  w = await seedWorkspace();
}, 60_000);

const ID = "00000000-0000-4000-8000-000000000001";
type Method = "get" | "post" | "patch" | "put" | "delete";
type Route = [method: Method, path: (org: string) => string, body?: object];

const ORG_ROUTES: Route[] = [
  ["get", (o) => `/organizations/${o}`],
  ["patch", (o) => `/organizations/${o}`, { name: "Renamed" }],
  ["delete", (o) => `/organizations/${o}`],
  ["get", (o) => `/organizations/${o}/members`],
  ["get", (o) => `/organizations/${o}/invitations`],
  ["post", (o) => `/organizations/${o}/invitations`, { email: "x@example.com", role: "MANAGER" }],
  ["get", (o) => `/organizations/${o}/teams`],
  ["post", (o) => `/organizations/${o}/teams`, { name: "T" }],
  ["delete", (o) => `/organizations/${o}/teams/${ID}`],
  ["get", (o) => `/organizations/${o}/projects`],
  ["post", (o) => `/organizations/${o}/projects`, { name: "P" }],
  ["get", (o) => `/organizations/${o}/projects/${ID}/sprints`],
  ["post", (o) => `/organizations/${o}/projects/${ID}/sprints`, { name: "S", startDate: "2026-01-01", endDate: "2026-01-02" }],
  ["get", (o) => `/organizations/${o}/projects/${ID}/tasks`],
  ["post", (o) => `/organizations/${o}/projects/${ID}/tasks`, { title: "T" }],
  ["get", (o) => `/organizations/${o}/projects/${ID}/tasks/${ID}/comments`],
  ["get", (o) => `/organizations/${o}/projects/${ID}/tasks/${ID}/attachments`],
  ["get", (o) => `/organizations/${o}/notifications`],
  ["get", (o) => `/organizations/${o}/clients`],
  ["post", (o) => `/organizations/${o}/clients`, { name: "Client Co" }],
  ["get", (o) => `/organizations/${o}/invoices`],
  ["post", (o) => `/organizations/${o}/invoices`, {}],
  ["get", (o) => `/organizations/${o}/billing`],
  ["post", (o) => `/organizations/${o}/billing/checkout`, {}],
];

describe("every org-scoped route", () => {
  it.each(ORG_ROUTES)("%s requires a token (401)", async (method, path, body) => {
    expect((await call(null, method, path(w.orgId), body)).status).toBe(401);
  });

  it.each(ORG_ROUTES)("%s hides the organization from non-members (404)", async (method, path, body) => {
    expect((await call(w.outsider, method, path(w.orgId), body)).status).toBe(404);
    expect((await call(w.owner, method, path(w.other.orgId), body)).status).toBe(404); // owner of ANOTHER org
  });
});

describe("role gates", () => {
  const FORBIDDEN_FOR_MEMBER: Route[] = [
    ["delete", (o) => `/organizations/${o}`],
    ["patch", (o) => `/organizations/${o}`, { name: "Renamed" }],
    ["get", (o) => `/organizations/${o}/invitations`],
    ["post", (o) => `/organizations/${o}/invitations`, { email: "x@example.com", role: "MANAGER" }],
    ["post", (o) => `/organizations/${o}/teams`, { name: "T" }],
    ["delete", (o) => `/organizations/${o}/teams/${ID}`],
    ["post", (o) => `/organizations/${o}/projects`, { name: "P" }],
    ["post", (o) => `/organizations/${o}/projects/${ID}/sprints`, { name: "S", startDate: "2026-01-01", endDate: "2026-01-02" }],
    ["delete", (o) => `/organizations/${o}/projects/${ID}/tasks/${ID}`],
    ["post", (o) => `/organizations/${o}/clients`, { name: "Client Co" }],
    ["get", (o) => `/organizations/${o}/invoices`],
    ["post", (o) => `/organizations/${o}/invoices`, {}],
    ["get", (o) => `/organizations/${o}/billing`],
    ["post", (o) => `/organizations/${o}/billing/checkout`, {}],
  ];

  it.each(FORBIDDEN_FOR_MEMBER)("TEAM_MEMBER is refused on %s (403)", async (method, path, body) => {
    const r = await call(w.member, method, path(w.orgId), body);
    expect(r.status, `${method} ${path("ORG")} ${JSON.stringify(r.body)}`).toBe(403);
  });

  const FORBIDDEN_FOR_MANAGER: Route[] = [
    ["delete", (o) => `/organizations/${o}`],
    ["post", (o) => `/organizations/${o}/billing/checkout`, {}],
  ];

  it.each(FORBIDDEN_FOR_MANAGER)("MANAGER is refused on owner-only %s (403)", async (method, path, body) => {
    expect((await call(w.manager, method, path(w.orgId), body)).status).toBe(403);
  });
});
