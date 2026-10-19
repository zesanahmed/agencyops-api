import type { Request, Response } from "express";
import { refreshCookieClearOptions, refreshCookieName } from "../../config/cookies.js";
import { sendSuccess } from "../../lib/apiResponse.js";
import {
  changePassword,
  deleteAccount,
  listActiveSessions,
  requestPasswordReset,
  resendVerification,
  resetPassword,
  revokeOwnSession,
  verifyEmail,
} from "./account.service.js";

export async function verifyEmailHandler(req: Request, res: Response): Promise<void> {
  await verifyEmail((req.body as { token: string }).token);
  sendSuccess(res, null, "Email verified successfully");
}

export async function resendVerificationHandler(req: Request, res: Response): Promise<void> {
  const sent = await resendVerification(req.auth!.userId);
  sendSuccess(res, { sent }, sent ? "Verification email sent" : "Email is already verified");
}

export async function forgotPasswordHandler(req: Request, res: Response): Promise<void> {
  await requestPasswordReset((req.body as { email: string }).email);
  // Identical for known and unknown addresses on purpose.
  sendSuccess(res, null, "If an account exists for that email, a password reset link has been sent");
}

export async function resetPasswordHandler(req: Request, res: Response): Promise<void> {
  const { token, password } = req.body as { token: string; password: string };
  await resetPassword(token, password);
  sendSuccess(res, null, "Password reset successfully. Please sign in with your new password");
}

export async function changePasswordHandler(req: Request, res: Response): Promise<void> {
  const { currentPassword, newPassword } = req.body as { currentPassword: string; newPassword: string };
  await changePassword(req.auth!.userId, currentPassword, newPassword);
  // Every session — this one included — was revoked, so the cookie is dead too.
  res.clearCookie(refreshCookieName, refreshCookieClearOptions);
  sendSuccess(res, null, "Password changed. Please sign in again");
}

export async function listSessionsHandler(req: Request, res: Response): Promise<void> {
  const { userId, sessionId } = req.auth!;
  const sessions = await listActiveSessions(userId, sessionId);
  sendSuccess(res, { sessions }, "Sessions retrieved successfully");
}

export async function revokeSessionHandler(req: Request, res: Response): Promise<void> {
  const { userId, sessionId: currentSessionId } = req.auth!;
  const { sessionId } = req.params as { sessionId: string };
  await revokeOwnSession(userId, sessionId);
  if (sessionId === currentSessionId) {
    res.clearCookie(refreshCookieName, refreshCookieClearOptions);
  }
  sendSuccess(res, null, "Session revoked successfully");
}

export async function deleteAccountHandler(req: Request, res: Response): Promise<void> {
  await deleteAccount(req.auth!.userId, (req.body as { password?: string }).password);
  res.clearCookie(refreshCookieName, refreshCookieClearOptions);
  sendSuccess(res, null, "Account deleted successfully");
}
