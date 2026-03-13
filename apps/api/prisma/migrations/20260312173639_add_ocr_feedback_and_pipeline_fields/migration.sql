-- AlterTable
ALTER TABLE "batidas" ADD COLUMN     "consistencyIssues" JSONB,
ADD COLUMN     "gptFailed" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "outlierFlags" JSONB;

-- CreateTable
CREATE TABLE "ocr_feedback" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "batidaId" TEXT NOT NULL,
    "cartaoPontoId" TEXT NOT NULL,
    "dia" INTEGER NOT NULL,
    "campo" TEXT NOT NULL,
    "valorDi" TEXT,
    "valorGpt" TEXT,
    "valorFinal" TEXT,
    "valorHumano" TEXT,
    "concordaDiGpt" BOOLEAN,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ocr_feedback_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ocr_feedback_tenantId_idx" ON "ocr_feedback"("tenantId");

-- CreateIndex
CREATE INDEX "ocr_feedback_batidaId_idx" ON "ocr_feedback"("batidaId");

-- CreateIndex
CREATE INDEX "ocr_feedback_cartaoPontoId_idx" ON "ocr_feedback"("cartaoPontoId");

-- AddForeignKey
ALTER TABLE "ocr_feedback" ADD CONSTRAINT "ocr_feedback_batidaId_fkey" FOREIGN KEY ("batidaId") REFERENCES "batidas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ocr_feedback" ADD CONSTRAINT "ocr_feedback_cartaoPontoId_fkey" FOREIGN KEY ("cartaoPontoId") REFERENCES "cartoes_ponto"("id") ON DELETE CASCADE ON UPDATE CASCADE;
