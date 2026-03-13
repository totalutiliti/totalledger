import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job, FlowProducer } from 'bullmq';
import { ConfigService } from '@nestjs/config';
import { UploadStatus, PageType } from '@prisma/client';
import { pdfToPng } from 'pdf-to-png-converter';
import { PrismaService } from '../../prisma/prisma.service';
import { BlobStorageService } from '../../upload/blob-storage.service';
import { DocumentIntelligenceService, OcrRawResult } from '../document-intelligence.service';
import { DocumentClassifierService, PageClassificationResult } from '../document-classifier.service';
import { TenantOcrConfigService } from '../tenant-ocr-config.service';
import { OcrMetricsService } from '../ocr-metrics.service';
import { DiReadExtractorService } from '../di-read-extractor.service';
import { DiCleanTableExtractorService } from '../di-clean-table-extractor.service';
import { CardGrouperService } from '../card-grouper.service';
import {
  UploadJobData,
  ConsolidationJobData,
  PageJobData,
  CartaoJobData,
  CellBoundingData,
} from '../ocr-pipeline.types';

// Legacy imports — kept for NestJS DI compatibility (constructor injection order)
import { CardParserService } from '../card-parser.service';
import { ConfidenceScorerService } from '../confidence-scorer.service';
import { TimeSanitizerService } from '../time-sanitizer.service';
import { GptVisionValidatorService } from '../gpt-vision-validator.service';
import { ConsistencyValidatorService } from '../consistency-validator.service';
import { OutlierDetectorService } from '../outlier-detector.service';
import { DecisionOrchestratorService } from '../decision-orchestrator.service';
import { GptGatekeeperService } from '../gpt-gatekeeper.service';

/**
 * Upload Orchestrator — processa um upload completo.
 *
 * Pipeline otimizado:
 * 1. Download PDF
 * 2. Azure Document Intelligence (estrutura)
 * 3. Classificar paginas
 * 4. Converter paginas processaveis em PNG
 * 5. Enfileirar jobs por pagina no `ocr-page-queue` via FlowProducer
 * 6. Job pai (`consolidate-upload`) roda apos TODOS os filhos completarem
 * 7. Consolidar status do upload
 */
@Processor('ocr-queue')
export class OcrProcessor extends WorkerHost {
  private readonly logger = new Logger(OcrProcessor.name);
  private flowProducer: FlowProducer | null = null;
  private readonly pipelineVersion: 'v1' | 'v2';

  constructor(
    private readonly prisma: PrismaService,
    private readonly blobStorage: BlobStorageService,
    private readonly docIntelService: DocumentIntelligenceService,
    private readonly documentClassifier: DocumentClassifierService,
    // Legacy services — kept for DI compatibility
    _cardParser: CardParserService,
    _confidenceScorer: ConfidenceScorerService,
    _timeSanitizer: TimeSanitizerService,
    _gptVisionValidator: GptVisionValidatorService,
    _consistencyValidator: ConsistencyValidatorService,
    _outlierDetector: OutlierDetectorService,
    _decisionOrchestrator: DecisionOrchestratorService,
    _gptGatekeeper: GptGatekeeperService,
    private readonly tenantOcrConfig: TenantOcrConfigService,
    private readonly metricsService: OcrMetricsService,
    private readonly configService: ConfigService,
    private readonly diReadExtractor: DiReadExtractorService,
    private readonly diCleanTableExtractor: DiCleanTableExtractorService,
    private readonly cardGrouper: CardGrouperService,
  ) {
    super();
    this.pipelineVersion = this.configService.get<'v1' | 'v2'>(
      'PIPELINE_VERSION',
      'v1',
    );
  }

  private getFlowProducer(): FlowProducer {
    if (!this.flowProducer) {
      const redisHost = this.configService.get<string>('REDIS_HOST', 'localhost');
      const redisPort = this.configService.get<number>('REDIS_PORT', 6379);
      const redisPassword = this.configService.get<string>('REDIS_PASSWORD');

      this.flowProducer = new FlowProducer({
        connection: {
          host: redisHost,
          port: redisPort,
          ...(redisPassword ? { password: redisPassword } : {}),
        },
      });
    }
    return this.flowProducer;
  }

