import { AppError } from "../../errors/AppError.js";
import type { ClientRequestStatus, ClientRequestType } from "../../generated/prisma/client.js";
import { Prisma } from "../../generated/prisma/client.js";
import { prisma } from "../../lib/prisma.js";
import {
  iso,
  pageInfo,
  type InternalRequestView,
  type MessageView,
  type PageInfo,
  type PortalProject,
  type PortalTask,
  type ProjectProgress,
  type RequestView,
  type UpdateView,
} from "./collaboration.mappers.js";

// ---------- Shared guards ----------

export async function assertProjectInOrg(organizationId: string, projectId: string): Promise<void> {
  const project = await prisma.project.findFirst({
    where: { id: projectId, organizationId, deletedAt: null },
    select: { id: true },
  });
  if (!project) throw new AppError("Project not found", 404);
}

// ---------- Progress & portal read models ----------

export async function getProjectProgress(projectId: string): Promise<ProjectProgress> {
  const groups = await prisma.task.groupBy({
    by: ["status"],
    where: { projectId, deletedAt: null, parentTaskId: null },
    _count: { _all: true },
  });
  const byStatus: { [status: string]: number } = {};
  let total = 0;
  for (const g of groups) {
    byStatus[g.status] = g._count._all;
    total += g._count._all;
  }
  const completed = byStatus["DONE"] ?? 0;
  return {
    totalTasks: total,
    completedTasks: completed,
    percentComplete: total === 0 ? 0 : Math.round((completed / total) * 100),
    byStatus,
  };
}

const portalProjectSelect = {
  id: true,
  name: true,
  description: true,
  status: true,
  startDate: true,
  dueDate: true,
} satisfies Prisma.ProjectSelect;

export async function listPortalProjects(
  contactId: string,
  organizationId: string,
  clientOrganizationId: string,
): Promise<PortalProject[]> {
  const projects = await prisma.project.findMany({
    where: {
      deletedAt: null,
      organizationId,
      clientOrganizationId,
      clientAccess: { some: { clientContactId: contactId } },
    },
    select: portalProjectSelect,
    orderBy: { createdAt: "desc" },
  });
  return Promise.all(
    projects.map(async (p) => ({
      id: p.id,
      name: p.name,
      description: p.description,
      status: p.status,
      startDate: iso(p.startDate),
      dueDate: iso(p.dueDate),
      progress: await getProjectProgress(p.id),
    })),
  );
}

export async function getPortalProject(projectId: string): Promise<PortalProject> {
  const p = await prisma.project.findFirst({ where: { id: projectId, deletedAt: null }, select: portalProjectSelect });
  if (!p) throw new AppError("Project not found", 404);
  return {
    id: p.id,
    name: p.name,
    description: p.description,
    status: p.status,
    startDate: iso(p.startDate),
    dueDate: iso(p.dueDate),
    progress: await getProjectProgress(p.id),
  };
}

export async function listClientVisibleTasks(
  projectId: string,
  query: { page: number; limit: number; status?: string | undefined },
): Promise<{ tasks: PortalTask[]; pagination: PageInfo }> {
  const where: Prisma.TaskWhereInput = {
    projectId,
    deletedAt: null,
    clientVisible: true,
    ...(query.status ? { status: query.status as PortalTask["status"] } : {}),
  };
  const [rows, total] = await Promise.all([
    prisma.task.findMany({
      where,
      // Explicit select: assignee, collaborators, comments, attachments are never fetched.
      select: {
        id: true,
        title: true,
        description: true,
        status: true,
        priority: true,
        startDate: true,
        dueDate: true,
      },
      orderBy: { createdAt: "asc" },
      skip: (query.page - 1) * query.limit,
      take: query.limit,
    }),
    prisma.task.count({ where }),
  ]);
  return {
    tasks: rows.map((t) => ({
      id: t.id,
      title: t.title,
      description: t.description,
      status: t.status,
      priority: t.priority,
      startDate: iso(t.startDate),
      dueDate: iso(t.dueDate),
    })),
    pagination: pageInfo(query.page, query.limit, total),
  };
}

