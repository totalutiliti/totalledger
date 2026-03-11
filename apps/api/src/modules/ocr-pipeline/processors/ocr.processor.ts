import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { UploadStatus, StatusRevisao } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { BlobStorageService } from '../../upload/blob-storage.service';
import { DocumentIntelligenceService } from '../document-intelligence.service';
import { CardParserService } from '../card-parser.service';
import {
  ConfidenceScorerService,
  ScoredBatida,
} from '../confidence-scorer.service';
import { AiFilterService, AiFilterInput } from '../ai-filter.service';

export interface OcrJobData {
  uploadId: string;
  tenantId: string;
}

const REVIEW_THRESHOLD = 0.80;

@Processor('ocr-queue')
export class OcrProcessor extends WorkerHost {
  private readonly logger = new Logger(OcrProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly blobStorage: BlobStorageService,
    private readonly docIntelService: DocumentIntelligenceService,
    private readonly cardParser: CardParserService,
    private readonly confidenceScorer: ConfidenceScorerService,
    private readonly aiFilter: AiFilterService,
  ) {
    super();
  }

  async process(job: Job<OcrJobData>): Promise<void> {
    const { uploadId, tenantId } = job.data;
    this.logger.log(`Processing upload ${uploadId}`, {
      tenantId,
      uploadId,
      jobId: job.id,
    });

    try {
      // 1. Update status to PROCESSANDO
      await this.updateUploadStatus(uploadId, UploadStatus.PROCESSANDO);

      // 2. Get upload record
      const upload = await this.prisma.upload.findUnique({
        where: { id: uploadId },
        include: { empresa: true },
      });

      if (!upload) {
        throw new Error(`Upload ${uploadId} not found`);
      }

      // 3. Download PDF from blob storage
      this.logger.log(`Downloading PDF from blob: ${upload.blobPath}`, {
        tenantId,
        uploadId,
      });
      const pdfBuffer = await this.blobStorage.downloadBlob(upload.blobPath);

      // 4. Run Document Intelligence
      await job.updateProgress(10);
      const ocrResult = await this.docIntelService.analyzeDocument(pdfBuffer);

      // 5. Parse each page
      const totalPages = ocrResult.pages.length;
      await this.prisma.upload.update({
        where: { id: uploadId },
        data: { totalPaginas: totalPages },
      });

      for (let pageIdx = 0; pageIdx < totalPages; pageIdx++) {
        const pageNumber = ocrResult.pages[pageIdx].pageNumber;
        await job.updateProgress(
          10 + ((pageIdx + 1) / totalPages) * 60,
        );

        // 5a. Parse card
        const parsed = this.cardParser.parse(ocrResult, pageNumber);

        // 5b. Score confidence
        const scored = this.confidenceScorer.scoreBatidas(
          parsed.batidas,
          parsed.header.horarioContratual,
        );

        // 5c. AI filter for low-confidence fields
        const aiEnhanced = await this.applyAiFilter(
          scored,
          upload.empresa.razaoSocial,
          parsed.header.nomeExtraido ?? 'Desconhecido',
          parsed.header.horarioContratual ?? '',
        );
        await job.updateProgress(
          10 + ((pageIdx + 1) / totalPages) * 80,
        );

        // 5d. Compute overall confidence
        const confiancaGeral =
          this.confidenceScorer.computeOverallConfidence(aiEnhanced);
        const needsReview = aiEnhanced.some((b) => b.needsReview);

        // 5e. Save CartaoPonto
        const cartaoPonto = await this.prisma.cartaoPonto.create({
          data: {
            tenantId,
            uploadId,
            paginaPdf: pageNumber,
            nomeExtraido: parsed.header.nomeExtraido,
            cargoExtraido: parsed.header.cargoExtraido,
            mesExtraido: parsed.header.mesExtraido,
            empresaExtraida: parsed.header.empresaExtraida,
            cnpjExtraido: parsed.header.cnpjExtraido,
            horarioContratual: parsed.header.horarioContratual,
            tipoCartao: parsed.tipoCartao,
            statusRevisao: needsReview
              ? StatusRevisao.PENDENTE
              : StatusRevisao.PENDENTE,
            confiancaGeral,
            ocrRawData: ocrResult.rawResponse as object,
          },
        });

        // 5f. Save Batidas
        for (const batida of aiEnhanced) {
          await this.prisma.batida.create({
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
            },
          });
        }

        this.logger.log(`Page ${pageNumber} processed`, {
          tenantId,
          uploadId,
          cartaoPontoId: cartaoPonto.id,
          confiancaGeral,
          batidasCount: aiEnhanced.length,
          tipoCartao: parsed.tipoCartao,
        });
      }

      // 6. Update status to PROCESSADO
      await this.updateUploadStatus(uploadId, UploadStatus.PROCESSADO);
      await job.updateProgress(100);

      this.logger.log(`Upload ${uploadId} processed successfully`, {
        tenantId,
        totalPages,
      });
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : 'Unknown error';
      const stack = error instanceof Error ? error.stack : undefined;
      this.logger.error(
        `Error processing upload ${uploadId}: ${message}`,
        stack,
        {
          tenantId,
          uploadId,
        },
      );
      await this.updateUploadStatus(
        uploadId,
        UploadStatus.ERRO,
        message,
      );
      throw error; // BullMQ will retry
    }
  }

  private async applyAiFilter(
    batidas: ScoredBatida[],
    empresa: string,
    funcionario: string,
    horarioContratual: string,
  ): Promise<ScoredBatida[]> {
    const fields = [
      'entradaManha',
      'saidaManha',
      'entradaTarde',
      'saidaTarde',
    ] as const;
    const fieldRanges: Record<string, string> = {
      entradaManha: '06:00-09:00',
      saidaManha: '10:00-12:00',
      entradaTarde: '12:00-14:00',
      saidaTarde: '15:00-19:00',
    };

    for (const batida of batidas) {
      for (const field of fields) {
        const value = batida[field];
        const confidence = batida.confianca[field] ?? 0;

        if (!value || confidence >= REVIEW_THRESHOLD || confidence === 0)
          continue;

        const input: AiFilterInput = {
          empresa,
          funcionario,
          horarioContratual,
          dia: batida.dia,
          diaSemana: batida.diaSemana ?? '',
          campo: field,
          valorOCR: value,
          confianca: confidence,
          faixaEsperada: fieldRanges[field] ?? '',
        };

        const result = await this.aiFilter.filterField(input);

        // Update the value and confidence if AI is more confident
        if (result.confianca > confidence) {
          batida.confianca[field] = result.confianca;
          // Update the actual field value
          (batida as unknown as Record<string, string | null>)[field] =
            result.valorCorrigido;
        }
      }
    }

    return batidas;
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
        ...(status === UploadStatus.PROCESSADO
          ? { processadoEm: new Date() }
          : {}),
      },
    });
  }
}
