import { z } from "zod";

export const notificationListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  unreadOnly: z.coerce.boolean().default(false),
});

export const notificationIdParamSchema = z.object({
  notificationId: z.string().uuid("Invalid notification id"),
});

export const notificationTypeParamSchema = z.object({
  notificationType: z.string().trim().min(1).max(100),
});

export const updatePreferenceSchema = z.object({
  inAppEnabled: z.boolean().optional(),
  emailEnabled: z.boolean().optional(),
});

export type NotificationListQuery = z.infer<typeof notificationListQuerySchema>;
export type UpdatePreferenceBody = z.infer<typeof updatePreferenceSchema>;
