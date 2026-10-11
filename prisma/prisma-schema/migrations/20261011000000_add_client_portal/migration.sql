-- CreateEnum
CREATE TYPE "ClientContactStatus" AS ENUM ('INVITED', 'ACTIVE', 'DISABLED');

-- CreateEnum
CREATE TYPE "ClientRequestType" AS ENUM ('NEW_REQUIREMENT', 'CHANGE_REQUEST', 'QUESTION', 'FEEDBACK', 'ISSUE');

-- CreateEnum
CREATE TYPE "ClientRequestStatus" AS ENUM ('OPEN', 'IN_REVIEW', 'RESOLVED', 'REJECTED');

-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "clientOrganizationId" UUID;

-- AlterTable
ALTER TABLE "Task" ADD COLUMN     "clientVisible" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "ClientOrganization" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "website" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "ClientOrganization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClientContact" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "clientOrganizationId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "jobTitle" TEXT,
    "passwordHash" TEXT,
    "status" "ClientContactStatus" NOT NULL DEFAULT 'INVITED',
    "inviteTokenHash" TEXT,
    "inviteExpiresAt" TIMESTAMP(3),
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClientContact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClientSession" (
    "id" UUID NOT NULL,
    "clientContactId" UUID NOT NULL,
    "refreshTokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "lastUsedAt" TIMESTAMP(3),
    "userAgent" TEXT,
    "ipAddress" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClientSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClientProjectAccess" (
    "id" UUID NOT NULL,
    "clientContactId" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "grantedByMembershipId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClientProjectAccess_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClientRequest" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "clientContactId" UUID NOT NULL,
    "type" "ClientRequestType" NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "status" "ClientRequestStatus" NOT NULL DEFAULT 'OPEN',
    "resolutionNote" TEXT,
    "handledByMembershipId" UUID,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClientRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectUpdate" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "authorMembershipId" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "ProjectUpdate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClientMessage" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "authorClientContactId" UUID,
    "authorMembershipId" UUID,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "ClientMessage_pkey" PRIMARY KEY ("id"),
    -- Exactly one author: a client contact XOR an internal membership.
    CONSTRAINT "ClientMessage_exactly_one_author_check" CHECK (("authorClientContactId" IS NOT NULL) <> ("authorMembershipId" IS NOT NULL))
);

-- CreateTable
CREATE TABLE "ClientFile" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "uploadedByClientContactId" UUID,
    "uploadedByMembershipId" UUID,
    "originalFilename" TEXT NOT NULL,
    "publicId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClientFile_pkey" PRIMARY KEY ("id"),
    -- Exactly one uploader: a client contact XOR an internal membership.
    CONSTRAINT "ClientFile_exactly_one_uploader_check" CHECK (("uploadedByClientContactId" IS NOT NULL) <> ("uploadedByMembershipId" IS NOT NULL))
);

-- CreateIndex
CREATE INDEX "ClientOrganization_organizationId_idx" ON "ClientOrganization"("organizationId");