export async function setTaskClientVisibility(
  organizationId: string,
  projectId: string,
  taskId: string,
  clientVisible: boolean,
): Promise<{ id: string; clientVisible: boolean }> {
  const task = await prisma.task.findFirst({
    where: { id: taskId, projectId, deletedAt: null, project: { organizationId, deletedAt: null } },
    select: { id: true },
  });
  if (!task) throw new AppError("Task not found", 404);
  const updated = await prisma.task.update({
    where: { id: taskId },
    data: { clientVisible },
    select: { id: true, clientVisible: true },
  });
  return updated;
}

// ---------- Project updates (staff -> client) ----------

type UpdateRow = {
  id: string;
  title: string;
  body: string;
  createdAt: Date;
  author: { user: { name: string } };
};

const toUpdateView = (u: UpdateRow): UpdateView => ({
  id: u.id,
  title: u.title,
  body: u.body,
  createdAt: u.createdAt.toISOString(),
  author: { name: u.author.user.name },
});

const updateSelect = {
  id: true,
  title: true,
  body: true,
  createdAt: true,
  author: { select: { user: { select: { name: true } } } },
} satisfies Prisma.ProjectUpdateSelect;

export async function createProjectUpdate(input: {
  organizationId: string;
  projectId: string;
  authorMembershipId: string;
  title: string;
  body: string;
}): Promise<UpdateView> {
  await assertProjectInOrg(input.organizationId, input.projectId);
  const row = await prisma.projectUpdate.create({
    data: {
      organizationId: input.organizationId,
      projectId: input.projectId,
      authorMembershipId: input.authorMembershipId,
      title: input.title,
      body: input.body,
    },
    select: updateSelect,
  });
  return toUpdateView(row);
}

