import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Layer timing names that map to PipelineMetrics columns.
 */
export type LayerName =
  | 'docIntel'
  | 'classifier'
  | 'parser'
  | 'sanitizer'
  | 'scorer'
  | 'consistency'
  | 'gatekeeper'
  | 'gptVision'
  | 'outlier'
  | 'orchestrator'
  | 'gptMini'
  | 'gptVision52'
  | 'imageCropping'
  | 'diRead';

/**
 * Collects timing and counter metrics during pipeline execution.
 * One instance per upload job.
 */
export class MetricsCollector {
  private readonly startTime = Date.now();
  private readonly layerTimings: Partial<Record<LayerName, number>> = {};
  private readonly layerStarts: Partial<Record<LayerName, number>> = {};
  private readonly counters: Record<string, number> = {
    totalBatidas: 0,
    batidasRevisao: 0,
    correcoesSanitizer: 0,
    chamadasGpt: 0,
    gptPuladas: 0,
    gptTokensIn: 0,
    gptTokensOut: 0,
    // New counters for Mini/GPT52 pipeline
    chamadasMini: 0,
    chamadasGpt52: 0,
    gpt52Skipped: 0,
    miniTokensIn: 0,
    miniTokensOut: 0,
    gpt52TokensIn: 0,
    gpt52TokensOut: 0,
  };
  private gptCustoDolar: number | null = null;
  private miniCustoDolar: number | null = null;
  private gpt52CustoDolar: number | null = null;
  private concordanciaDiGpt: number | null = null;
  private classificacaoPaginas: Record<string, number> | null = null;

  startLayer(name: LayerName): void {
    this.layerStarts[name] = Date.now();
  }

  endLayer(name: LayerName): void {
    const start = this.layerStarts[name];
    if (start) {
      const existing = this.layerTimings[name] ?? 0;
      this.layerTimings[name] = existing + (Date.now() - start);
      delete this.layerStarts[name];
    }
  }

  addGptUsage(tokensIn: number, tokensOut: number): void {
    this.counters.gptTokensIn += tokensIn;
    this.counters.gptTokensOut += tokensOut;
    // Approximate cost: GPT-4o pricing ($2.50/1M input, $10/1M output)
    const cost = (tokensIn * 2.5 + tokensOut * 10) / 1_000_000;
    this.gptCustoDolar = (this.gptCustoDolar ?? 0) + cost;
  }

  /**
   * Track GPT-5 Mini token usage and cost.
   * Pricing: ~$0.40/1M input, $1.60/1M output (6x cheaper than GPT-5.2)
   */
  addMiniUsage(tokensIn: number, tokensOut: number): void {
    this.counters.miniTokensIn += tokensIn;
    this.counters.miniTokensOut += tokensOut;
    const cost = (tokensIn * 0.4 + tokensOut * 1.6) / 1_000_000;
    this.miniCustoDolar = (this.miniCustoDolar ?? 0) + cost;
  }

  /**
   * Track GPT-5.2 Vision token usage and cost (fallback).
   * Pricing: ~$2.50/1M input, $10/1M output
   */
  addGpt52Usage(tokensIn: number, tokensOut: number): void {
    this.counters.gpt52TokensIn += tokensIn;
    this.counters.gpt52TokensOut += tokensOut;
    const cost = (tokensIn * 2.5 + tokensOut * 10) / 1_000_000;
    this.gpt52CustoDolar = (this.gpt52CustoDolar ?? 0) + cost;
  }

  increment(counter: string, value = 1): void {
    this.counters[counter] = (this.counters[counter] ?? 0) + value;
  }

  setConcordancia(value: number): void {
    this.concordanciaDiGpt = value;
  }

  setClassificacao(data: Record<string, number>): void {
    this.classificacaoPaginas = data;
  }

