import { AppError } from "../../errors/AppError.js";
import { prisma } from "../../lib/prisma.js";
import { toSafeNotification, toSafePreference, type SafeNotification, type SafeNotificationPreference } from "./notification.mappers.js";

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
