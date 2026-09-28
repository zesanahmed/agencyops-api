import type { Request, Response } from "express";
import { sendSuccess } from "../../lib/apiResponse.js";
import {
  listNotifications,
  listPreferences,
  markAllNotificationsRead,
  markNotificationRead,
  upsertPreference,
} from "./notification.service.js";
import type { NotificationListQuery, UpdatePreferenceBody } from "./notification.validation.js";

export async function list(req: Request, res: Response): Promise<void> {
  const { page, limit, unreadOnly } = req.query as unknown as NotificationListQuery;
  const result = await listNotifications(req.orgContext!.membership.id, page, limit, unreadOnly);
  sendSuccess(res, result, "Notifications retrieved successfully");
}

export async function markRead(req: Request, res: Response): Promise<void> {
  const { notificationId } = req.params as { notificationId: string };
  const notification = await markNotificationRead(req.orgContext!.membership.id, notificationId);
  sendSuccess(res, { notification }, "Notification marked as read");
}

export async function markAllRead(req: Request, res: Response): Promise<void> {
  await markAllNotificationsRead(req.orgContext!.membership.id);
  sendSuccess(res, null, "All notifications marked as read");
}

export async function listPreferencesHandler(req: Request, res: Response): Promise<void> {
  const preferences = await listPreferences(req.orgContext!.membership.id);
  sendSuccess(res, { preferences }, "Notification preferences retrieved successfully");
}

export async function updatePreferenceHandler(req: Request, res: Response): Promise<void> {
  const { notificationType } = req.params as { notificationType: string };
  const body = req.body as UpdatePreferenceBody;
  const preference = await upsertPreference(req.orgContext!.membership.id, notificationType, body);
  sendSuccess(res, { preference }, "Notification preference updated successfully");
}
