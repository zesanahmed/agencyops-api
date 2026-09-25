import type {
  Invitation,
  MembershipRole,
} from "../../generated/prisma/client.js";
import type { JsonValue } from "../../types/api-response.js";

/**
 * Never includes tokenHash. Same index-signature pattern (and same
 * reasoning) as SafeOrganization/SafeMembership in
 * organization.mappers.ts.
 */
export interface SafeInvitation {
  id: string;
  organizationId: string;
  email: string;
  role: MembershipRole;
  invitedByMembershipId: string;
  expiresAt: string;
  acceptedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
  [key: string]: JsonValue;
}

export function toSafeInvitation(invitation: Invitation): SafeInvitation {
  return {
    id: invitation.id,
    organizationId: invitation.organizationId,
    email: invitation.email,
    role: invitation.role,
    invitedByMembershipId: invitation.invitedByMembershipId,
    expiresAt: invitation.expiresAt.toISOString(),
    acceptedAt: invitation.acceptedAt
      ? invitation.acceptedAt.toISOString()
      : null,
    revokedAt: invitation.revokedAt ? invitation.revokedAt.toISOString() : null,
    createdAt: invitation.createdAt.toISOString(),
  };
}

export interface InvitationPreview {
  organizationName: string;
  email: string;
  role: MembershipRole;
  expiresAt: string;
  [key: string]: JsonValue;
}
