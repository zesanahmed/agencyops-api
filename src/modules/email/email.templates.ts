import { env } from "../../config/env.js";
import type { EmailJob, EmailMessage } from "./email.types.js";

const escapeHtml = (value: string): string =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

// Frontend routes the links point at. They must match agencyops-web.
export const INVITATION_PATH = "/invitations/accept";
export const CLIENT_INVITE_PATH = "/portal/accept-invite";
export const VERIFY_EMAIL_PATH = "/verify-email";
export const RESET_PASSWORD_PATH = "/reset-password";

function link(path: string, token?: string): string {
  const url = new URL(path, `${env.frontendUrl}/`);
  if (token) url.searchParams.set("token", token);
  return url.toString();
}

function layout(heading: string, paragraphs: string[], action?: { label: string; url: string }): string {
  const body = paragraphs.map((p) => `<p style="margin:0 0 16px">${escapeHtml(p)}</p>`).join("");
  const button = action
    ? `<p style="margin:24px 0"><a href="${escapeHtml(action.url)}" style="background:#2563eb;color:#fff;padding:12px 20px;border-radius:6px;text-decoration:none;display:inline-block">${escapeHtml(action.label)}</a></p>` +
      `<p style="margin:0;color:#6b7280;font-size:12px">If the button does not work, copy this link into your browser:<br>${escapeHtml(action.url)}</p>`
    : "";
  return `<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.5;color:#111827;max-width:560px;margin:0 auto;padding:24px"><h2 style="margin:0 0 16px">${escapeHtml(heading)}</h2>${body}${button}</div>`;
}

/** Pure: turns a job into a ready-to-send message. All dynamic text is HTML-escaped. */
export function renderEmail(job: EmailJob): EmailMessage {
  switch (job.type) {
    case "ORGANIZATION_INVITATION": {
      const url = link(INVITATION_PATH, job.token);
      const intro = `${job.inviterName} invited you to join ${job.organizationName} on AgencyOps as ${job.role.toLowerCase().replace("_", " ")}.`;
      return {
        to: job.to,
        subject: `You're invited to join ${job.organizationName} on AgencyOps`,
        html: layout("You're invited", [intro, "This invitation expires in 7 days and can be used once."], { label: "Accept invitation", url }),
        text: `${intro}\n\nAccept the invitation: ${url}\n\nThis invitation expires in 7 days and can be used once.`,
      };
    }
    case "CLIENT_PORTAL_INVITE": {
      const url = link(CLIENT_INVITE_PATH, job.token);
      const intro = `Hi ${job.contactName}, ${job.organizationName} invited you to their client portal to follow your projects and invoices.`;
      return {
        to: job.to,
        subject: `${job.organizationName} invited you to their client portal`,
        html: layout("Welcome to your client portal", [intro, "Use the link below to set your password. It can be used once."], {
          label: "Set up your account",
          url,
        }),
        text: `${intro}\n\nSet up your account: ${url}\n\nThe link can be used once.`,
      };
    }
    case "VERIFY_EMAIL": {
      const url = link(VERIFY_EMAIL_PATH, job.token);
      const intro = `Hi ${job.name}, please confirm your email address to finish setting up your AgencyOps account.`;
      return {
        to: job.to,
        subject: "Confirm your email address",
        html: layout("Confirm your email", [intro, "This link expires in 24 hours and can be used once."], { label: "Confirm email", url }),
        text: `${intro}\n\nConfirm your email: ${url}\n\nThis link expires in 24 hours and can be used once.`,
      };
    }
    case "PASSWORD_RESET": {
      const url = link(RESET_PASSWORD_PATH, job.token);
      const intro = `Hi ${job.name}, we received a request to reset your AgencyOps password.`;
      const outro = "This link expires in 1 hour and can be used once. If you did not ask for this, you can ignore this email — your password will not change.";
      return {
        to: job.to,
        subject: "Reset your password",
        html: layout("Reset your password", [intro, outro], { label: "Choose a new password", url }),
        text: `${intro}\n\nChoose a new password: ${url}\n\n${outro}`,
      };
    }
    case "NOTIFICATION": {
      const url = link("/");
      return {
        to: job.to,
        subject: job.title,
        html: layout(job.title, [`Hi ${job.recipientName},`, job.message], { label: "Open AgencyOps", url }),
        text: `Hi ${job.recipientName},\n\n${job.message}\n\nOpen AgencyOps: ${url}`,
      };
    }
  }
}
