import { Router } from "express";
import { validate } from "../../middlewares/validate.js";
import { authRateLimiter, refreshRateLimiter } from "../../middlewares/rateLimit.js";
import {
  login,
  logout,
  logoutAll,
  me,
  refresh,
  register,
} from "./auth.controller.js";
import { authenticate } from "./auth.middleware.js";
import { begin as oauthBegin, callback as oauthCallback } from "./oauth/oauth.controller.js";
import {
  changePasswordHandler,
  deleteAccountHandler,
  forgotPasswordHandler,
  listSessionsHandler,
  resendVerificationHandler,
  resetPasswordHandler,
  revokeSessionHandler,
  verifyEmailHandler,
} from "./account.controller.js";
import {
  changePasswordSchema,
  deleteAccountSchema,
  forgotPasswordSchema,
  loginSchema,
  registerSchema,
  resetPasswordSchema,
  sessionIdParamSchema,
  verifyEmailSchema,
} from "./auth.validation.js";

const authRouter: Router = Router();

authRouter.post("/register", authRateLimiter, validate({ body: registerSchema }), register);
authRouter.post("/login", authRateLimiter, validate({ body: loginSchema }), login);
authRouter.post("/refresh", refreshRateLimiter, refresh);
authRouter.post("/logout", logout);
authRouter.post("/logout-all", authenticate, logoutAll);
authRouter.get("/me", authenticate, me);

// OAuth sign-in (Google / GitHub). Browser navigations, not JSON calls.
authRouter.get("/oauth/:provider", refreshRateLimiter, oauthBegin);
authRouter.get("/oauth/:provider/callback", refreshRateLimiter, oauthCallback);

// Email verification and password recovery. Public routes share the strict
// auth rate limit; none of them reveals whether an email is registered.
authRouter.post("/verify-email", authRateLimiter, validate({ body: verifyEmailSchema }), verifyEmailHandler);
authRouter.post("/resend-verification", authRateLimiter, authenticate, resendVerificationHandler);
authRouter.post("/forgot-password", authRateLimiter, validate({ body: forgotPasswordSchema }), forgotPasswordHandler);
authRouter.post("/reset-password", authRateLimiter, validate({ body: resetPasswordSchema }), resetPasswordHandler);

// Account security (signed-in user, own account only).
authRouter.post("/change-password", authRateLimiter, authenticate, validate({ body: changePasswordSchema }), changePasswordHandler);
authRouter.get("/sessions", authenticate, listSessionsHandler);
authRouter.delete("/sessions/:sessionId", authenticate, validate({ params: sessionIdParamSchema }), revokeSessionHandler);
authRouter.delete("/account", authRateLimiter, authenticate, validate({ body: deleteAccountSchema }), deleteAccountHandler);

export { authRouter };