-- CreateIndex
CREATE INDEX "ClientOrganization_organizationId_deletedAt_idx" ON "ClientOrganization"("organizationId", "deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ClientContact_inviteTokenHash_key" ON "ClientContact"("inviteTokenHash");

-- CreateIndex
CREATE INDEX "ClientContact_clientOrganizationId_idx" ON "ClientContact"("clientOrganizationId");

-- CreateIndex
CREATE UNIQUE INDEX "ClientContact_organizationId_email_key" ON "ClientContact"("organizationId", "email");

-- CreateIndex
CREATE UNIQUE INDEX "ClientSession_refreshTokenHash_key" ON "ClientSession"("refreshTokenHash");

-- CreateIndex
CREATE INDEX "ClientSession_clientContactId_idx" ON "ClientSession"("clientContactId");

-- CreateIndex
CREATE INDEX "ClientSession_expiresAt_idx" ON "ClientSession"("expiresAt");

-- CreateIndex
CREATE INDEX "ClientProjectAccess_projectId_idx" ON "ClientProjectAccess"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "ClientProjectAccess_clientContactId_projectId_key" ON "ClientProjectAccess"("clientContactId", "projectId");

-- CreateIndex
CREATE INDEX "ClientRequest_organizationId_status_idx" ON "ClientRequest"("organizationId", "status");

-- CreateIndex
CREATE INDEX "ClientRequest_projectId_status_idx" ON "ClientRequest"("projectId", "status");

-- CreateIndex
CREATE INDEX "ClientRequest_clientContactId_idx" ON "ClientRequest"("clientContactId");

-- CreateIndex
CREATE INDEX "ProjectUpdate_organizationId_idx" ON "ProjectUpdate"("organizationId");

-- CreateIndex
CREATE INDEX "ProjectUpdate_projectId_deletedAt_idx" ON "ProjectUpdate"("projectId", "deletedAt");

-- CreateIndex
CREATE INDEX "ClientMessage_organizationId_idx" ON "ClientMessage"("organizationId");

-- CreateIndex
CREATE INDEX "ClientMessage_projectId_deletedAt_createdAt_idx" ON "ClientMessage"("projectId", "deletedAt", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ClientFile_publicId_key" ON "ClientFile"("publicId");

-- CreateIndex
CREATE INDEX "ClientFile_organizationId_idx" ON "ClientFile"("organizationId");

-- CreateIndex
CREATE INDEX "ClientFile_projectId_createdAt_idx" ON "ClientFile"("projectId", "createdAt");

-- CreateIndex
CREATE INDEX "Project_clientOrganizationId_idx" ON "Project"("clientOrganizationId");

-- CreateIndex
CREATE INDEX "Task_projectId_clientVisible_idx" ON "Task"("projectId", "clientVisible");

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_clientOrganizationId_fkey" FOREIGN KEY ("clientOrganizationId") REFERENCES "ClientOrganization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientOrganization" ADD CONSTRAINT "ClientOrganization_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientContact" ADD CONSTRAINT "ClientContact_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientContact" ADD CONSTRAINT "ClientContact_clientOrganizationId_fkey" FOREIGN KEY ("clientOrganizationId") REFERENCES "ClientOrganization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientSession" ADD CONSTRAINT "ClientSession_clientContactId_fkey" FOREIGN KEY ("clientContactId") REFERENCES "ClientContact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientProjectAccess" ADD CONSTRAINT "ClientProjectAccess_clientContactId_fkey" FOREIGN KEY ("clientContactId") REFERENCES "ClientContact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientProjectAccess" ADD CONSTRAINT "ClientProjectAccess_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientProjectAccess" ADD CONSTRAINT "ClientProjectAccess_grantedByMembershipId_fkey" FOREIGN KEY ("grantedByMembershipId") REFERENCES "Membership"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientRequest" ADD CONSTRAINT "ClientRequest_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientRequest" ADD CONSTRAINT "ClientRequest_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientRequest" ADD CONSTRAINT "ClientRequest_clientContactId_fkey" FOREIGN KEY ("clientContactId") REFERENCES "ClientContact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientRequest" ADD CONSTRAINT "ClientRequest_handledByMembershipId_fkey" FOREIGN KEY ("handledByMembershipId") REFERENCES "Membership"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectUpdate" ADD CONSTRAINT "ProjectUpdate_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectUpdate" ADD CONSTRAINT "ProjectUpdate_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectUpdate" ADD CONSTRAINT "ProjectUpdate_authorMembershipId_fkey" FOREIGN KEY ("authorMembershipId") REFERENCES "Membership"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientMessage" ADD CONSTRAINT "ClientMessage_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientMessage" ADD CONSTRAINT "ClientMessage_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientMessage" ADD CONSTRAINT "ClientMessage_authorClientContactId_fkey" FOREIGN KEY ("authorClientContactId") REFERENCES "ClientContact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientMessage" ADD CONSTRAINT "ClientMessage_authorMembershipId_fkey" FOREIGN KEY ("authorMembershipId") REFERENCES "Membership"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientFile" ADD CONSTRAINT "ClientFile_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientFile" ADD CONSTRAINT "ClientFile_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientFile" ADD CONSTRAINT "ClientFile_uploadedByClientContactId_fkey" FOREIGN KEY ("uploadedByClientContactId") REFERENCES "ClientContact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientFile" ADD CONSTRAINT "ClientFile_uploadedByMembershipId_fkey" FOREIGN KEY ("uploadedByMembershipId") REFERENCES "Membership"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