  async process(job: Job<UploadJobData | ConsolidationJobData>): Promise<void> {
    const data = job.data;

    // Route to consolidation if this is a consolidation job
    if ('type' in data && data.type === 'consolidate') {
      return this.consolidate(job as Job<ConsolidationJobData>);
    }

    return this.orchestrateUpload(job as Job<UploadJobData>);
  }

  /**
   * Orchestrate a full upload: DI → Classify → Enqueue page jobs.
   */
  private async orchestrateUpload(job: Job<UploadJobData>): Promise<void> {
    const { uploadId, tenantId } = job.data;
    this.logger.log(`[OCR:Orchestrator] Iniciando upload ${uploadId}`, {
      tenantId,
      uploadId,
      jobId: job.id,
    });

    const metrics = this.metricsService.createCollector();

    try {
      // 1. Update status to PROCESSANDO
      await this.updateUploadStatus(uploadId, UploadStatus.PROCESSANDO);

      // 2. Load tenant OCR config
      const ocrConfig = await this.tenantOcrConfig.getConfig(tenantId);
      this.logger.log(`[OCR:Orchestrator] Tenant config loaded`, {
        tenantId,
        reviewThreshold: ocrConfig.reviewThreshold,
        miniFallbackThreshold: ocrConfig.miniFallbackThreshold,
      });

      // 3. Get upload record and download PDF
      const upload = await this.prisma.upload.findUnique({
        where: { id: uploadId },
        include: { empresa: true },
      });

      if (!upload) {
        throw new Error(`Upload ${uploadId} not found`);
      }

      this.logger.log(`[OCR:Orchestrator] Baixando PDF: ${upload.blobPath}`, {
        tenantId,
        uploadId,
      });
      const pdfBuffer = await this.blobStorage.downloadBlob(upload.blobPath);

      // 4. Run Document Intelligence
      await job.updateProgress(10);
      metrics.startLayer('docIntel');
      const ocrResult = await this.docIntelService.analyzeDocument(pdfBuffer);
      metrics.endLayer('docIntel');

      // 5. Classify all pages (Camada 0)
      const totalPages = ocrResult.pages.length;
      metrics.startLayer('classifier');
      const classifications = this.documentClassifier.classifyAllPages(ocrResult);
      metrics.endLayer('classifier');

      // Save classifications to DB
      await this.saveClassifications(tenantId, uploadId, classifications);

      const processablePages = classifications.filter((c) => c.shouldProcess);
      const skippedPages = classifications.filter((c) => !c.shouldProcess);

      await this.prisma.upload.update({
        where: { id: uploadId },
        data: { totalPaginas: totalPages },
      });

      // Record classification breakdown
      const classificationBreakdown: Record<string, number> = {};
      for (const c of classifications) {
        classificationBreakdown[c.pageType] = (classificationBreakdown[c.pageType] ?? 0) + 1;
      }
      metrics.setClassificacao(classificationBreakdown);

      this.logger.log(`[OCR:Orchestrator] Classificacao concluida`, {
        tenantId,
        uploadId,
        totalPages,
        processable: processablePages.length,
        skipped: skippedPages.length,
        types: classifications.map((c) => `p${c.pageNumber}:${c.pageType}`),
      });

      // ===== Pipeline v2: card grouping flow =====
      if (this.pipelineVersion === 'v2') {
        return this.orchestrateUploadV2(
          job,
          uploadId,
          tenantId,
          pdfBuffer,
          ocrResult,
          classifications,
          processablePages,
          skippedPages,
          totalPages,
          metrics,
        );
      }

      if (processablePages.length === 0) {
        this.logger.warn(`[OCR:Orchestrator] No processable pages found`, {
          tenantId,
          uploadId,
          totalPages,
          classifications: classifications.map((c) => ({
            page: c.pageNumber,
            type: c.pageType,
            shouldProcess: c.shouldProcess,
          })),
        });
        await this.prisma.upload.update({
          where: { id: uploadId },
          data: {
            status: UploadStatus.PROCESSADO,
            paginasProcessadas: 0,
            paginasFalhadas: 0,
            totalPaginas: totalPages,
            erroMensagem: `Nenhuma pagina processavel (${classifications.map((c) => `p${c.pageNumber}:${c.pageType}`).join(', ')})`,
            processadoEm: new Date(),
          },
        });
        await job.updateProgress(100);
        return;
      }

      // 6. Convert all processable pages to PNG in advance
      await job.updateProgress(30);
      const pageImages = new Map<number, Buffer>();
      for (const classification of processablePages) {
        try {
          const pages = await pdfToPng(new Uint8Array(pdfBuffer).buffer, {
            pagesToProcess: [classification.pageNumber],
            viewportScale: 2,
          });
          if (pages[0]?.content) {
            pageImages.set(classification.pageNumber, pages[0].content);
          }
        } catch (error: unknown) {
          const msg = error instanceof Error ? error.message : 'Unknown error';
          this.logger.warn(
            `[OCR:Orchestrator] Failed to convert page ${classification.pageNumber} to PNG: ${msg}`,
          );
        }
      }

      // 7. Build DI text content for each page (context for Mini)
      const pageTextContents = this.extractPageTextContents(ocrResult, processablePages);

      // 8. Extract cell bounding data for each page (for image cropping)
      const pageCellBounds = this.extractCellBounds(ocrResult, processablePages);

      // 9. Enqueue child page jobs via FlowProducer
      await job.updateProgress(40);

      const childJobs = processablePages
        .filter((c) => pageImages.has(c.pageNumber))
        .map((classification) => {
          const pageImage = pageImages.get(classification.pageNumber);
          const jobData: PageJobData = {
            uploadId,
            tenantId,
            pageNumber: classification.pageNumber,
            pageImageBase64: pageImage!.toString('base64'),
            diTextContent: pageTextContents.get(classification.pageNumber) ?? null,
            classificationData: classification,
            tableCellBounds: pageCellBounds.get(classification.pageNumber) ?? null,
          };

          return {
            name: 'process-page',
            queueName: 'ocr-page-queue',
            data: jobData,
            opts: {
              attempts: 1,
              backoff: { type: 'exponential' as const, delay: 3000 },
            },
          };
        });

      if (childJobs.length === 0) {
        this.logger.warn(`[OCR:Orchestrator] No page images to process`);
        await this.updateUploadStatus(uploadId, UploadStatus.ERRO, 'Nenhuma imagem de pagina gerada');
        return;
      }

      const consolidationData: ConsolidationJobData = {
        uploadId,
        tenantId,
        totalPages,
        type: 'consolidate',
      };

      const flowProducer = this.getFlowProducer();
      await flowProducer.add({
        name: 'consolidate-upload',
        queueName: 'ocr-queue',
        data: consolidationData,
        children: childJobs,
      });

      // Save initial metrics (will be updated by consolidation)
      await this.metricsService.save(
        tenantId,
        uploadId,
        totalPages,
        0, // Will be updated by consolidation
        0,
        skippedPages.length,
        metrics,
      );

      await job.updateProgress(50);

      this.logger.log(
        `[OCR:Orchestrator] ${childJobs.length} page jobs enqueued for upload ${uploadId}`,
        { tenantId, pageNumbers: childJobs.map((j) => j.data.pageNumber) },
      );
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      const stack = error instanceof Error ? error.stack : undefined;
      this.logger.error(
        `[OCR:Orchestrator] Erro fatal no upload ${uploadId}: ${message}`,
        stack,
        { tenantId, uploadId },
      );
      await this.updateUploadStatus(uploadId, UploadStatus.ERRO, message);
      throw error;
    }
  }

