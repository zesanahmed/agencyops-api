-- DropForeignKey
ALTER TABLE "ClientFile" DROP CONSTRAINT "ClientFile_uploadedByMembershipId_fkey";

-- DropForeignKey
ALTER TABLE "ClientMessage" DROP CONSTRAINT "ClientMessage_authorMembershipId_fkey";

-- AddForeignKey
ALTER TABLE "ClientMessage" ADD CONSTRAINT "ClientMessage_authorMembershipId_fkey" FOREIGN KEY ("authorMembershipId") REFERENCES "Membership"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientFile" ADD CONSTRAINT "ClientFile_uploadedByMembershipId_fkey" FOREIGN KEY ("uploadedByMembershipId") REFERENCES "Membership"("id") ON DELETE SET NULL ON UPDATE CASCADE;
