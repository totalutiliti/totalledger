-- CreateTable
CREATE TABLE "pipeline_metrics" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "uploadId" TEXT NOT NULL,
    "totalPaginas" INTEGER NOT NULL,
    "paginasProcessadas" INTEGER NOT NULL,
    "paginasFalhadas" INTEGER NOT NULL,
    "paginasIgnoradas" INTEGER NOT NULL DEFAULT 0,
    "tempoDocIntel" INTEGER,
    "tempoClassifier" INTEGER,
    "tempoParser" INTEGER,
    "tempoSanitizer" INTEGER,
    "tempoScorer" INTEGER,
    "tempoConsistency" INTEGER,
    "tempoGatekeeper" INTEGER,
    "tempoGptVision" INTEGER,
    "tempoOutlier" INTEGER,
    "tempoOrchestrator" INTEGER,
    "tempoTotal" INTEGER NOT NULL,
    "totalBatidas" INTEGER NOT NULL DEFAULT 0,
    "batidasRevisao" INTEGER NOT NULL DEFAULT 0,
    "correcoesSanitizer" INTEGER NOT NULL DEFAULT 0,
    "chamadasGpt" INTEGER NOT NULL DEFAULT 0,
    "gptPuladas" INTEGER NOT NULL DEFAULT 0,
    "gptTokensIn" INTEGER NOT NULL DEFAULT 0,
    "gptTokensOut" INTEGER NOT NULL DEFAULT 0,
    "gptCustoDolar" DOUBLE PRECISION,
    "concordanciaDiGpt" DOUBLE PRECISION,
    "classificacaoPaginas" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pipeline_metrics_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "pipeline_metrics_uploadId_key" ON "pipeline_metrics"("uploadId");

-- CreateIndex
CREATE INDEX "pipeline_metrics_tenantId_idx" ON "pipeline_metrics"("tenantId");

-- AddForeignKey
ALTER TABLE "pipeline_metrics" ADD CONSTRAINT "pipeline_metrics_uploadId_fkey" FOREIGN KEY ("uploadId") REFERENCES "uploads"("id") ON DELETE CASCADE ON UPDATE CASCADE;
