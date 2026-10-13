import type { Request, Response } from "express";
import { sendSuccess } from "../../lib/apiResponse.js";
import { prisma } from "../../lib/prisma.js";
import { createPortalSession, createProCheckout, getBilling } from "./billing.service.js";

export async function get(req: Request, res: Response): Promise<void> {
  const billing = await getBilling(req.orgContext!.organization.id);
  sendSuccess(res, billing, "Billing retrieved successfully");
}

export async function checkout(req: Request, res: Response): Promise<void> {
  const { organization, membership } = req.orgContext!;
  const user = await prisma.user.findUniqueOrThrow({ where: { id: membership.userId }, select: { email: true } });
  const ua = req.headers["user-agent"];
  const result = await createProCheckout(organization.id, organization.name, {
    membershipId: membership.id,
    email: user.email,
    ipAddress: req.ip ?? null,
    userAgent: typeof ua === "string" ? ua : null,
  });
  sendSuccess(res, result, "Checkout session created successfully", 201);
}

export async function portal(req: Request, res: Response): Promise<void> {
  const result = await createPortalSession(req.orgContext!.organization.id);
  sendSuccess(res, result, "Billing portal session created successfully", 201);
}