export async function listProjectUpdates(
  organizationId: string,
  projectId: string,
  page: number,
  limit: number,
): Promise<{ updates: UpdateView[]; pagination: PageInfo }> {
  const where = { projectId, organizationId, deletedAt: null };
  const [rows, total] = await Promise.all([
    prisma.projectUpdate.findMany({
      where,
      select: updateSelect,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.projectUpdate.count({ where }),
  ]);
  return { updates: rows.map(toUpdateView), pagination: pageInfo(page, limit, total) };
}

export async function deleteProjectUpdate(organizationId: string, projectId: string, updateId: string): Promise<void> {
  const { count } = await prisma.projectUpdate.updateMany({
    where: { id: updateId, projectId, organizationId, deletedAt: null },
    data: { deletedAt: new Date() },
  });
  if (count === 0) throw new AppError("Update not found", 404);
}

// ---------- Project message thread (staff <-> client) ----------

type MessageRow = {
  id: string;
  content: string;
  createdAt: Date;
  clientAuthor: { name: string } | null;
  staffAuthor: { user: { name: string } } | null;
};

const messageSelect = {
  id: true,
  content: true,
  createdAt: true,
  clientAuthor: { select: { name: true } },
  staffAuthor: { select: { user: { select: { name: true } } } },
} satisfies Prisma.ClientMessageSelect;

const toMessageView = (m: MessageRow): MessageView => ({
  id: m.id,
  content: m.content,
  createdAt: m.createdAt.toISOString(),
  author: m.clientAuthor
    ? { type: "CLIENT", name: m.clientAuthor.name }
    : { type: "STAFF", name: m.staffAuthor?.user.name ?? "Team member" },
});

export async function postMessage(input: {
  organizationId: string;
  projectId: string;
  content: string;
  author: { clientContactId: string } | { membershipId: string };
}): Promise<MessageView> {
  const row = await prisma.clientMessage.create({
    data: {
      organizationId: input.organizationId,
      projectId: input.projectId,
      content: input.content,
      ...("clientContactId" in input.author
        ? { authorClientContactId: input.author.clientContactId }
        : { authorMembershipId: input.author.membershipId }),
    },
    select: messageSelect,
  });

  if ("clientContactId" in input.author) {
    await notifyInternal({
      organizationId: input.organizationId,
      projectId: input.projectId,
      type: "CLIENT_MESSAGE",
      title: "New client message",
      message: `${row.clientAuthor?.name ?? "A client"}: ${input.content.slice(0, 200)}`,
      data: { projectId: input.projectId, messageId: row.id },
    });
  }
  return toMessageView(row);
}

export async function listMessages(
  organizationId: string,
  projectId: string,
  page: number,
  limit: number,
): Promise<{ messages: MessageView[]; pagination: PageInfo }> {
  const where = { projectId, organizationId, deletedAt: null };
  const [rows, total] = await Promise.all([
    prisma.clientMessage.findMany({
      where,
      select: messageSelect,
      orderBy: { createdAt: "asc" },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.clientMessage.count({ where }),
  ]);
  return { messages: rows.map(toMessageView), pagination: pageInfo(page, limit, total) };
}

export async function deleteMessage(organizationId: string, projectId: string, messageId: string): Promise<void> {
  const { count } = await prisma.clientMessage.updateMany({
    where: { id: messageId, projectId, organizationId, deletedAt: null },
    data: { deletedAt: new Date() },
  });
  if (count === 0) throw new AppError("Message not found", 404);
}

// ---------- Client requests ----------

type RequestRow = {
  id: string;
  projectId: string;
  type: ClientRequestType;
  title: string;
  description: string;
  status: ClientRequestStatus;
  resolutionNote: string | null;
  createdAt: Date;
  updatedAt: Date;
  resolvedAt: Date | null;
};

const toRequestView = (r: RequestRow): RequestView => ({
  id: r.id,
  projectId: r.projectId,
  type: r.type,
  title: r.title,
  description: r.description,
  status: r.status,
  resolutionNote: r.resolutionNote,
  createdAt: r.createdAt.toISOString(),
  updatedAt: r.updatedAt.toISOString(),
  resolvedAt: iso(r.resolvedAt),
});

export async function createClientRequest(input: {
  organizationId: string;
  projectId: string;
  clientContactId: string;
  contactName: string;
  type: ClientRequestType;
  title: string;
  description: string;
}): Promise<RequestView> {
  const row = await prisma.clientRequest.create({
    data: {
      organizationId: input.organizationId,
      projectId: input.projectId,
      clientContactId: input.clientContactId,
      type: input.type,
      title: input.title,
      description: input.description,
    },
  });

  await notifyInternal({
    organizationId: input.organizationId,
    projectId: input.projectId,
    type: "CLIENT_REQUEST",
    title: "New client request",
    message: `${input.contactName} submitted ${input.type.toLowerCase().replace("_", " ")}: ${input.title}`.slice(0, 300),
    data: { projectId: input.projectId, requestId: row.id },
  });

  return toRequestView(row);
}

/** A contact sees only the requests they raised themselves. */
export async function listOwnRequests(
  projectId: string,
  contactId: string,
  page: number,
  limit: number,
): Promise<{ requests: RequestView[]; pagination: PageInfo }> {
  const where = { projectId, clientContactId: contactId };
  const [rows, total] = await Promise.all([
    prisma.clientRequest.findMany({ where, orderBy: { createdAt: "desc" }, skip: (page - 1) * limit, take: limit }),
    prisma.clientRequest.count({ where }),
  ]);
  return { requests: rows.map(toRequestView), pagination: pageInfo(page, limit, total) };
}

const internalRequestInclude = {
  clientContact: { select: { id: true, name: true, email: true } },
} satisfies Prisma.ClientRequestInclude;

const toInternalRequestView = (
  r: RequestRow & { handledByMembershipId: string | null; clientContact: { id: string; name: string; email: string } },
): InternalRequestView => ({
  ...toRequestView(r),
  contact: { id: r.clientContact.id, name: r.clientContact.name, email: r.clientContact.email },
  handledByMembershipId: r.handledByMembershipId,
});

export async function listRequestsInternal(
  organizationId: string,
  query: { page: number; limit: number; projectId?: string | undefined; status?: ClientRequestStatus | undefined; type?: ClientRequestType | undefined },
): Promise<{ requests: InternalRequestView[]; pagination: PageInfo }> {
  const where: Prisma.ClientRequestWhereInput = {
    organizationId,
    ...(query.projectId ? { projectId: query.projectId } : {}),
    ...(query.status ? { status: query.status } : {}),
    ...(query.type ? { type: query.type } : {}),
  };
  const [rows, total] = await Promise.all([
    prisma.clientRequest.findMany({
      where,
      include: internalRequestInclude,
      orderBy: { createdAt: "desc" },
      skip: (query.page - 1) * query.limit,
      take: query.limit,
    }),
    prisma.clientRequest.count({ where }),
  ]);
  return { requests: rows.map(toInternalRequestView), pagination: pageInfo(query.page, query.limit, total) };
}

export async function getRequestInternal(organizationId: string, requestId: string): Promise<InternalRequestView> {
  const row = await prisma.clientRequest.findFirst({
    where: { id: requestId, organizationId },
    include: internalRequestInclude,
  });
  if (!row) throw new AppError("Request not found", 404);
  return toInternalRequestView(row);
}

export async function updateRequestInternal(
  organizationId: string,
  requestId: string,
  handlerMembershipId: string,
  input: { status?: ClientRequestStatus | undefined; resolutionNote?: string | null | undefined },
): Promise<InternalRequestView> {
  const existing = await prisma.clientRequest.findFirst({ where: { id: requestId, organizationId }, select: { id: true } });
  if (!existing) throw new AppError("Request not found", 404);

  const closing = input.status === "RESOLVED" || input.status === "REJECTED";
  const reopening = input.status === "OPEN" || input.status === "IN_REVIEW";

  const row = await prisma.clientRequest.update({
    where: { id: requestId },
    data: {
      handledByMembershipId: handlerMembershipId,
      ...(input.status !== undefined ? { status: input.status } : {}),
      ...(input.resolutionNote !== undefined ? { resolutionNote: input.resolutionNote } : {}),
      ...(closing ? { resolvedAt: new Date() } : {}),
      ...(reopening ? { resolvedAt: null } : {}),
    },
    include: internalRequestInclude,
  });
  return toInternalRequestView(row);
}

// ---------- Internal notifications about client activity ----------

/**
 * Notifies the people who should hear about client activity on a
 * project: org OWNERs/MANAGERs plus the project's own members. Honours
 * each recipient's in-app preference for the notification type.
 */
export async function notifyInternal(input: {
  organizationId: string;
  projectId: string;
  type: string;
  title: string;
  message: string;
  data: { [key: string]: string };
}): Promise<void> {
  const members = await prisma.membership.findMany({
    where: {
      organizationId: input.organizationId,
      status: "ACTIVE",
      OR: [{ role: { in: ["OWNER", "MANAGER"] } }, { projectMemberships: { some: { projectId: input.projectId } } }],
    },
    select: { id: true, notificationPreferences: { where: { notificationType: input.type }, select: { inAppEnabled: true } } },
  });

  const recipients = members.filter((m) => m.notificationPreferences[0]?.inAppEnabled !== false);
  if (recipients.length === 0) return;

  await prisma.notification.createMany({
    data: recipients.map((m) => ({
      organizationId: input.organizationId,
      recipientMembershipId: m.id,
      type: input.type,
      title: input.title,
      message: input.message,
      data: input.data,
    })),
  });
}
