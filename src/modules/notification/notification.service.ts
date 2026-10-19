import { AppError } from "../../errors/AppError.js";
import { prisma } from "../../lib/prisma.js";
import { enqueueEmailQuietly } from "../email/email.queue.js";
import { toSafeNotification, toSafePreference, type SafeNotification, type SafeNotificationPreference } from "./notification.mappers.js";

/**
 * The one place a business event becomes notifications. For each recipient it
 * honours their per-type preferences independently for each channel (both
 * default to on): an in-app row, and an email job on the BullMQ queue. Callers
 * decide WHO to notify; recipients are re-checked here to be active members of
 * the organization, so an id from elsewhere can never leak a notification (or
 * an email address) across tenants.
 */
export async function notifyMemberships(input: {
  organizationId: string;
  membershipIds: string[];
  type: string;
  title: string;
  message: string;
  data?: { [key: string]: string };
}): Promise<void> {
  if (input.membershipIds.length === 0) return;

  const recipients = await prisma.membership.findMany({
    where: {
      id: { in: input.membershipIds },
      organizationId: input.organizationId,
      status: "ACTIVE",
      user: { deletedAt: null },
    },
    select: {
      id: true,
      user: { select: { name: true, email: true } },
      notificationPreferences: {
        where: { notificationType: input.type },
        select: { inAppEnabled: true, emailEnabled: true },
      },
    },
  });

  const inApp = recipients.filter((m) => m.notificationPreferences[0]?.inAppEnabled !== false);
  if (inApp.length > 0) {
    await prisma.notification.createMany({
      data: inApp.map((m) => ({
        organizationId: input.organizationId,
        recipientMembershipId: m.id,
        type: input.type,
        title: input.title,
        message: input.message,
        ...(input.data ? { data: input.data } : {}),
      })),
    });
  }

  for (const m of recipients) {
    if (m.notificationPreferences[0]?.emailEnabled === false) continue;
    enqueueEmailQuietly({
      type: "NOTIFICATION",
      to: m.user.email,
      recipientName: m.user.name,
      title: input.title,
      message: input.message,
    });
  }
}

export async function listNotifications(
  membershipId: string,
  page: number,
  limit: number,
  unreadOnly: boolean,
): Promise<{ notifications: SafeNotification[]; pagination: { page: number; limit: number; total: number; totalPages: number } }> {
  const where: Record<string, unknown> = { recipientMembershipId: membershipId };
  if (unreadOnly) where.readAt = null;

  const [notifications, total] = await Promise.all([
    prisma.notification.findMany({ where, orderBy: { createdAt: "desc" }, skip: (page - 1) * limit, take: limit }),
    prisma.notification.count({ where }),
  ]);
  return {
    notifications: notifications.map(toSafeNotification),
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  };
}

export async function markNotificationRead(membershipId: string, notificationId: string): Promise<SafeNotification> {
  const notification = await prisma.notification.findFirst({ where: { id: notificationId, recipientMembershipId: membershipId } });
  if (!notification) {
    throw new AppError("Notification not found", 404);
  }
  const updated = notification.readAt
    ? notification
    : await prisma.notification.update({ where: { id: notificationId }, data: { readAt: new Date() } });
  return toSafeNotification(updated);
}

export async function markAllNotificationsRead(membershipId: string): Promise<void> {
  await prisma.notification.updateMany({
    where: { recipientMembershipId: membershipId, readAt: null },
    data: { readAt: new Date() },
  });
}

export async function listPreferences(membershipId: string): Promise<SafeNotificationPreference[]> {
  const rows = await prisma.notificationPreference.findMany({ where: { membershipId } });
  return rows.map(toSafePreference);
}

export async function upsertPreference(
  membershipId: string,
  notificationType: string,
  input: { inAppEnabled?: boolean | undefined; emailEnabled?: boolean | undefined },
): Promise<SafeNotificationPreference> {
  const pref = await prisma.notificationPreference.upsert({
    where: { membershipId_notificationType: { membershipId, notificationType } },
    create: {
      membershipId,
      notificationType,
      inAppEnabled: input.inAppEnabled ?? true,
      emailEnabled: input.emailEnabled ?? true,
    },
    update: {
      ...(input.inAppEnabled !== undefined ? { inAppEnabled: input.inAppEnabled } : {}),
      ...(input.emailEnabled !== undefined ? { emailEnabled: input.emailEnabled } : {}),
    },
  });
  return toSafePreference(pref);
}