  toRecord(): {
    tempoDocIntel: number | null;
    tempoClassifier: number | null;
    tempoParser: number | null;
    tempoSanitizer: number | null;
    tempoScorer: number | null;
    tempoConsistency: number | null;
    tempoGatekeeper: number | null;
    tempoGptVision: number | null;
    tempoOutlier: number | null;
    tempoOrchestrator: number | null;
    tempoGptMini: number | null;
    tempoGptVision52: number | null;
    tempoImageCropping: number | null;
    tempoTotal: number;
    totalBatidas: number;
    batidasRevisao: number;
    correcoesSanitizer: number;
    chamadasGpt: number;
    gptPuladas: number;
    gptTokensIn: number;
    gptTokensOut: number;
    gptCustoDolar: number | null;
    chamadasMini: number;
    chamadasGpt52: number;
    gpt52Skipped: number;
    miniTokensIn: number;
    miniTokensOut: number;
    gpt52TokensIn: number;
    gpt52TokensOut: number;
    miniCustoDolar: number | null;
    gpt52CustoDolar: number | null;
    concordanciaDiGpt: number | null;
    classificacaoPaginas: object | null;
  } {
    return {
      tempoDocIntel: this.layerTimings.docIntel ?? null,
      tempoClassifier: this.layerTimings.classifier ?? null,
      tempoParser: this.layerTimings.parser ?? null,
      tempoSanitizer: this.layerTimings.sanitizer ?? null,
      tempoScorer: this.layerTimings.scorer ?? null,
      tempoConsistency: this.layerTimings.consistency ?? null,
      tempoGatekeeper: this.layerTimings.gatekeeper ?? null,
      tempoGptVision: this.layerTimings.gptVision ?? null,
      tempoOutlier: this.layerTimings.outlier ?? null,
      tempoOrchestrator: this.layerTimings.orchestrator ?? null,
      tempoGptMini: this.layerTimings.gptMini ?? null,
      tempoGptVision52: this.layerTimings.gptVision52 ?? null,
      tempoImageCropping: this.layerTimings.imageCropping ?? null,
      tempoTotal: Date.now() - this.startTime,
      totalBatidas: this.counters.totalBatidas,
      batidasRevisao: this.counters.batidasRevisao,
      correcoesSanitizer: this.counters.correcoesSanitizer,
      chamadasGpt: this.counters.chamadasGpt,
      gptPuladas: this.counters.gptPuladas,
      gptTokensIn: this.counters.gptTokensIn,
      gptTokensOut: this.counters.gptTokensOut,
      gptCustoDolar: this.gptCustoDolar,
      chamadasMini: this.counters.chamadasMini,
      chamadasGpt52: this.counters.chamadasGpt52,
      gpt52Skipped: this.counters.gpt52Skipped,
      miniTokensIn: this.counters.miniTokensIn,
      miniTokensOut: this.counters.miniTokensOut,
      gpt52TokensIn: this.counters.gpt52TokensIn,
      gpt52TokensOut: this.counters.gpt52TokensOut,
      miniCustoDolar: this.miniCustoDolar,
      gpt52CustoDolar: this.gpt52CustoDolar,
      concordanciaDiGpt: this.concordanciaDiGpt,
      classificacaoPaginas: this.classificacaoPaginas as object | null,
    };
  }
}

@Injectable()
export class OcrMetricsService {
  private readonly logger = new Logger(OcrMetricsService.name);

  constructor(private readonly prisma: PrismaService) {}

  createCollector(): MetricsCollector {
    return new MetricsCollector();
  }

  async save(
    tenantId: string,
    uploadId: string,
    totalPaginas: number,
    paginasProcessadas: number,
    paginasFalhadas: number,
    paginasIgnoradas: number,
    collector: MetricsCollector,
  ): Promise<void> {
    const raw = collector.toRecord();

    // Prisma requires Prisma.JsonNull instead of plain null for Json? fields
    const classificacaoPaginas = raw.classificacaoPaginas ?? Prisma.JsonNull;
    const metrics = { ...raw, classificacaoPaginas };

    // Upsert to handle reprocessing
    await this.prisma.pipelineMetrics.upsert({
      where: { uploadId },
      create: {
        tenantId,
        uploadId,
        totalPaginas,
        paginasProcessadas,
        paginasFalhadas,
        paginasIgnoradas,
        ...metrics,
      },
      update: {
        totalPaginas,
        paginasProcessadas,
        paginasFalhadas,
        paginasIgnoradas,
        ...metrics,
      },
    });

    this.logger.log('[Metrics] Pipeline metrics saved', {
      tenantId,
      uploadId,
      tempoTotal: metrics.tempoTotal,
      chamadasGpt: metrics.chamadasGpt,
      gptPuladas: metrics.gptPuladas,
      gptCustoDolar: metrics.gptCustoDolar,
      chamadasMini: metrics.chamadasMini,
      chamadasGpt52: metrics.chamadasGpt52,
      gpt52Skipped: metrics.gpt52Skipped,
      miniCustoDolar: metrics.miniCustoDolar,
      gpt52CustoDolar: metrics.gpt52CustoDolar,
    });
  }
}
