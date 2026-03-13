-- AlterTable: CartaoPonto - add review priority fields
ALTER TABLE "cartoes_ponto" ADD COLUMN     "prioridadeRevisao" DOUBLE PRECISION,
ADD COLUMN     "prioridadeMotivos" JSONB;

-- CreateIndex
CREATE INDEX "cartoes_ponto_tenantId_statusRevisao_prioridadeRevisao_idx" ON "cartoes_ponto"("tenantId", "statusRevisao", "prioridadeRevisao");
