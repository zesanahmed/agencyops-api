import { addMember, api, app, auth, createOrg, prisma, registerUser, request, resetDatabase } from "./helpers.js";
import type { TestUser } from "./helpers.js";

/**
 * One organization with every role, plus an outsider and a second organization.
 * Seeding costs a few bcrypt hashes, so test files seed ONCE (beforeAll) and each
 * test then creates its own projects/tasks/etc. — they never depend on each other.
 */
export interface Workspace {
  owner: TestUser;
  manager: TestUser;
  member: TestUser;
  /** Registered user with no membership anywhere in `orgId`. */
  outsider: TestUser;
  orgId: string;
  ownerMid: string;
  managerMid: string;
  memberMid: string;
  /** A completely separate tenant. */
  other: { owner: TestUser; orgId: string; ownerMid: string };
}

export async function seedWorkspace(): Promise<Workspace> {
  await resetDatabase();
  const [owner, manager, member, outsider, otherOwner] = await Promise.all([
    registerUser("Olivia Owner"),
    registerUser("Manny Manager"),
    registerUser("Maya Member"),
    registerUser("Otto Outsider"),
    registerUser("Other Owner"),
  ]);
  const orgId = await createOrg(owner, "Acme");
  const otherOrgId = await createOrg(otherOwner, "Other Co");
  const midOf = async (organizationId: string, userId: string) =>
    (await prisma.membership.findFirstOrThrow({ where: { organizationId, userId } })).id;
  return {
    owner,
    manager,
    member,
    outsider,
    orgId,
    ownerMid: await midOf(orgId, owner.id),
    managerMid: await addMember(orgId, manager, "MANAGER"),
    memberMid: await addMember(orgId, member, "TEAM_MEMBER"),
    other: { owner: otherOwner, orgId: otherOrgId, ownerMid: await midOf(otherOrgId, otherOwner.id) },
  };
}

let seq = 0;
export const uniq = (): string => `${Date.now().toString(36)}${(seq++).toString(36)}`;

export async function makeProject(organizationId: string, over: Record<string, unknown> = {}) {
  const id = uniq();
  return prisma.project.create({ data: { organizationId, name: `Project ${id}`, slug: `project-${id}`, ...over } as never });
}
export async function makeSprint(projectId: string, over: Record<string, unknown> = {}) {
  return prisma.sprint.create({
    data: { projectId, name: `Sprint ${uniq()}`, startDate: new Date("2026-01-01"), endDate: new Date("2026-01-14"), ...over } as never,
  });
}
export async function makeTask(projectId: string, over: Record<string, unknown> = {}) {
  return prisma.task.create({ data: { projectId, title: `Task ${uniq()}`, ...over } as never });
}
export async function makeTeam(organizationId: string, over: Record<string, unknown> = {}) {
  return prisma.team.create({ data: { organizationId, name: `Team ${uniq()}`, ...over } as never });
}

type Method = "get" | "post" | "patch" | "put" | "delete";
/** `call(user, "post", "/organizations/…", body)`; pass `null` for an unauthenticated request. */
export function call(user: TestUser | null, method: Method, path: string, body?: object) {
  let r = request(app)[method](`${api}${path}`);
  if (user) r = r.set(auth(user));
  return body === undefined ? r : r.send(body);
}
