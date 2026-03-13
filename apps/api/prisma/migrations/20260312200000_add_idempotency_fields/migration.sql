-- AlterEnum: Add PROCESSADO_PARCIAL to UploadStatus
ALTER TYPE "UploadStatus" ADD VALUE 'PROCESSADO_PARCIAL';

-- AlterTable: Upload - add idempotency and tracking fields
ALTER TABLE "uploads" ADD COLUMN     "fileHash" TEXT,
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "paginasProcessadas" INTEGER,
ADD COLUMN     "paginasFalhadas" INTEGER;

-- CreateIndex
CREATE UNIQUE INDEX "uploads_fileHash_key" ON "uploads"("fileHash");

-- AlterTable: CartaoPonto - add skipReason and pipelineVersion
ALTER TABLE "cartoes_ponto" ADD COLUMN     "skipReason" TEXT,
ADD COLUMN     "pipelineVersion" INTEGER NOT NULL DEFAULT 1;
