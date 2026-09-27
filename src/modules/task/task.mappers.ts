import type {
  Task,
  TaskCollaborator,
  TaskPriority,
  TaskStatus,
} from "../../generated/prisma/client.js";
import type { JsonValue } from "../../types/api-response.js";

export interface SafeTask {
  id: string;
  projectId: string;
  sprintId: string | null;
  parentTaskId: string | null;
  assigneeMembershipId: string | null;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  startDate: string | null;
  dueDate: string | null;
  createdAt: string;
  updatedAt: string;
  [key: string]: JsonValue;
}

export function toSafeTask(task: Task): SafeTask {
  return {
    id: task.id,
    projectId: task.projectId,
    sprintId: task.sprintId,
    parentTaskId: task.parentTaskId,
    assigneeMembershipId: task.assigneeMembershipId,
    title: task.title,
    description: task.description,
    status: task.status,
    priority: task.priority,
    startDate: task.startDate ? task.startDate.toISOString() : null,
    dueDate: task.dueDate ? task.dueDate.toISOString() : null,
    createdAt: task.createdAt.toISOString(),
    updatedAt: task.updatedAt.toISOString(),
  };
}

export interface SafeTaskCollaborator {
  id: string;
  taskId: string;
  membershipId: string;
  createdAt: string;
  [key: string]: JsonValue;
}

export function toSafeTaskCollaborator(tc: TaskCollaborator): SafeTaskCollaborator {
  return { id: tc.id, taskId: tc.taskId, membershipId: tc.membershipId, createdAt: tc.createdAt.toISOString() };
}
