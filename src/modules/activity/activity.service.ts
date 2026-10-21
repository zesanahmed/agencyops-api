import { Prisma } from "../../generated/prisma/client.js";
import { prisma } from "../../lib/prisma.js";
import { loadMembershipUsers } from "../../lib/userInfo.js";
import type { JsonValue } from "../../types/api-response.js";

export type ActivityAction =
  | "project.created"
  | "project.updated"
  | "project.deleted"
  | "sprint.created"
  | "sprint.updated"
  | "sprint.started"
  | "sprint.completed"
  | "sprint.deleted"
  | "task.created"
  | "task.updated"
  | "task.status_changed"
  | "task.assigned"
  | "task.deleted"
  | "comment.added"
  | "member.joined"
  | "member.removed";

export type ActivityEntityType = "Project" | "Sprint" | "Task" | "Comment" | "Membership";

/** Only short, non-sensitive facts: titles, statuses, ids of people. Never bodies or secrets. */
export type ActivityMetadata = { [key: string]: string | number | boolean | null };

export interface RecordActivityInput {
  organizationId: string;
  actorMembershipId: string | null;
  action: ActivityAction;
  entityType: ActivityEntityType;
  entityId: string;
  projectId?: string | null;
  taskId?: string | null;
  metadata?: ActivityMetadata;
  /** Only for backdating demo/seed data; real events use the database default (now). */
  createdAt?: Date;
}

/**
 * Appends an entry to the activity feed. Best effort by design: the feed is a convenience,
 * so a failure here must never roll back or fail the business action that triggered it.
 */
export async function recordActivity(input: RecordActivityInput): Promise<void> {
  try {
    await prisma.activity.create({
      data: {
        organizationId: input.organizationId,
        actorMembershipId: input.actorMembershipId,
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId,
        projectId: input.projectId ?? null,
        taskId: input.taskId ?? null,
        ...(input.metadata ? { metadata: input.metadata } : {}),
        ...(input.createdAt ? { createdAt: input.createdAt } : {}),
      },
    });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("[agencyops-api] activity record failed:", error instanceof Error ? error.name : "unknown");
  }
}

export interface ActivityListQuery {
  page: number;
  limit: number;
  projectId?: string | undefined;
  taskId?: string | undefined;
  actorMembershipId?: string | undefined;
  entityType?: string | undefined;
}

export type SafeActivity = {
  id: string;
  action: string;
  entityType: string;
  entityId: string;
  projectId: string | null;
  taskId: string | null;
  actor: { membershipId: string; name: string } | null;
  summary: string;
  metadata: JsonValue;
  createdAt: string;
};

/**
 * `visibleProjectIds` = null means "everything in the organization" (OWNER/MANAGER).
 * Otherwise only entries of those projects are returned (TEAM_MEMBER); organization-level
 * entries (no project) are then hidden.
 */
export async function listActivity(
  organizationId: string,
  query: ActivityListQuery,
  visibleProjectIds: string[] | null,
): Promise<{ activities: SafeActivity[]; pagination: { page: number; limit: number; total: number; totalPages: number } }> {
  const where: Prisma.ActivityWhereInput = { organizationId };
  if (visibleProjectIds) where.projectId = { in: visibleProjectIds };
  if (query.projectId) {
    // Intersect with what the caller may see; a project outside the set yields an empty page.
    where.projectId = visibleProjectIds && !visibleProjectIds.includes(query.projectId) ? { in: [] } : query.projectId;
  }
  if (query.taskId) where.taskId = query.taskId;
  if (query.actorMembershipId) where.actorMembershipId = query.actorMembershipId;
  if (query.entityType) where.entityType = query.entityType;

  const [rows, total] = await Promise.all([
    prisma.activity.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: (query.page - 1) * query.limit,
      take: query.limit,
    }),
    prisma.activity.count({ where }),
  ]);

  const metaOf = (m: Prisma.JsonValue | null): ActivityMetadata =>
    m && typeof m === "object" && !Array.isArray(m) ? (m as ActivityMetadata) : {};
  const users = await loadMembershipUsers(
    rows.flatMap((r) => [r.actorMembershipId, stringOrNull(metaOf(r.metadata).assigneeMembershipId), stringOrNull(metaOf(r.metadata).memberMembershipId)]),
  );

  const activities = rows.map<SafeActivity>((r) => {
    const metadata = metaOf(r.metadata);
    const actorName = r.actorMembershipId ? users.get(r.actorMembershipId)?.name : undefined;
    return {
      id: r.id,
      action: r.action,
      entityType: r.entityType,
      entityId: r.entityId,
      projectId: r.projectId,
      taskId: r.taskId,
      actor: r.actorMembershipId && actorName ? { membershipId: r.actorMembershipId, name: actorName } : null,
      summary: buildSummary(r.action, actorName ?? "Someone", metadata, {
        assignee: users.get(stringOrNull(metadata.assigneeMembershipId) ?? "")?.name,
        member: users.get(stringOrNull(metadata.memberMembershipId) ?? "")?.name,
      }),
      metadata: r.metadata === null ? null : (r.metadata as JsonValue),
      createdAt: r.createdAt.toISOString(),
    };
  });

  return { activities, pagination: { page: query.page, limit: query.limit, total, totalPages: Math.ceil(total / query.limit) } };
}

const stringOrNull = (v: unknown): string | null => (typeof v === "string" ? v : null);

const STATUS_LABEL: Record<string, string> = {
  BACKLOG: "Backlog",
  TODO: "To do",
  IN_PROGRESS: "In progress",
  IN_REVIEW: "In review",
  DONE: "Done",
};
const label = (s: unknown): string => (typeof s === "string" ? (STATUS_LABEL[s] ?? s) : "?");

function buildSummary(
  action: string,
  actor: string,
  m: ActivityMetadata,
  names: { assignee: string | undefined; member: string | undefined },
): string {
  const title = typeof m.title === "string" ? `“${m.title}”` : "an item";
  switch (action) {
    case "project.created": return `${actor} created project ${title}`;
    case "project.updated": return `${actor} updated project ${title}`;
    case "project.deleted": return `${actor} deleted project ${title}`;
    case "sprint.created": return `${actor} created sprint ${title}`;
    case "sprint.updated": return `${actor} updated sprint ${title}`;
    case "sprint.started": return `${actor} started sprint ${title}`;
    case "sprint.completed": return `${actor} completed sprint ${title}`;
    case "sprint.deleted": return `${actor} deleted sprint ${title}`;
    case "task.created": return m.parentTaskId ? `${actor} added subtask ${title}` : `${actor} created task ${title}`;
    case "task.updated": return `${actor} updated task ${title}`;
    case "task.status_changed": return `${actor} moved ${title} from ${label(m.from)} to ${label(m.to)}`;
    case "task.assigned":
      return names.assignee ? `${actor} assigned ${title} to ${names.assignee}` : `${actor} unassigned ${title}`;
    case "task.deleted": return `${actor} deleted task ${title}`;
    case "comment.added": return `${actor} commented on ${title}`;
    case "member.joined": return `${names.member ?? actor} joined the organization`;
    case "member.removed": return `${actor} removed ${names.member ?? "a member"} from the organization`;
    default: return `${actor} performed ${action}`;
  }
}
