import type {
  ClientContact,
  ClientContactStatus,
  ClientOrganization,
  ClientProjectAccess,
} from "../../generated/prisma/client.js";
import type { JsonValue } from "../../types/api-response.js";

export interface SafeClientOrganization {
  id: string;
  name: string;
  website: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  [key: string]: JsonValue;
}

export function toSafeClientOrganization(c: ClientOrganization): SafeClientOrganization {
  return {
    id: c.id,
    name: c.name,
    website: c.website,
    notes: c.notes,
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
  };
}

export interface SafeClientContact {
  id: string;
  clientOrganizationId: string;
  name: string;
  email: string;
  jobTitle: string | null;
  status: ClientContactStatus;
  lastLoginAt: string | null;
  createdAt: string;
  [key: string]: JsonValue;
}

// passwordHash and inviteTokenHash never leave the server.
export function toSafeClientContact(c: ClientContact): SafeClientContact {
  return {
    id: c.id,
    clientOrganizationId: c.clientOrganizationId,
    name: c.name,
    email: c.email,
    jobTitle: c.jobTitle,
    status: c.status,
    lastLoginAt: c.lastLoginAt ? c.lastLoginAt.toISOString() : null,
    createdAt: c.createdAt.toISOString(),
  };
}

export interface SafeClientProjectAccess {
  id: string;
  clientContactId: string;
  projectId: string;
  createdAt: string;
  [key: string]: JsonValue;
}

export function toSafeClientProjectAccess(a: ClientProjectAccess): SafeClientProjectAccess {
  return {
    id: a.id,
    clientContactId: a.clientContactId,
    projectId: a.projectId,
    createdAt: a.createdAt.toISOString(),
  };
}
