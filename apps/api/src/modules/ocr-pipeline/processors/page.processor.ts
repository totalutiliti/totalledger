import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { ConfigService } from '@nestjs/config';
import { StatusRevisao } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { GptMiniExtractorService } from '../gpt-mini-extractor.service';
import { GptVisionValidatorService } from '../gpt-vision-validator.service';
import { ConsistencyValidatorService } from '../consistency-validator.service';
import { OutlierDetectorService, OutlierFlag } from '../outlier-detector.service';
import { DecisionOrchestratorService } from '../decision-orchestrator.service';
import { ImageCropperService } from '../image-cropper.service';
import { TenantOcrConfigService } from '../tenant-ocr-config.service';
import { PipelineV2OrchestratorService } from '../pipeline-v2-orchestrator.service';
import {
  PageJobData,
  CartaoJobData,
  PageProcessingResult,
  PreOrchestratedBatida,
  OrchestratedBatida,
  FallbackTriggerResult,
  MiniDiaResult,
  Gpt52DiaResult,
  TIME_FIELDS,
  DiReadResult,
  V2OcrFeedbackData,
} from '../ocr-pipeline.types';
// ScoredBatida is used internally via GptMiniExtractorService.toScoredBatidas()
import { ValidatedBatida } from '../consistency-validator.service';

/**
 * Processador por pagina — roda o pipeline completo para UMA pagina.
 * Executa em paralelo com concorrencia controlada.
 *
 * Fluxo:
 * 1. GPT-5 Mini extraction (primario)
 * 2. ConsistencyValidator
 * 3. OutlierDetector
 * 4. Avaliar necessidade de fallback GPT-5.2
 * 5. [Condicional] GPT-5.2 com crop de celula + anti-ancoragem
 * 6. DecisionOrchestrator
 * 7. Salvar CartaoPonto + Batidas + OcrFeedback
 */
@Processor('ocr-page-queue', { concurrency: 8 })
export class PageProcessor extends WorkerHost {
  private readonly logger = new Logger(PageProcessor.name);
  private readonly pipelineVersion: 'v1' | 'v2';

  constructor(
    private readonly prisma: PrismaService,
    private readonly miniExtractor: GptMiniExtractorService,
    private readonly gpt52Validator: GptVisionValidatorService,
    private readonly consistencyValidator: ConsistencyValidatorService,
    private readonly outlierDetector: OutlierDetectorService,
    private readonly decisionOrchestrator: DecisionOrchestratorService,
    private readonly imageCropper: ImageCropperService,
    private readonly tenantOcrConfig: TenantOcrConfigService,
    private readonly pipelineV2Orchestrator: PipelineV2OrchestratorService,
    private readonly configService: ConfigService,
  ) {
    super();
    this.pipelineVersion = this.configService.get<'v1' | 'v2'>(
      'PIPELINE_VERSION',
      'v1',
    );
    this.logger.log(`PageProcessor initialized with pipeline ${this.pipelineVersion}`);
  }