  /**
   * Consolidation job — runs after all page jobs complete.
   * Aggregates results and updates upload status.
   */
  private async consolidate(job: Job<ConsolidationJobData>): Promise<void> {
    const { uploadId, tenantId, totalPages } = job.data;

    this.logger.log(`[OCR:Consolidation] Consolidando upload ${uploadId}`, {
      tenantId,
      totalPages,
    });

    try {
      // Query all CartaoPonto records for this upload
      const cartoes = await this.prisma.cartaoPonto.findMany({
        where: { uploadId },
        select: {
          id: true,
          paginaPdf: true,
          skipReason: true,
          confiancaGeral: true,
          _count: { select: { batidas: true } },
        },
      });

      const paginasProcessadas = cartoes.filter(
        (c) => !c.skipReason && (c.confiancaGeral ?? 0) > 0,
      ).length;
      const paginasFalhadas = cartoes.filter(
        (c) => c.skipReason !== null || c.confiancaGeral === 0,
      ).length;

      let finalStatus: UploadStatus;
      let erroMensagem: string | undefined;

      if (paginasFalhadas === 0 && paginasProcessadas > 0) {
        finalStatus = UploadStatus.PROCESSADO;
      } else if (paginasProcessadas > 0) {
        finalStatus = UploadStatus.PROCESSADO_PARCIAL;
        erroMensagem = `${paginasFalhadas} de ${totalPages} pagina(s) falharam`;
      } else {
        finalStatus = UploadStatus.ERRO;
        erroMensagem = `Todas as ${totalPages} pagina(s) falharam`;
      }

      await this.prisma.upload.update({
        where: { id: uploadId },
        data: {
          status: finalStatus,
          paginasProcessadas,
          paginasFalhadas,
          erroMensagem: erroMensagem ?? null,
          ...(finalStatus === UploadStatus.PROCESSADO ||
          finalStatus === UploadStatus.PROCESSADO_PARCIAL
            ? { processadoEm: new Date() }
            : {}),
        },
      });

      await job.updateProgress(100);

      this.logger.log(
        `[OCR:Consolidation] Upload ${uploadId} finalizado: ${finalStatus}`,
        {
          tenantId,
          totalPages,
          paginasProcessadas,
          paginasFalhadas,
          status: finalStatus,
        },
      );
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(
        `[OCR:Consolidation] Erro na consolidacao do upload ${uploadId}: ${message}`,
        undefined,
        { tenantId, uploadId },
      );
      await this.updateUploadStatus(uploadId, UploadStatus.ERRO, message);
      throw error;
    }
  }

