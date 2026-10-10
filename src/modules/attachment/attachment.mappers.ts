import type { Attachment } from "../../generated/prisma/client.js";
import type { JsonValue } from "../../types/api-response.js";

export interface SafeAttachment {
  id: string;
  taskId: string;
  uploadedByMembershipId: string;
  originalFilename: string;
  url: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
  [key: string]: JsonValue;
}

// publicId never leaves the server — it's an internal reference to
// delete the Cloudinary asset, not something the client needs.
export function toSafeAttachment(a: Attachment): SafeAttachment {
  return {
    id: a.id,
    taskId: a.taskId,
    uploadedByMembershipId: a.uploadedByMembershipId,
    originalFilename: a.originalFilename,
    url: a.url,
    mimeType: a.mimeType,
    sizeBytes: a.sizeBytes,
    createdAt: a.createdAt.toISOString(),
  };
}
