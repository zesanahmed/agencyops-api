import { prisma } from "./prisma.js";

/** Display fields of a user. Nothing sensitive (no password hash, status, tokens). */
export type UserInfo = { id: string; name: string; email: string; avatarUrl: string | null };

/** `{ membershipId, user }` — how a person is referenced where only a membership id used to be. */
export type MemberRef = { membershipId: string; user: UserInfo };

/**
 * Resolves many membership ids to their user's display info in ONE query (no N+1).
 * Callers pass ids taken from rows they already loaded inside the organization, so
 * this never widens access.
 */
export async function loadMembershipUsers(ids: Iterable<string | null | undefined>): Promise<Map<string, UserInfo>> {
  const unique = [...new Set([...ids].filter((id): id is string => typeof id === "string"))];
  const map = new Map<string, UserInfo>();
  if (unique.length === 0) return map;
  const rows = await prisma.membership.findMany({
    where: { id: { in: unique } },
    select: { id: true, user: { select: { id: true, name: true, email: true, avatarUrl: true } } },
  });
  for (const row of rows) map.set(row.id, row.user);
  return map;
}

export function memberRef(map: Map<string, UserInfo>, membershipId: string | null): MemberRef | null {
  if (!membershipId) return null;
  const user = map.get(membershipId);
  return user ? { membershipId, user } : null;
}
