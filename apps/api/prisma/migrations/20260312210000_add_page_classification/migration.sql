-- CreateEnum
CREATE TYPE "PageType" AS ENUM ('CARTAO_PONTO_MENSAL', 'CARTAO_PONTO_QUINZENAL', 'ESPELHO_PONTO', 'PAGINA_ASSINATURA', 'PAGINA_SEM_TABELA', 'PAGINA_FINANCEIRA', 'DOCUMENTO_DESCONHECIDO');

-- CreateTable
CREATE TABLE "page_classifications" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "uploadId" TEXT NOT NULL,
    "paginaPdf" INTEGER NOT NULL,
    "pageType" "PageType" NOT NULL,
    "subFormat" TEXT,
    "confidence" DOUBLE PRECISION NOT NULL,
    "shouldProcess" BOOLEAN NOT NULL DEFAULT true,
    "classifierData" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "page_classifications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "page_classifications_tenantId_idx" ON "page_classifications"("tenantId");

-- CreateIndex
CREATE INDEX "page_classifications_uploadId_idx" ON "page_classifications"("uploadId");

-- CreateIndex
CREATE UNIQUE INDEX "page_classifications_uploadId_paginaPdf_key" ON "page_classifications"("uploadId", "paginaPdf");

-- AddForeignKey
ALTER TABLE "page_classifications" ADD CONSTRAINT "page_classifications_uploadId_fkey" FOREIGN KEY ("uploadId") REFERENCES "uploads"("id") ON DELETE CASCADE ON UPDATE CASCADE;
