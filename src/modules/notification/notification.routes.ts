import { Router } from "express";
import { validate } from "../../middlewares/validate.js";
import { loadOrganizationContext } from "../rbac/rbac.middleware.js";
import { organizationIdParamSchema } from "../organization/organization.validation.js";
import {
  list,
  listPreferencesHandler,
  markAllRead,
  markRead,
  updatePreferenceHandler,
} from "./notification.controller.js";
import {
  notificationIdParamSchema,
  notificationListQuerySchema,
  notificationTypeParamSchema,
  updatePreferenceSchema,
} from "./notification.validation.js";

// No requirePermission() here on purpose — any active member manages
// only their own notifications/preferences, gated by membershipId in
// the service, not by role.
const notificationRouter: Router = Router({ mergeParams: true });

notificationRouter.use(validate({ params: organizationIdParamSchema }), loadOrganizationContext());

notificationRouter.get("/", validate({ query: notificationListQuerySchema }), list);
notificationRouter.patch("/:notificationId/read", validate({ params: notificationIdParamSchema }), markRead);
notificationRouter.post("/read-all", markAllRead);

notificationRouter.get("/preferences", listPreferencesHandler);
notificationRouter.put(
  "/preferences/:notificationType",
  validate({ params: notificationTypeParamSchema, body: updatePreferenceSchema }),
  updatePreferenceHandler,
);

export { notificationRouter };
