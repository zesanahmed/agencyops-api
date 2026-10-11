import { prisma } from "../../lib/prisma.js";

export interface AuditInput {
  organizationId: string;
  actorMembershipId: string | null;
  action: string;
  entityType: string;
  entityId: string;
  metadata?: Record<string, string | number | boolean | null> | undefined;
  ipAddress?: string | null | undefined;
  userAgent?: string | null | undefined;
}

/**
 * Appends an audit record. Append-only by design: there is no update
 * or delete path for AuditLog anywhere in the application. Kept
 * deliberately small — the full Activity/Audit event pipeline is a
 * later milestone; security-sensitive operations (e.g. client access
 * changes) call this directly in the meantime.
 */
export async function recordAuditLog(input: AuditInput): Promise<void> {
  await prisma.auditLog.create({
    data: {
      organizationId: input.organizationId,
      actorMembershipId: input.actorMembershipId,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      ...(input.metadata ? { metadata: input.metadata } : {}),
      ipAddress: input.ipAddress ?? null,
      userAgent: input.userAgent ?? null,
    },
  });
}
