import type { Sprint, SprintStatus } from "../../generated/prisma/client.js";
import type { JsonValue } from "../../types/api-response.js";

export interface SafeSprint {
  id: string;
  projectId: string;
  name: string;
  goal: string | null;
  status: SprintStatus;
  startDate: string;
  endDate: string;
  createdAt: string;
  updatedAt: string;
  [key: string]: JsonValue;
}

export function toSafeSprint(sprint: Sprint): SafeSprint {
  return {
    id: sprint.id,
    projectId: sprint.projectId,
    name: sprint.name,
    goal: sprint.goal,
    status: sprint.status,
    startDate: sprint.startDate.toISOString(),
    endDate: sprint.endDate.toISOString(),
    createdAt: sprint.createdAt.toISOString(),
    updatedAt: sprint.updatedAt.toISOString(),
  };
}
