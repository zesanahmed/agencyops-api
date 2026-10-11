import type {
  ClientRequestStatus,
  ClientRequestType,
  TaskPriority,
  TaskStatus,
  ProjectStatus,
} from "../../generated/prisma/client.js";

// `type` aliases (not interfaces) so these are structurally assignable
// to the JsonValue constraint of sendSuccess().

export type PageInfo = { page: number; limit: number; total: number; totalPages: number };

export function pageInfo(page: number, limit: number, total: number): PageInfo {
  return { page, limit, total, totalPages: Math.ceil(total / limit) };
}

export type ProjectProgress = {
  totalTasks: number;
  completedTasks: number;
  percentComplete: number;
  byStatus: { [status: string]: number };
};

// ---- Client-facing shapes: only what a client may see. ----

export type PortalProject = {
  id: string;
  name: string;
  description: string | null;
  status: ProjectStatus;
  startDate: string | null;
  dueDate: string | null;
  progress: ProjectProgress;
};

export type PortalTask = {
  id: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  startDate: string | null;
  dueDate: string | null;
};

export type MessageView = {
  id: string;
  content: string;
  createdAt: string;
  author: { type: "CLIENT" | "STAFF"; name: string };
};

export type UpdateView = {
  id: string;
  title: string;
  body: string;
  createdAt: string;
  author: { name: string };
};

export type FileView = {
  id: string;
  originalFilename: string;
  url: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
  uploadedBy: { type: "CLIENT" | "STAFF"; name: string };
};

export type RequestView = {
  id: string;
  projectId: string;
  type: ClientRequestType;
  title: string;
  description: string;
  status: ClientRequestStatus;
  resolutionNote: string | null;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
};

// Internal view adds who raised it and who handled it.
export type InternalRequestView = RequestView & {
  contact: { id: string; name: string; email: string };
  handledByMembershipId: string | null;
};

export const iso = (d: Date | null): string | null => (d ? d.toISOString() : null);