  // ──────────────────────────────────────────────
  // Pipeline v2: Card Grouping Flow
  // ──────────────────────────────────────────────

  /**
   * Pipeline v2 orchestration: DI Read batch → classify → group cards → enqueue card jobs.
   */
  private async orchestrateUploadV2(
    job: Job<UploadJobData>,
    uploadId: string,
    tenantId: string,
    pdfBuffer: Buffer,
    ocrResult: OcrRawResult,
    classifications: PageClassificationResult[],
    processablePages: PageClassificationResult[],
    skippedPages: PageClassificationResult[],
    totalPages: number,
    metrics: ReturnType<OcrMetricsService['createCollector']>,
  ): Promise<void> {
    this.logger.log(`[OCR:v2] Pipeline v2 — card grouping flow`, {
      tenantId,
      uploadId,
      processablePages: processablePages.length,
    });

    if (processablePages.length === 0) {
      this.logger.warn(`[OCR:v2] No processable pages found`, {
        tenantId,
        uploadId,
        totalPages,
      });
      await this.prisma.upload.update({
        where: { id: uploadId },
        data: {
          status: UploadStatus.PROCESSADO,
          paginasProcessadas: 0,
          paginasFalhadas: 0,
          totalPaginas: totalPages,
          erroMensagem: `Nenhuma pagina processavel (${classifications.map((c) => `p${c.pageNumber}:${c.pageType}`).join(', ')})`,
          processadoEm: new Date(),
        },
      });
      await job.updateProgress(100);
      return;
    }

    // ===== STEP v2.1: DI Read batch on entire PDF =====
    await job.updateProgress(25);
    metrics.startLayer('diRead');
    let diReadResults = new Map<number, import('../ocr-pipeline.types').DiReadResult>();
    try {
      diReadResults = await this.diReadExtractor.extrairTodas(pdfBuffer);
      this.logger.log(`[OCR:v2] DI Read batch completed`, {
        pagesExtracted: diReadResults.size,
      });
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : 'Unknown error';
      this.logger.warn(`[OCR:v2] DI Read batch failed (non-fatal): ${msg}`);
    }
    metrics.endLayer('diRead');

    // ===== STEP v2.2: Group pages into cards =====
    await job.updateProgress(35);
    const cartoes = this.cardGrouper.agrupar(classifications);

    this.logger.log(`[OCR:v2] Card grouping completed`, {
      cartoesAgrupados: cartoes.length,
      mensais: cartoes.filter((c) => c.tipo === 'mensal').length,
      quinzenais: cartoes.filter((c) => c.tipo === 'quinzenal').length,
    });

    // ===== STEP v2.3: Convert processable pages to PNG =====
    await job.updateProgress(40);
    const pageImages = new Map<number, Buffer>();
    for (const classification of processablePages) {
      try {
        const pages = await pdfToPng(new Uint8Array(pdfBuffer).buffer, {
          pagesToProcess: [classification.pageNumber],
          viewportScale: 2,
        });
        if (pages[0]?.content) {
          pageImages.set(classification.pageNumber, pages[0].content);
        }
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : 'Unknown error';
        this.logger.warn(
          `[OCR:v2] Failed to convert page ${classification.pageNumber} to PNG: ${msg}`,
        );
      }
    }

    // Build DI text content and cell bounds for each page
    const pageTextContents = this.extractPageTextContents(ocrResult, processablePages);
    const pageCellBounds = this.extractCellBounds(ocrResult, processablePages);

    // ===== STEP v2.3b: Extract DI clean tables =====
    const diCleanTables = this.diCleanTableExtractor.extrairTodas(ocrResult);
    this.logger.log(`[OCR:v2] DI Clean Tables extracted`, {
      pagesWithTables: diCleanTables.size,
    });

    // ===== STEP v2.4: Build card-level child jobs =====
    await job.updateProgress(50);
    const pdfBufferBase64 = pdfBuffer.toString('base64');

    // Serialize DI Read results for job data
    const diReadSerialized: Record<number, import('../ocr-pipeline.types').DiReadResult> = {};
    for (const [pageNum, diResult] of diReadResults) {
      diReadSerialized[pageNum] = diResult;
    }

    const childJobs: Array<{
      name: string;
      queueName: string;
      data: CartaoJobData | PageJobData;
      opts: { attempts: number; backoff: { type: 'exponential'; delay: number } };
    }> = [];

    for (const cartao of cartoes) {
      // Build paginas array for the card
      const paginasDoCartao = cartao.paginas
        .filter((p) => pageImages.has(p.pageNumber))
        .map((p) => ({
          pageNumber: p.pageNumber,
          pageImageBase64: pageImages.get(p.pageNumber)!.toString('base64'),
          diTextContent: pageTextContents.get(p.pageNumber) ?? null,
          classificationData: p,
          tableCellBounds: pageCellBounds.get(p.pageNumber) ?? null,
        }));

      if (paginasDoCartao.length === 0) {
        this.logger.warn(`[OCR:v2] Card ${cartao.id}: no page images available, skipping`);
        continue;
      }

      // Build DI Read subset for this card's pages
      const cardDiReadResults: Record<number, import('../ocr-pipeline.types').DiReadResult> = {};
      for (const p of cartao.paginas) {
        if (diReadSerialized[p.pageNumber]) {
          cardDiReadResults[p.pageNumber] = diReadSerialized[p.pageNumber];
        }
      }

      // Build DI Clean Table subset for this card's pages
      const cardDiCleanTables: Record<number, string> = {};
      for (const p of cartao.paginas) {
        const cleanTable = diCleanTables.get(p.pageNumber);
        if (cleanTable) {
          cardDiCleanTables[p.pageNumber] = cleanTable.textoFormatado;
        }
      }

      const jobData: CartaoJobData = {
        uploadId,
        tenantId,
        cartaoId: cartao.id,
        tipo: cartao.tipo,
        paginas: paginasDoCartao,
        pdfBufferBase64,
        diReadResults: cardDiReadResults,
        diCleanTables: Object.keys(cardDiCleanTables).length > 0 ? cardDiCleanTables : undefined,
      };

      childJobs.push({
        name: 'process-card',
        queueName: 'ocr-page-queue',
        data: jobData,
        opts: {
          attempts: 1,
          backoff: { type: 'exponential' as const, delay: 3000 },
        },
      });
    }

    if (childJobs.length === 0) {
      this.logger.warn(`[OCR:v2] No card jobs to enqueue`);
      await this.updateUploadStatus(uploadId, UploadStatus.ERRO, 'Nenhuma imagem de pagina gerada');
      return;
    }

    // ===== STEP v2.5: Enqueue via FlowProducer =====
    const consolidationData: ConsolidationJobData = {
      uploadId,
      tenantId,
      totalPages,
      type: 'consolidate',
    };

    const flowProducer = this.getFlowProducer();
    await flowProducer.add({
      name: 'consolidate-upload',
      queueName: 'ocr-queue',
      data: consolidationData,
      children: childJobs,
    });

    // Save initial metrics
    await this.metricsService.save(
      tenantId,
      uploadId,
      totalPages,
      0,
      0,
      skippedPages.length,
      metrics,
    );

    await job.updateProgress(60);

    this.logger.log(
      `[OCR:v2] ${childJobs.length} card jobs enqueued for upload ${uploadId}`,
      {
        tenantId,
        cards: childJobs.map((j) => ({
          tipo: (j.data as CartaoJobData).tipo,
          paginas: (j.data as CartaoJobData).paginas.map((p) => p.pageNumber),
        })),
      },
    );
  }

