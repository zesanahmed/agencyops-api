import { AppError } from "../../errors/AppError.js";
import { getCloudinary } from "../../lib/cloudinary.js";
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

  const cloudinary = getCloudinary(); // throws if not configured — caller gets a clean 503, not a crash

  const uploadResult = await new Promise<{ public_id: string; secure_url: string }>((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { folder: `agencyops/${input.organizationId}/tasks/${input.taskId}`, resource_type: "auto" },
      (error, result) => {
        if (error || !result) reject(error ?? new Error("Cloudinary upload failed"));
        else resolve(result);
      },
    );
    stream.end(input.buffer);
  });

  const attachment = await prisma.attachment.create({
    data: {
      organizationId: input.organizationId,
      taskId: input.taskId,
      uploadedByMembershipId: input.uploadedByMembershipId,
      originalFilename: input.originalFilename,
      publicId: uploadResult.public_id,
      url: uploadResult.secure_url,
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

  const cloudinary = getCloudinary();
  await cloudinary.uploader.destroy(attachment.publicId).catch(() => {
    // Best-effort — if Cloudinary deletion fails (e.g. already gone),
    // still remove our own record rather than leaving a dangling
    // reference the user can't get rid of.
  });

  await prisma.attachment.delete({ where: { id: attachmentId } });
}