  async process(job: Job<PageJobData | CartaoJobData>): Promise<PageProcessingResult> {
    // Route card-level jobs (v2 grouped cards)
    if ('cartaoId' in job.data) {
      return this.processCard(job as Job<CartaoJobData>);
    }

    const { uploadId, tenantId, pageNumber, classificationData } = job.data as PageJobData;

    this.logger.log(`[Page:${pageNumber}] Iniciando processamento`, {
      tenantId,
      uploadId,
      pageNumber,
      pageType: classificationData.pageType,
    });

    try {
      // Load tenant config
      const ocrConfig = await this.tenantOcrConfig.getConfig(tenantId);

      // Decode page image from base64
      const pageImageBuffer = Buffer.from(job.data.pageImageBase64, 'base64');

      // Cleanup previous data for this page (idempotency)
      await this.cleanupPreviousData(uploadId, pageNumber);

      // ===== Pipeline v2: Multi-Extrator com Votacao =====
      if (this.pipelineVersion === 'v2') {
        return this.processV2(
          job.data as PageJobData,
          pageImageBuffer,
          ocrConfig,
        );
      }

      // ===== Pipeline v1 (abaixo) =====
      // ===== STEP 1: GPT-5 Mini extraction (PRIMARY) =====
      const miniResult = await this.miniExtractor.extract(
        pageImageBuffer,
        pageNumber,
        job.data.diTextContent,
      );

      const scored = this.miniExtractor.toScoredBatidas(miniResult);

      const tipoCartao = scored.some((b) => b.isManuscrito)
        ? ('MANUSCRITO' as const)
        : ('ELETRONICO' as const);

      this.logger.log(`[Page:${pageNumber}] Mini extraction done`, {
        dias: scored.length,
        miniFailed: miniResult.miniFailed,
        tokensIn: miniResult.tokensIn,
        tokensOut: miniResult.tokensOut,
      });

      // ===== STEP 2: Consistency Validation =====
      const validated = this.consistencyValidator.validate(scored);

      // ===== STEP 3: Outlier Detection =====
      const outlierResult = this.outlierDetector.detect(validated);

      // ===== STEP 4: Evaluate fallback triggers =====
      const fallback = this.evaluateFallback(
        validated,
        outlierResult.batidaFlags,
        classificationData.subFormat,
        ocrConfig.reviewThreshold,
      );

      // ===== STEP 5: [Conditional] GPT-5.2 fallback =====
      let gpt52Results: Map<number, Gpt52DiaResult> = new Map();
      let usedFallback = false;

      if (fallback.trigger && !miniResult.miniFailed) {
        usedFallback = true;
        this.logger.log(`[Page:${pageNumber}] Fallback GPT-5.2 triggered`, {
          problematicDays: fallback.problematicDays,
          reasons: fallback.reasons,
        });

        // Crop images for problematic day rows
        const totalDataRows = scored.length;
        const croppedImages = await this.imageCropper.cropDayRows(
          pageImageBuffer,
          fallback.problematicDays,
          totalDataRows,
        );

        if (croppedImages.size > 0) {
          // Collect Mini hypothesis for problematic days
          const miniHypothesis = fallback.problematicDays
            .map((day) => miniResult.dias.find((d) => d.dia === day))
            .filter((d): d is MiniDiaResult => d !== undefined);

          const croppedBuffers = fallback.problematicDays
            .map((day) => croppedImages.get(day))
            .filter((b): b is Buffer => b !== undefined);

          if (croppedBuffers.length > 0 && miniHypothesis.length > 0) {
            const gpt52Result = await this.gpt52Validator.verifyProblematicDays(
              croppedBuffers,
              miniHypothesis,
              fallback.problematicDays,
              pageNumber,
            );

            if (!gpt52Result.gpt52Failed) {
              for (const dia of gpt52Result.dias) {
                gpt52Results.set(dia.dia, dia);
              }
            }
          }
        }
      }

      // ===== STEP 6: Build PreOrchestratedBatida[] =====
      const preOrchestrated: PreOrchestratedBatida[] = validated.map((v, idx) => {
        const miniDia = miniResult.dias[idx];
        const gpt52Dia = gpt52Results.get(v.dia);

        return {
          ...v,
          miniResult: miniDia,
          miniFailed: miniResult.miniFailed,
          consistencyIssues: v.consistencyIssues,
          gpt52Result: gpt52Dia,
          gpt52Failed: usedFallback && gpt52Results.size === 0,
        };
      });

      // ===== STEP 7: Decision Orchestrator =====
      const orchestrated = this.decisionOrchestrator.orchestrate(
        preOrchestrated,
        outlierResult.batidaFlags,
      );

      // ===== STEP 8: Calculate overall confidence =====
      const confiancaGeral = this.computeConfidence(orchestrated);

      // ===== STEP 9: Save to database =====
      const cartaoPonto = await this.saveResults(
        tenantId,
        uploadId,
        pageNumber,
        miniResult.header,
        tipoCartao,
        confiancaGeral,
        orchestrated,
        outlierResult.batidaFlags,
        usedFallback,
      );

      this.logger.log(`[Page:${pageNumber}] Processamento concluido`, {
        cartaoPontoId: cartaoPonto.id,
        confiancaGeral,
        batidasCount: orchestrated.length,
        tipoCartao,
        usedFallback,
        fallbackDays: fallback.problematicDays.length,
        needsReviewCount: orchestrated.filter((b) => b.needsReview).length,
      });

      return {
        pageNumber,
        success: true,
        cartaoPontoId: cartaoPonto.id,
        usedFallback,
        fallbackDays: fallback.problematicDays,
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Erro desconhecido';
      const stack = error instanceof Error ? error.stack : undefined;

      this.logger.error(
        `[Page:${pageNumber}] Falha: ${message}`,
        stack,
        { tenantId, uploadId, pageNumber },
      );

      // Save error CartaoPonto for traceability
      try {
        await this.prisma.cartaoPonto.create({
          data: {
            tenantId,
            uploadId,
            paginaPdf: pageNumber,
            skipReason: message,
            confiancaGeral: 0,
          },
        });
      } catch {
        // Already exists — ignore
      }

      return {
        pageNumber,
        success: false,
        skipReason: message,
      };
    }
  }

  // ──────────────────────────────────────────────
  // Fallback evaluation
  // ──────────────────────────────────────────────

  private evaluateFallback(
    validated: ValidatedBatida[],
    outlierFlags: OutlierFlag[][],
    _subFormat: string | null,
    reviewThreshold: number,
  ): FallbackTriggerResult {
    const problematicDays = new Set<number>();
    const reasons: string[] = [];

    for (let i = 0; i < validated.length; i++) {
      const batida = validated[i];
      const flags = outlierFlags[i] ?? [];

      // Calculate average confidence for this day
      const confValues = Object.values(batida.confianca).filter((v) => v > 0);
      const avgConf = confValues.length > 0
        ? confValues.reduce((a, b) => a + b, 0) / confValues.length
        : 0;

      // Trigger 1: Mini confidence below threshold
      if (avgConf > 0 && avgConf < reviewThreshold) {
        problematicDays.add(batida.dia);
        reasons.push(`Dia ${batida.dia}: Mini confianca ${avgConf.toFixed(2)} < ${reviewThreshold}`);
      }

      // Trigger 2: Consistency penalty >= 0.25
      const hasHighPenalty = batida.consistencyIssues.some((i) => i.penalty >= 0.25);
      if (hasHighPenalty) {
        problematicDays.add(batida.dia);
        reasons.push(`Dia ${batida.dia}: Penalidade consistencia >= 0.25`);
      }

      // Trigger 3: Outlier with low confidence
      if (flags.length > 0 && avgConf < 0.80) {
        problematicDays.add(batida.dia);
        reasons.push(`Dia ${batida.dia}: Outlier com confianca < 0.80`);
      }

      // Trigger 4: Manuscrito with low Mini score
      if (batida.isManuscrito && avgConf > 0 && avgConf < 0.85) {
        problematicDays.add(batida.dia);
        reasons.push(`Dia ${batida.dia}: Manuscrito com confianca ${avgConf.toFixed(2)} < 0.85`);
      }
    }

    return {
      trigger: problematicDays.size > 0,
      problematicDays: [...problematicDays].sort((a, b) => a - b),
      reasons,
    };
  }

  // ──────────────────────────────────────────────
  // Database operations
  // ──────────────────────────────────────────────

  private async cleanupPreviousData(uploadId: string, pageNumber: number): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const existingCartao = await tx.cartaoPonto.findFirst({
        where: { uploadId, paginaPdf: pageNumber },
        select: { id: true },
      });

      if (existingCartao) {
        await tx.ocrFeedback.deleteMany({ where: { cartaoPontoId: existingCartao.id } });
        await tx.batida.deleteMany({ where: { cartaoPontoId: existingCartao.id } });
        await tx.revisao.deleteMany({ where: { cartaoPontoId: existingCartao.id } });
        await tx.cartaoPonto.delete({ where: { id: existingCartao.id } });
      }
    });
  }

  private async saveResults(
    tenantId: string,
    uploadId: string,
    pageNumber: number,
    header: { nomeExtraido: string | null; cargoExtraido: string | null; mesExtraido: string | null; empresaExtraida: string | null; cnpjExtraido: string | null; horarioContratual: string | null },
    tipoCartao: 'MANUSCRITO' | 'ELETRONICO',
    confiancaGeral: number,
    orchestrated: OrchestratedBatida[],
    outlierFlags: OutlierFlag[][],
    usedFallback: boolean,
  ): Promise<{ id: string }> {
    const cartaoPonto = await this.prisma.cartaoPonto.create({
      data: {
        tenantId,
        uploadId,
        paginaPdf: pageNumber,
        nomeExtraido: header.nomeExtraido,
        cargoExtraido: header.cargoExtraido,
        mesExtraido: header.mesExtraido,
        empresaExtraida: header.empresaExtraida,
        cnpjExtraido: header.cnpjExtraido,
        horarioContratual: header.horarioContratual,
        tipoCartao: tipoCartao as import('@prisma/client').TipoCartao,
        statusRevisao: StatusRevisao.PENDENTE,
        confiancaGeral,
        ocrRawData: {
          source: 'gpt-mini-primary',
          usedFallback,
          miniExtraction: orchestrated.map((b) => b.miniResult),
        } as object,
      },
    });

    for (let i = 0; i < orchestrated.length; i++) {
      const batida = orchestrated[i];
      const dayOutlierFlags = outlierFlags[i] ?? [];

      const savedBatida = await this.prisma.batida.create({
        data: {
          tenantId,
          cartaoPontoId: cartaoPonto.id,
          dia: batida.dia,
          diaSemana: batida.diaSemana,
          entradaManha: batida.entradaManha,
          saidaManha: batida.saidaManha,
          entradaTarde: batida.entradaTarde,
          saidaTarde: batida.saidaTarde,
          entradaExtra: batida.entradaExtra,
          saidaExtra: batida.saidaExtra,
          confianca: batida.confianca as object,
          isManuscrito: batida.isManuscrito,
          isInconsistente: batida.isInconsistente,
          isFaltaDia: batida.isFaltaDia,
          gptFailed: batida.miniFailed,
          consistencyIssues:
            batida.consistencyIssues.length > 0
              ? (batida.consistencyIssues as object[])
              : undefined,
          outlierFlags:
            dayOutlierFlags.length > 0
              ? (dayOutlierFlags as object[])
              : undefined,
        },
      });

      // Create OcrFeedback records
      await this.createOcrFeedback(tenantId, savedBatida.id, cartaoPonto.id, batida);
    }

    // Compute review priority
    const { prioridade, motivos } = this.computePrioridade(
      confiancaGeral,
      orchestrated,
      outlierFlags,
      tipoCartao === 'MANUSCRITO',
    );

    await this.prisma.cartaoPonto.update({
      where: { id: cartaoPonto.id },
      data: {
        prioridadeRevisao: prioridade,
        prioridadeMotivos: motivos as unknown as object[],
      },
    });

    return { id: cartaoPonto.id };
  }

  private async createOcrFeedback(
    tenantId: string,
    batidaId: string,
    cartaoPontoId: string,
    batida: OrchestratedBatida,
  ): Promise<void> {
    const feedbackData: {
      tenantId: string;
      batidaId: string;
      cartaoPontoId: string;
      dia: number;
      campo: string;
      valorDi: string | null;
      valorGpt: string | null;
      valorFinal: string | null;
      concordaDiGpt: boolean | null;
    }[] = [];

    for (const field of TIME_FIELDS) {
      const miniField = batida.miniResult[field];
      const gpt52Field = batida.gpt52Result?.[field];

      const finalValue = (batida as unknown as Record<string, string | null>)[field];
      const valorMini = miniField?.valor ?? null;
      const valorGpt52 = gpt52Field?.valor ?? null;

      if (!finalValue && !valorMini && !valorGpt52) continue;

      feedbackData.push({
        tenantId,
        batidaId,
        cartaoPontoId,
        dia: batida.dia,
        campo: field,
        // Semantica: valorDi = Mini (extrator primario), valorGpt = GPT-5.2 (fallback)
        valorDi: valorMini,
        valorGpt: valorGpt52,
        valorFinal: finalValue,
        concordaDiGpt: gpt52Field?.concordaMini ?? null,
      });
    }

    if (feedbackData.length > 0) {
      await this.prisma.ocrFeedback.createMany({ data: feedbackData });
    }
  }

  // ──────────────────────────────────────────────
  // Helpers
  // ──────────────────────────────────────────────

  private computeConfidence(batidas: OrchestratedBatida[]): number {
    if (batidas.length === 0) return 0;
    const allScores = batidas.flatMap((b) =>
      Object.values(b.confianca).filter((v) => v > 0),
    );
    if (allScores.length === 0) return 0;
    return allScores.reduce((sum, v) => sum + v, 0) / allScores.length;
  }

  private computePrioridade(
    confiancaGeral: number,
    batidas: OrchestratedBatida[],
    outlierFlags: OutlierFlag[][],
    isManuscrito: boolean,
  ): { prioridade: number; motivos: string[] } {
    const motivos: string[] = [];

    let score = (1 - confiancaGeral) * 40;
    if (confiancaGeral < 0.70) {
      motivos.push(`Confianca baixa (${(confiancaGeral * 100).toFixed(0)}%)`);
    }

    let errors = 0;
    let warnings = 0;
    for (const b of batidas) {
      for (const issue of b.consistencyIssues) {
        if (issue.severity === 'error') errors++;
        else if (issue.severity === 'warning') warnings++;
      }
    }
    score += errors * 15;
    score += warnings * 5;
    if (errors > 0) motivos.push(`${errors} erro(s) consistencia`);
    if (warnings > 0) motivos.push(`${warnings} alerta(s) consistencia`);

    const outlierErrors = outlierFlags
      .flat()
      .filter((f) => f.severity === 'error').length;
    score += outlierErrors * 10;
    if (outlierErrors > 0) motivos.push(`${outlierErrors} outlier(s) critico(s)`);

    if (isManuscrito) {
      score += 10;
      motivos.push('Cartao manuscrito');
    }

    return {
      prioridade: parseFloat(score.toFixed(2)),
      motivos,
    };
  }

  // ──────────────────────────────────────────────
  // Pipeline v2: Card-level processing
  // ──────────────────────────────────────────────

  /**
   * Process a grouped card job (v2 card-grouping flow).
   * Handles both mensal (1 page) and quinzenal (2 pages → merged).
   */
  private async processCard(job: Job<CartaoJobData>): Promise<PageProcessingResult> {
    const { uploadId, tenantId, cartaoId, tipo, paginas, diReadResults } = job.data;
    const primaryPage = paginas[0].pageNumber;

    this.logger.log(`[Card:${cartaoId}] Processando cartao ${tipo}`, {
      tenantId,
      uploadId,
      tipo,
      paginas: paginas.map((p) => p.pageNumber),
    });

    try {
      const ocrConfig = await this.tenantOcrConfig.getConfig(tenantId);

      // Cleanup previous data for all pages in this card
      for (const p of paginas) {
        await this.cleanupPreviousData(uploadId, p.pageNumber);
      }

      // Build DI Read pre-computed map
      const diReadMap = new Map<number, DiReadResult>();
      for (const [pageNumStr, diResult] of Object.entries(diReadResults)) {
        diReadMap.set(Number(pageNumStr), diResult);
      }

      // Build DI Clean Table map
      const diCleanTableMap = new Map<number, string>();
      if (job.data.diCleanTables) {
        for (const [pageNumStr, table] of Object.entries(job.data.diCleanTables)) {
          diCleanTableMap.set(Number(pageNumStr), table);
        }
      }

      if (tipo === 'mensal' || paginas.length === 1) {
        const pag = paginas[0];
        const diCleanTable = diCleanTableMap.get(pag.pageNumber);

        // ===== Pipeline v3: DI Clean + GPT-5.2 direto (se tabela disponivel) =====
        if (diCleanTable) {
          return this.processV3(
            uploadId,
            tenantId,
            pag.pageNumber,
            pag.pageImageBase64,
            diCleanTable,
            ocrConfig,
            tipo,
          );
        }

        // ===== Fallback: Pipeline v2 (sem tabela limpa) =====
        let diReadPreComputado: DiReadResult | undefined = diReadMap.get(pag.pageNumber);
        if (!diReadPreComputado && pag.diTextContent) {
          diReadPreComputado = { textoCompleto: pag.diTextContent, linhas: [] };
        }

        const pageJobData: PageJobData = {
          uploadId,
          tenantId,
          pageNumber: pag.pageNumber,
          pageImageBase64: pag.pageImageBase64,
          diTextContent: pag.diTextContent,
          classificationData: pag.classificationData,
          tableCellBounds: pag.tableCellBounds,
        };

        return this.processV2(
          pageJobData,
          Buffer.from(pag.pageImageBase64, 'base64'),
          ocrConfig,
        );
      }

      // ===== Quinzenal: 2 pages → merge =====
      const pagFrente = paginas[0];
      const pagVerso = paginas[1];
      const cleanTableFrente = diCleanTableMap.get(pagFrente.pageNumber);
      const cleanTableVerso = diCleanTableMap.get(pagVerso.pageNumber);

      // ===== Pipeline v3 quinzenal (se ambas paginas tem tabela) =====
      if (cleanTableFrente && cleanTableVerso) {
        const result = await this.pipelineV2Orchestrator.processarCartaoQuinzenalDirect(
          {
            imagemBase64: pagFrente.pageImageBase64,
            diCleanTable: cleanTableFrente,
          },
          {
            imagemBase64: pagVerso.pageImageBase64,
            diCleanTable: cleanTableVerso,
          },
          pagFrente.pageNumber,
          pagVerso.pageNumber,
          ocrConfig,
        );

        // Save and return (same flow as before)
        return this.saveCardResult(
          tenantId, uploadId, pagFrente.pageNumber, pagVerso.pageNumber,
          cartaoId, result, primaryPage,
        );
      }

      // ===== Fallback: Pipeline v2 quinzenal =====
      const pdfBuffer = Buffer.from(job.data.pdfBufferBase64, 'base64');

      const result = await this.pipelineV2Orchestrator.processarCartaoQuinzenal(
        {
          imagemBase64: pagFrente.pageImageBase64,
          diRead: diReadMap.get(pagFrente.pageNumber),
        },
        {
          imagemBase64: pagVerso.pageImageBase64,
          diRead: diReadMap.get(pagVerso.pageNumber),
        },
        pdfBuffer,
        pagFrente.pageNumber,
        pagVerso.pageNumber,
        ocrConfig,
      );

      // Save CartaoPonto for quinzenal merged card
      const isManuscrito = result.batidas.some((b) => b.isManuscrito);
      const tipoCartao = isManuscrito ? 'MANUSCRITO' as const : 'ELETRONICO' as const;

      // Note: paginaVerso, pipelineVersion, tipoCartaoFormato, mergeValidado
      // are v2 migration fields — cast needed until Prisma client is regenerated
      const cartaoPontoData = {
        tenantId,
        uploadId,
        paginaPdf: pagFrente.pageNumber,
        paginaVerso: pagVerso.pageNumber,
        nomeExtraido: result.cabecalho.nome,
        cargoExtraido: result.cabecalho.cargo,
        mesExtraido: result.cabecalho.mes,
        empresaExtraida: result.cabecalho.empresa,
        cnpjExtraido: result.cabecalho.cnpj,
        horarioContratual: result.cabecalho.horarioContratual?.segSex ?? null,
        tipoCartao: tipoCartao as import('@prisma/client').TipoCartao,
        statusRevisao: 'PENDENTE' as import('@prisma/client').StatusRevisao,
        confiancaGeral: result.confiancaGeral,
        pipelineVersion: 2,
        tipoCartaoFormato: 'quinzenal',
        mergeValidado: true,
        ocrRawData: {
          source: 'pipeline-v2-quinzenal-merge',
          usou5_2: result.usou5_2,
          estatisticas: result.estatisticas,
          paginaFrente: pagFrente.pageNumber,
          paginaVerso: pagVerso.pageNumber,
        } as object,
      };
      const cartaoPonto = await this.prisma.cartaoPonto.create({
        data: cartaoPontoData as import('@prisma/client').Prisma.CartaoPontoUncheckedCreateInput,
      });

      // Save Batidas
      const outlierResult = this.outlierDetector.detect(
        this.consistencyValidator.validate(result.batidas),
      );

      for (let i = 0; i < result.batidas.length; i++) {
        const batida = result.batidas[i];
        const dayOutlierFlags = outlierResult.batidaFlags[i] ?? [];

        const savedBatida = await this.prisma.batida.create({
          data: {
            tenantId,
            cartaoPontoId: cartaoPonto.id,
            dia: batida.dia,
            diaSemana: batida.diaSemana,
            entradaManha: batida.entradaManha,
            saidaManha: batida.saidaManha,
            entradaTarde: batida.entradaTarde,
            saidaTarde: batida.saidaTarde,
            entradaExtra: batida.entradaExtra,
            saidaExtra: batida.saidaExtra,
            confianca: batida.confianca as object,
            isManuscrito: batida.isManuscrito,
            isInconsistente: batida.isInconsistente,
            isFaltaDia: batida.isFaltaDia,
            gptFailed: false,
            outlierFlags:
              dayOutlierFlags.length > 0
                ? (dayOutlierFlags as object[])
                : undefined,
          },
        });

        await this.createOcrFeedbackV2(
          tenantId,
          savedBatida.id,
          cartaoPonto.id,
          batida.dia,
          result.feedback,
        );
      }

      // Compute review priority
      const { prioridade, motivos } = this.computePrioridadeV2(
        result.confiancaGeral,
        result.batidas,
        outlierResult.batidaFlags,
        isManuscrito,
        result.usou5_2,
      );

      await this.prisma.cartaoPonto.update({
        where: { id: cartaoPonto.id },
        data: {
          prioridadeRevisao: prioridade,
          prioridadeMotivos: motivos as unknown as object[],
        },
      });

      this.logger.log(`[Card:${cartaoId}] Quinzenal merge concluido`, {
        cartaoPontoId: cartaoPonto.id,
        confiancaGeral: result.confiancaGeral,
        batidasCount: result.batidas.length,
        usou5_2: result.usou5_2,
      });

      return {
        pageNumber: primaryPage,
        success: true,
        cartaoPontoId: cartaoPonto.id,
        usedFallback: result.usou5_2,
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Erro desconhecido';
      const stack = error instanceof Error ? error.stack : undefined;

      this.logger.error(
        `[Card:${cartaoId}] Falha: ${message}`,
        stack,
        { tenantId, uploadId, cartaoId, tipo },
      );

      try {
        await this.prisma.cartaoPonto.create({
          data: {
            tenantId,
            uploadId,
            paginaPdf: primaryPage,
            skipReason: message,
            confiancaGeral: 0,
          },
        });
      } catch {
        // Already exists — ignore
      }

      return {
        pageNumber: primaryPage,
        success: false,
        skipReason: message,
      };
    }
  }

  // ──────────────────────────────────────────────
  // Pipeline v2: Single page processing
  // ──────────────────────────────────────────────

  private async processV2(
    jobData: PageJobData,
    pageImageBuffer: Buffer,
    ocrConfig: import('../tenant-ocr-config.service').ResolvedOcrConfig,
  ): Promise<PageProcessingResult> {
    const { uploadId, tenantId, pageNumber } = jobData;

    this.logger.log(`[Page:${pageNumber}] Pipeline v2 — multi-extrator com votacao`, {
      tenantId,
      uploadId,
      pageNumber,
    });

    // Parse DI Read pre-computado se disponivel no job data
    let diReadPreComputado: DiReadResult | undefined;
    if (jobData.diTextContent) {
      diReadPreComputado = {
        textoCompleto: jobData.diTextContent,
        linhas: [],
      };
    }

    const result = await this.pipelineV2Orchestrator.processarPagina(
      jobData.pageImageBase64,
      pageImageBuffer,
      pageNumber,
      ocrConfig,
      diReadPreComputado,
    );

    const isManuscrito = result.batidas.some((b) => b.isManuscrito);
    const tipoCartao = isManuscrito ? 'MANUSCRITO' as const : 'ELETRONICO' as const;

    // Save CartaoPonto
    // Note: pipelineVersion is a v2 migration field — cast needed until Prisma client is regenerated
    const v2CartaoPontoData = {
      tenantId,
      uploadId,
      paginaPdf: pageNumber,
      nomeExtraido: result.cabecalho.nome,
      cargoExtraido: result.cabecalho.cargo,
      mesExtraido: result.cabecalho.mes,
      empresaExtraida: result.cabecalho.empresa,
      cnpjExtraido: result.cabecalho.cnpj,
      horarioContratual: result.cabecalho.horarioContratual?.segSex ?? null,
      tipoCartao: tipoCartao as import('@prisma/client').TipoCartao,
      statusRevisao: StatusRevisao.PENDENTE,
      confiancaGeral: result.confiancaGeral,
      pipelineVersion: 2,
      ocrRawData: {
        source: 'pipeline-v2-voting',
        usou5_2: result.usou5_2,
        estatisticas: result.estatisticas,
      } as object,
    };
    const cartaoPonto = await this.prisma.cartaoPonto.create({
      data: v2CartaoPontoData as import('@prisma/client').Prisma.CartaoPontoUncheckedCreateInput,
    });

    // Save Batidas
    const outlierResult = this.outlierDetector.detect(
      this.consistencyValidator.validate(result.batidas),
    );

    for (let i = 0; i < result.batidas.length; i++) {
      const batida = result.batidas[i];
      const dayOutlierFlags = outlierResult.batidaFlags[i] ?? [];

      const savedBatida = await this.prisma.batida.create({
        data: {
          tenantId,
          cartaoPontoId: cartaoPonto.id,
          dia: batida.dia,
          diaSemana: batida.diaSemana,
          entradaManha: batida.entradaManha,
          saidaManha: batida.saidaManha,
          entradaTarde: batida.entradaTarde,
          saidaTarde: batida.saidaTarde,
          entradaExtra: batida.entradaExtra,
          saidaExtra: batida.saidaExtra,
          confianca: batida.confianca as object,
          isManuscrito: batida.isManuscrito,
          isInconsistente: batida.isInconsistente,
          isFaltaDia: batida.isFaltaDia,
          gptFailed: false,
          consistencyIssues: undefined,
          outlierFlags:
            dayOutlierFlags.length > 0
              ? (dayOutlierFlags as object[])
              : undefined,
        },
      });

      // Create OcrFeedback records (v2 format — mapped to existing schema)
      await this.createOcrFeedbackV2(
        tenantId,
        savedBatida.id,
        cartaoPonto.id,
        batida.dia,
        result.feedback,
      );
    }

    // Compute review priority
    const { prioridade, motivos } = this.computePrioridadeV2(
      result.confiancaGeral,
      result.batidas,
      outlierResult.batidaFlags,
      isManuscrito,
      result.usou5_2,
    );

    await this.prisma.cartaoPonto.update({
      where: { id: cartaoPonto.id },
      data: {
        prioridadeRevisao: prioridade,
        prioridadeMotivos: motivos as unknown as object[],
      },
    });

    this.logger.log(`[Page:${pageNumber}] Pipeline v2 concluido`, {
      cartaoPontoId: cartaoPonto.id,
      confiancaGeral: result.confiancaGeral,
      batidasCount: result.batidas.length,
      usou5_2: result.usou5_2,
      tipoCartao,
    });

    return {
      pageNumber,
      success: true,
      cartaoPontoId: cartaoPonto.id,
      usedFallback: result.usou5_2,
    };
  }

  private async createOcrFeedbackV2(
    tenantId: string,
    batidaId: string,
    cartaoPontoId: string,
    dia: number,
    allFeedback: V2OcrFeedbackData[],
  ): Promise<void> {
    const diaFeedback = allFeedback.filter((f) => f.dia === dia);

    if (diaFeedback.length === 0) return;

    const feedbackData = diaFeedback.map((f) => ({
      tenantId,
      batidaId,
      cartaoPontoId,
      dia: f.dia,
      campo: f.campo,
      // Mapeamento v2 → schema existente:
      // valorDi = Mini A (extrator principal)
      // valorGpt = Mini B ou 5.2 (fonte alternativa)
      valorDi: f.valorMiniA,
      valorGpt: f.usouFallback ? f.valorFinal : f.valorMiniB,
      valorFinal: f.valorFinal,
      concordaDiGpt: f.fonteDecisao === 'unanime' || f.fonteDecisao === 'maioria_AB',
    }));

    await this.prisma.ocrFeedback.createMany({ data: feedbackData });
  }

  // ──────────────────────────────────────────────
  // Pipeline v3: DI Clean + GPT-5.2 direto
  // ──────────────────────────────────────────────

  /**
   * Processa uma pagina usando Pipeline v3 (DI Clean Table + GPT-5.2 direto).
   * Fluxo simplificado: 1 chamada ao GPT-5.2 com tabela limpa + imagem.
   */
  private async processV3(
    uploadId: string,
    tenantId: string,
    pageNumber: number,
    pageImageBase64: string,
    diCleanTable: string,
    ocrConfig: import('../tenant-ocr-config.service').ResolvedOcrConfig,
    tipoCartao: 'mensal' | 'quinzenal',
  ): Promise<PageProcessingResult> {
    this.logger.log(`[Page:${pageNumber}] Pipeline v3 — DI Clean + GPT-5.2 direto`, {
      tenantId,
      uploadId,
      pageNumber,
      tipoCartao,
    });

    const result = await this.pipelineV2Orchestrator.processarPaginaDirect(
      pageImageBase64,
      diCleanTable,
      pageNumber,
      ocrConfig,
      tipoCartao,
    );

    const isManuscrito = result.batidas.some((b) => b.isManuscrito);
    const tipoCartaoEnum = isManuscrito ? 'MANUSCRITO' as const : 'ELETRONICO' as const;

    // Save CartaoPonto
    const cartaoPontoData = {
      tenantId,
      uploadId,
      paginaPdf: pageNumber,
      nomeExtraido: result.cabecalho.nome,
      cargoExtraido: result.cabecalho.cargo,
      mesExtraido: result.cabecalho.mes,
      empresaExtraida: result.cabecalho.empresa,
      cnpjExtraido: result.cabecalho.cnpj,
      horarioContratual: result.cabecalho.horarioContratual?.segSex ?? null,
      tipoCartao: tipoCartaoEnum as import('@prisma/client').TipoCartao,
      statusRevisao: 'PENDENTE' as import('@prisma/client').StatusRevisao,
      confiancaGeral: result.confiancaGeral,
      pipelineVersion: 3,
      ocrRawData: {
        source: 'pipeline-v3-gpt52-direct',
        usou5_2: true,
        estatisticas: result.estatisticas,
      } as object,
    };
    const cartaoPonto = await this.prisma.cartaoPonto.create({
      data: cartaoPontoData as import('@prisma/client').Prisma.CartaoPontoUncheckedCreateInput,
    });

    // Save Batidas
    const outlierResult = this.outlierDetector.detect(
      this.consistencyValidator.validate(result.batidas),
    );

    for (let i = 0; i < result.batidas.length; i++) {
      const batida = result.batidas[i];
      const dayOutlierFlags = outlierResult.batidaFlags[i] ?? [];

      const savedBatida = await this.prisma.batida.create({
        data: {
          tenantId,
          cartaoPontoId: cartaoPonto.id,
          dia: batida.dia,
          diaSemana: batida.diaSemana,
          entradaManha: batida.entradaManha,
          saidaManha: batida.saidaManha,
          entradaTarde: batida.entradaTarde,
          saidaTarde: batida.saidaTarde,
          entradaExtra: batida.entradaExtra,
          saidaExtra: batida.saidaExtra,
          confianca: batida.confianca as object,
          isManuscrito: batida.isManuscrito,
          isInconsistente: batida.isInconsistente,
          isFaltaDia: batida.isFaltaDia,
          gptFailed: false,
          outlierFlags:
            dayOutlierFlags.length > 0
              ? (dayOutlierFlags as object[])
              : undefined,
        },
      });

      await this.createOcrFeedbackV2(
        tenantId,
        savedBatida.id,
        cartaoPonto.id,
        batida.dia,
        result.feedback,
      );
    }

    // Compute review priority
    const { prioridade, motivos } = this.computePrioridadeV2(
      result.confiancaGeral,
      result.batidas,
      outlierResult.batidaFlags,
      isManuscrito,
      true,
    );

    await this.prisma.cartaoPonto.update({
      where: { id: cartaoPonto.id },
      data: {
        prioridadeRevisao: prioridade,
        prioridadeMotivos: motivos as unknown as object[],
      },
    });

    this.logger.log(`[Page:${pageNumber}] Pipeline v3 concluido`, {
      cartaoPontoId: cartaoPonto.id,
      confiancaGeral: result.confiancaGeral,
      batidasCount: result.batidas.length,
      tipoCartao: tipoCartaoEnum,
    });

    return {
      pageNumber,
      success: true,
      cartaoPontoId: cartaoPonto.id,
      usedFallback: false,
    };
  }

  /**
   * Salva resultado de cartao quinzenal v3 (merged frente+verso).
   */
  private async saveCardResult(
    tenantId: string,
    uploadId: string,
    pageNumberFrente: number,
    pageNumberVerso: number,
    cartaoId: string,
    result: import('../ocr-pipeline.types').ProcessamentoV2Result,
    primaryPage: number,
  ): Promise<PageProcessingResult> {
    const isManuscrito = result.batidas.some((b) => b.isManuscrito);
    const tipoCartao = isManuscrito ? 'MANUSCRITO' as const : 'ELETRONICO' as const;

    const cartaoPontoData = {
      tenantId,
      uploadId,
      paginaPdf: pageNumberFrente,
      paginaVerso: pageNumberVerso,
      nomeExtraido: result.cabecalho.nome,
      cargoExtraido: result.cabecalho.cargo,
      mesExtraido: result.cabecalho.mes,
      empresaExtraida: result.cabecalho.empresa,
      cnpjExtraido: result.cabecalho.cnpj,
      horarioContratual: result.cabecalho.horarioContratual?.segSex ?? null,
      tipoCartao: tipoCartao as import('@prisma/client').TipoCartao,
      statusRevisao: 'PENDENTE' as import('@prisma/client').StatusRevisao,
      confiancaGeral: result.confiancaGeral,
      pipelineVersion: 3,
      tipoCartaoFormato: 'quinzenal',
      mergeValidado: true,
      ocrRawData: {
        source: 'pipeline-v3-quinzenal-merge',
        usou5_2: true,
        estatisticas: result.estatisticas,
        paginaFrente: pageNumberFrente,
        paginaVerso: pageNumberVerso,
      } as object,
    };
    const cartaoPonto = await this.prisma.cartaoPonto.create({
      data: cartaoPontoData as import('@prisma/client').Prisma.CartaoPontoUncheckedCreateInput,
    });

    // Save Batidas
    const outlierResult = this.outlierDetector.detect(
      this.consistencyValidator.validate(result.batidas),
    );

    for (let i = 0; i < result.batidas.length; i++) {
      const batida = result.batidas[i];
      const dayOutlierFlags = outlierResult.batidaFlags[i] ?? [];

      const savedBatida = await this.prisma.batida.create({
        data: {
          tenantId,
          cartaoPontoId: cartaoPonto.id,
          dia: batida.dia,
          diaSemana: batida.diaSemana,
          entradaManha: batida.entradaManha,
          saidaManha: batida.saidaManha,
          entradaTarde: batida.entradaTarde,
          saidaTarde: batida.saidaTarde,
          entradaExtra: batida.entradaExtra,
          saidaExtra: batida.saidaExtra,
          confianca: batida.confianca as object,
          isManuscrito: batida.isManuscrito,
          isInconsistente: batida.isInconsistente,
          isFaltaDia: batida.isFaltaDia,
          gptFailed: false,
          outlierFlags:
            dayOutlierFlags.length > 0
              ? (dayOutlierFlags as object[])
              : undefined,
        },
      });

      await this.createOcrFeedbackV2(
        tenantId,
        savedBatida.id,
        cartaoPonto.id,
        batida.dia,
        result.feedback,
      );
    }

    // Compute review priority
    const { prioridade, motivos } = this.computePrioridadeV2(
      result.confiancaGeral,
      result.batidas,
      outlierResult.batidaFlags,
      isManuscrito,
      true,
    );

    await this.prisma.cartaoPonto.update({
      where: { id: cartaoPonto.id },
      data: {
        prioridadeRevisao: prioridade,
        prioridadeMotivos: motivos as unknown as object[],
      },
    });

    this.logger.log(`[Card:${cartaoId}] Quinzenal v3 merge concluido`, {
      cartaoPontoId: cartaoPonto.id,
      confiancaGeral: result.confiancaGeral,
      batidasCount: result.batidas.length,
    });

    return {
      pageNumber: primaryPage,
      success: true,
      cartaoPontoId: cartaoPonto.id,
      usedFallback: false,
    };
  }

  private computePrioridadeV2(
    confiancaGeral: number,
    _batidas: import('../confidence-scorer.service').ScoredBatida[],
    outlierFlags: OutlierFlag[][],
    isManuscrito: boolean,
    usou5_2: boolean,
  ): { prioridade: number; motivos: string[] } {
    const motivos: string[] = [];

    let score = (1 - confiancaGeral) * 40;
    if (confiancaGeral < 0.70) {
      motivos.push(`Confianca baixa (${(confiancaGeral * 100).toFixed(0)}%)`);
    }

    const outlierErrors = outlierFlags
      .flat()
      .filter((f) => f.severity === 'error').length;
    score += outlierErrors * 10;
    if (outlierErrors > 0) motivos.push(`${outlierErrors} outlier(s) critico(s)`);

    if (isManuscrito) {
      score += 10;
      motivos.push('Cartao manuscrito');
    }

    if (usou5_2) {
      score += 5;
      motivos.push('Fallback 5.2 acionado');
    }

    return {
      prioridade: parseFloat(score.toFixed(2)),
      motivos,
    };
  }
}
