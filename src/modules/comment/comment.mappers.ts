import type { Comment } from "../../generated/prisma/client.js";
import type { JsonValue } from "../../types/api-response.js";

export interface SafeComment {
  id: string;
  taskId: string;
  authorMembershipId: string;
  content: string;
  createdAt: string;
  updatedAt: string;
  [key: string]: JsonValue;
}

export function toSafeComment(comment: Comment): SafeComment {
  return {
    id: comment.id,
    taskId: comment.taskId,
    authorMembershipId: comment.authorMembershipId,
    content: comment.content,
    createdAt: comment.createdAt.toISOString(),
    updatedAt: comment.updatedAt.toISOString(),
  };
}
