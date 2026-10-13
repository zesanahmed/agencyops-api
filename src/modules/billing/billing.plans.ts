import type { Plan, PlanCode } from "../../generated/prisma/client.js";
import { env } from "../../config/env.js";
import { prisma } from "../../lib/prisma.js";

/**
 * Source of truth for plan definitions. The Plan table mirrors this
 * (upserted on demand), so a deploy never needs a separate seed step.
 * `null` limit = unlimited. The numbers are placeholders for a product
 * decision: they are stored and returned by the API but NOT yet enforced
 * anywhere (creating projects / inviting members is unaffected).
 */
const PLAN_DEFINITIONS: Record<PlanCode, { name: string; maxMembers: number | null; maxProjects: number | null }> = {
  FREE: { name: "Free", maxMembers: 5, maxProjects: 3 },
  PRO: { name: "Pro", maxMembers: null, maxProjects: null },
};

export async function ensurePlan(code: PlanCode): Promise<Plan> {
  const def = PLAN_DEFINITIONS[code];
  const stripePriceId = code === "PRO" ? (env.stripe.proPriceId ?? null) : null;
  return prisma.plan.upsert({
    where: { code },
    create: { code, ...def, stripePriceId },
    update: { ...def, stripePriceId },
  });
}
