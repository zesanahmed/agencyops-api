import { AppError } from "../../errors/AppError.js";
import { destroyCloudinaryAsset, uploadBufferToCloudinary } from "../../lib/cloudinary.js";
import { fileSignatureMatches } from "../../lib/fileSignature.js";
import { prisma } from "../../lib/prisma.js";
import { toSafeAttachment, type SafeAttachment } from "./attachment.mappers.js";

async function assertTaskInOrg(organizationId: string, projectId: string, taskId: string): Promise<void> {
  const task = await prisma.task.findFirst({
    where: { id: taskId, projectId, deletedAt: null, project: { organizationId, deletedAt: null } },
    select: { id: true },
  });
  if (!task) {
    throw new AppError("Task not found", 404);
  }
}

export async function uploadAttachment(input: {
  organizationId: string;
  projectId: string;
  taskId: string;
  uploadedByMembershipId: string;
  originalFilename: string;
  mimeType: string;
  buffer: Buffer;
}): Promise<SafeAttachment> {
  await assertTaskInOrg(input.organizationId, input.projectId, input.taskId);

  // Multer only saw the client-claimed Content-Type; confirm the bytes agree.
  if (!fileSignatureMatches(input.mimeType, input.buffer)) {
    throw new AppError("File content does not match its declared type", 400);
  }

  const stored = await uploadBufferToCloudinary(
    `agencyops/${input.organizationId}/tasks/${input.taskId}`,
    input.buffer,
  );

  const attachment = await prisma.attachment.create({
    data: {
      organizationId: input.organizationId,
      taskId: input.taskId,
      uploadedByMembershipId: input.uploadedByMembershipId,
      originalFilename: input.originalFilename,
      publicId: stored.publicId,
      url: stored.url,
      mimeType: input.mimeType,
      sizeBytes: input.buffer.length,
    },
  });

  return toSafeAttachment(attachment);
}

export async function listAttachments(
  organizationId: string,
  projectId: string,
  taskId: string,
): Promise<SafeAttachment[]> {
  await assertTaskInOrg(organizationId, projectId, taskId);
  const rows = await prisma.attachment.findMany({ where: { taskId }, orderBy: { createdAt: "desc" } });
  return rows.map(toSafeAttachment);
}

export async function deleteAttachment(
  organizationId: string,
  projectId: string,
  taskId: string,
  attachmentId: string,
): Promise<void> {
  await assertTaskInOrg(organizationId, projectId, taskId);
  const attachment = await prisma.attachment.findFirst({ where: { id: attachmentId, taskId } });
  if (!attachment) {
    throw new AppError("Attachment not found", 404);
  }

  // Best-effort: a Cloudinary failure must not leave a record the user cannot remove.
  await destroyCloudinaryAsset(attachment.publicId);

  await prisma.attachment.delete({ where: { id: attachmentId } });
}
