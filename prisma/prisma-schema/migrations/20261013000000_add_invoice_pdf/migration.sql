-- AlterTable
ALTER TABLE "ClientInvoice" ADD COLUMN     "pdfGeneratedAt" TIMESTAMP(3),
ADD COLUMN     "pdfPublicId" TEXT,
ADD COLUMN     "pdfUrl" TEXT;
