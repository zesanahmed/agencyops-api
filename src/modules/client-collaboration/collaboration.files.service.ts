import { AppError } from "../../errors/AppError.js";
import { Prisma } from "../../generated/prisma/client.js";
import { destroyCloudinaryAsset, uploadBufferToCloudinary } from "../../lib/cloudinary.js";
import { fileSignatureMatches } from "../../lib/fileSignature.js";
import { prisma } from "../../lib/prisma.js";
import { pageInfo, type FileView, type PageInfo } from "./collaboration.mappers.js";
import { notifyInternal } from "./collaboration.service.js";

const fileSelect = {
  id: true,
  originalFilename: true,
  url: true,
  mimeType: true,
  sizeBytes: true,
  createdAt: true,
  clientUploader: { select: { name: true } },
  staffUploader: { select: { user: { select: { name: true } } } },
} satisfies Prisma.ClientFileSelect;

type FileRow = Prisma.ClientFileGetPayload<{ select: typeof fileSelect }>;

// publicId never leaves the server.
const toFileView = (f: FileRow): FileView => ({
  id: f.id,
  originalFilename: f.originalFilename,
  url: f.url,
  mimeType: f.mimeType,
  sizeBytes: f.sizeBytes,
  createdAt: f.createdAt.toISOString(),
  uploadedBy: f.clientUploader
    ? { type: "CLIENT", name: f.clientUploader.name }
    : { type: "STAFF", name: f.staffUploader?.user.name ?? "Team member" },
});

export async function uploadProjectFile(input: {
  organizationId: string;
  projectId: string;
  uploader: { clientContactId: string; contactName: string } | { membershipId: string };
  originalFilename: string;
  mimeType: string;
  buffer: Buffer;
}): Promise<FileView> {
  // Multer only saw the client-claimed Content-Type; confirm the bytes agree.
  if (!fileSignatureMatches(input.mimeType, input.buffer)) {
    throw new AppError("File content does not match its declared type", 400);
  }

  const stored = await uploadBufferToCloudinary(
    `agencyops/${input.organizationId}/projects/${input.projectId}/shared-files`,
    input.buffer,
  );

  const isClient = "clientContactId" in input.uploader;
  let row: FileRow;
  try {
    row = await prisma.clientFile.create({
      data: {
        organizationId: input.organizationId,
        projectId: input.projectId,
        originalFilename: input.originalFilename.slice(0, 255),
        publicId: stored.publicId,
        url: stored.url,
        mimeType: input.mimeType,
        sizeBytes: input.buffer.length,
        ...("clientContactId" in input.uploader
          ? { uploadedByClientContactId: input.uploader.clientContactId }
          : { uploadedByMembershipId: input.uploader.membershipId }),
      },
      select: fileSelect,
    });
  } catch (error) {
    // Don't leave an orphaned asset behind if the metadata write fails.
    await destroyCloudinaryAsset(stored.publicId);
    throw error;
  }

  if (isClient && "contactName" in input.uploader) {
    await notifyInternal({
      organizationId: input.organizationId,
      projectId: input.projectId,
      type: "CLIENT_FILE",
      title: "Client uploaded a file",
      message: `${input.uploader.contactName} uploaded ${input.originalFilename.slice(0, 150)}`,
      data: { projectId: input.projectId, fileId: row.id },
    });
  }
  return toFileView(row);
}

export async function listProjectFiles(
  organizationId: string,
  projectId: string,
  page: number,
  limit: number,
): Promise<{ files: FileView[]; pagination: PageInfo }> {
  const where = { projectId, organizationId };
  const [rows, total] = await Promise.all([
    prisma.clientFile.findMany({
      where,
      select: fileSelect,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.clientFile.count({ where }),
  ]);
  return { files: rows.map(toFileView), pagination: pageInfo(page, limit, total) };
}

export async function deleteProjectFile(organizationId: string, projectId: string, fileId: string): Promise<void> {
  const file = await prisma.clientFile.findFirst({
    where: { id: fileId, projectId, organizationId },
    select: { id: true, publicId: true },
  });
  if (!file) throw new AppError("File not found", 404);
  await destroyCloudinaryAsset(file.publicId);
  await prisma.clientFile.delete({ where: { id: file.id } });
}
