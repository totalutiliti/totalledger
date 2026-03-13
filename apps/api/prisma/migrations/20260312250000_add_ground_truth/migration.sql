-- CreateTable
CREATE TABLE "ground_truth" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "cartaoPontoId" TEXT NOT NULL,
    "batidaId" TEXT NOT NULL,
    "dia" INTEGER NOT NULL,
    "campo" TEXT NOT NULL,
    "valorDi" TEXT,
    "valorGpt" TEXT,
    "valorSanitizer" TEXT,
    "valorFinal" TEXT,
    "valorHumano" TEXT,
    "acertouDi" BOOLEAN,
    "acertouGpt" BOOLEAN,
    "acertouSanitizer" BOOLEAN,
    "tipoCartao" "TipoCartao" NOT NULL,
    "isManuscrito" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ground_truth_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ground_truth_batidaId_campo_key" ON "ground_truth"("batidaId", "campo");

-- CreateIndex
CREATE INDEX "ground_truth_tenantId_idx" ON "ground_truth"("tenantId");

-- CreateIndex
CREATE INDEX "ground_truth_cartaoPontoId_idx" ON "ground_truth"("cartaoPontoId");

-- AddForeignKey
ALTER TABLE "ground_truth" ADD CONSTRAINT "ground_truth_batidaId_fkey" FOREIGN KEY ("batidaId") REFERENCES "batidas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ground_truth" ADD CONSTRAINT "ground_truth_cartaoPontoId_fkey" FOREIGN KEY ("cartaoPontoId") REFERENCES "cartoes_ponto"("id") ON DELETE CASCADE ON UPDATE CASCADE;
