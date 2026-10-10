import type { Request, Response } from "express";
import { AppError } from "../../errors/AppError.js";
import { sendSuccess } from "../../lib/apiResponse.js";
import { deleteAttachment, listAttachments, uploadAttachment } from "./attachment.service.js";

function ctx(req: Request) {
  const { projectId, taskId } = req.params as { projectId: string; taskId: string };
  return {
    organizationId: req.orgContext!.organization.id,
    projectId,
    taskId,
    membershipId: req.orgContext!.membership.id,
  };
}

export async function upload(req: Request, res: Response): Promise<void> {
  const c = ctx(req);
  const file = req.file;
  if (!file) {
    throw new AppError("No file was uploaded (expected form field \"file\")", 400);
  }

  const attachment = await uploadAttachment({
    organizationId: c.organizationId,
    projectId: c.projectId,
    taskId: c.taskId,
    uploadedByMembershipId: c.membershipId,
    originalFilename: file.originalname,
    mimeType: file.mimetype,
    buffer: file.buffer,
  });
  sendSuccess(res, { attachment }, "File uploaded successfully", 201);
}

export async function list(req: Request, res: Response): Promise<void> {
  const c = ctx(req);
  const attachments = await listAttachments(c.organizationId, c.projectId, c.taskId);
  sendSuccess(res, { attachments }, "Attachments retrieved successfully");
}

export async function remove(req: Request, res: Response): Promise<void> {
  const c = ctx(req);
  const { attachmentId } = req.params as { attachmentId: string };
  await deleteAttachment(c.organizationId, c.projectId, c.taskId, attachmentId);
  sendSuccess(res, null, "Attachment deleted successfully");
}