  // ──────────────────────────────────────────────
  // Helpers
  // ──────────────────────────────────────────────

  /**
   * Extract structured text content from DI result for each processable page.
   * This text is passed to the Mini as context.
   */
  private extractPageTextContents(
    ocrResult: OcrRawResult,
    processablePages: PageClassificationResult[],
  ): Map<number, string> {
    const result = new Map<number, string>();

    for (const classification of processablePages) {
      const page = ocrResult.pages.find((p) => p.pageNumber === classification.pageNumber);
      const table = ocrResult.tables.find((t) => t.pageNumber === classification.pageNumber);

      if (!page && !table) continue;

      const lines: string[] = [];

      if (page) {
        for (const line of page.lines) {
          if (line.content.trim()) {
            lines.push(line.content);
          }
        }
      }

      if (table) {
        lines.push(`\n[TABELA: ${table.rowCount} linhas x ${table.columnCount} colunas]`);
        const headerCells = table.cells.filter((c) => c.isHeader);
        if (headerCells.length > 0) {
          lines.push(`Headers: ${headerCells.map((c) => c.content).join(' | ')}`);
        }
      }

      if (lines.length > 0) {
        result.set(classification.pageNumber, lines.join('\n'));
      }
    }

    return result;
  }

  /**
   * Extract cell bounding data for image cropping.
   */
  private extractCellBounds(
    ocrResult: OcrRawResult,
    processablePages: PageClassificationResult[],
  ): Map<number, CellBoundingData[]> {
    const result = new Map<number, CellBoundingData[]>();

    for (const classification of processablePages) {
      const table = ocrResult.tables.find((t) => t.pageNumber === classification.pageNumber);
      if (!table) continue;

      const bounds: CellBoundingData[] = table.cells
        .filter((c) => !c.isHeader && c.boundingBox.length > 0)
        .map((c) => ({
          rowIndex: c.rowIndex,
          columnIndex: c.columnIndex,
          boundingBox: c.boundingBox,
          content: c.content,
        }));

      if (bounds.length > 0) {
        result.set(classification.pageNumber, bounds);
      }
    }

    return result;
  }

  /**
   * Save page classifications to DB (idempotent — deletes existing first).
   */
  private async saveClassifications(
    tenantId: string,
    uploadId: string,
    classifications: PageClassificationResult[],
  ): Promise<void> {
    await this.prisma.pageClassification.deleteMany({
      where: { uploadId },
    });

    await this.prisma.pageClassification.createMany({
      data: classifications.map((c) => ({
        tenantId,
        uploadId,
        paginaPdf: c.pageNumber,
        pageType: c.pageType as PageType,
        subFormat: c.subFormat,
        confidence: c.confidence,
        shouldProcess: c.shouldProcess,
        classifierData: c.classifierData as object,
      })),
    });
  }

  private async updateUploadStatus(
    uploadId: string,
    status: UploadStatus,
    erroMensagem?: string,
  ): Promise<void> {
    await this.prisma.upload.update({
      where: { id: uploadId },
      data: {
        status,
        erroMensagem: erroMensagem ?? null,
        ...(status === UploadStatus.PROCESSADO ||
        status === UploadStatus.PROCESSADO_PARCIAL
          ? { processadoEm: new Date() }
          : {}),
      },
    });
  }
}
