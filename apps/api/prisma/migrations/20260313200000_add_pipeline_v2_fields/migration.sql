-- Pipeline v2: Multi-Extrator com Votacao
-- Adiciona campos para suportar 3x Mini + votacao + fallback 5.2

-- OcrFeedback: campos v2
ALTER TABLE "ocr_feedback" ADD COLUMN "valorMiniA" TEXT;
ALTER TABLE "ocr_feedback" ADD COLUMN "valorMiniB" TEXT;
ALTER TABLE "ocr_feedback" ADD COLUMN "valorMiniC" TEXT;
ALTER TABLE "ocr_feedback" ADD COLUMN "fonteDecisao" TEXT;
ALTER TABLE "ocr_feedback" ADD COLUMN "usouFallback" BOOLEAN NOT NULL DEFAULT false;

-- CartaoPonto: campos de agrupamento quinzenal
ALTER TABLE "cartoes_ponto" ADD COLUMN "tipoCartaoFormato" TEXT NOT NULL DEFAULT 'mensal';
ALTER TABLE "cartoes_ponto" ADD COLUMN "paginaVerso" INTEGER;
ALTER TABLE "cartoes_ponto" ADD COLUMN "mergeValidado" BOOLEAN NOT NULL DEFAULT true;

-- PipelineMetrics: campos v2
ALTER TABLE "pipeline_metrics" ADD COLUMN "pipelineVersion" TEXT NOT NULL DEFAULT 'v1';
ALTER TABLE "pipeline_metrics" ADD COLUMN "paginasResolvidasVotacao" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "pipeline_metrics" ADD COLUMN "paginasFallback52" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "pipeline_metrics" ADD COLUMN "taxaConcordancia3de3" DOUBLE PRECISION;
ALTER TABLE "pipeline_metrics" ADD COLUMN "taxaConcordancia2de3" DOUBLE PRECISION;
ALTER TABLE "pipeline_metrics" ADD COLUMN "taxaDivergenciaTotal" DOUBLE PRECISION;
ALTER TABLE "pipeline_metrics" ADD COLUMN "custoEstimadoMini" DOUBLE PRECISION;
ALTER TABLE "pipeline_metrics" ADD COLUMN "custoEstimadoDI" DOUBLE PRECISION;
ALTER TABLE "pipeline_metrics" ADD COLUMN "custoEstimado52" DOUBLE PRECISION;
ALTER TABLE "pipeline_metrics" ADD COLUMN "custoEstimadoTotal" DOUBLE PRECISION;
