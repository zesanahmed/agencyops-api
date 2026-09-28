import type { Notification, NotificationPreference } from "../../generated/prisma/client.js";
import type { JsonValue } from "../../types/api-response.js";

export interface SafeNotification {
  id: string;
  organizationId: string;
  recipientMembershipId: string;
  type: string;
  title: string;
  message: string;
  readAt: string | null;
  createdAt: string;
  [key: string]: JsonValue;
}

export function toSafeNotification(n: Notification): SafeNotification {
  return {
    id: n.id,
    organizationId: n.organizationId,
    recipientMembershipId: n.recipientMembershipId,
    type: n.type,
    title: n.title,
    message: n.message,
    readAt: n.readAt ? n.readAt.toISOString() : null,
    createdAt: n.createdAt.toISOString(),
  };
}

export interface SafeNotificationPreference {
  id: string;
  membershipId: string;
  notificationType: string;
  inAppEnabled: boolean;
  emailEnabled: boolean;
  [key: string]: JsonValue;
}

export function toSafePreference(p: NotificationPreference): SafeNotificationPreference {
  return {
    id: p.id,
    membershipId: p.membershipId,
    notificationType: p.notificationType,
    inAppEnabled: p.inAppEnabled,
    emailEnabled: p.emailEnabled,
  };
}
