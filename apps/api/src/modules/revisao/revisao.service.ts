import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { AcaoRevisao, StatusRevisao, UploadStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { GroundTruthService } from '../ocr-pipeline/ground-truth.service';
import { CorrigirBatidaDto } from './dto/corrigir-batida.dto';
import {
  PaginationDto,
  buildPaginationMeta,
} from '../../common/dto/pagination.dto';

interface FindPendentesFilters extends PaginationDto {
  empresaId?: string;
  uploadId?: string;
}

/** Fields on Batida that can be corrected, mapped to their DB column name. */
const CORRECTABLE_FIELDS = [
  'entradaManhaCorrigida',
  'saidaManhaCorrigida',
  'entradaTardeCorrigida',
  'saidaTardeCorrigida',
  'entradaExtraCorrigida',
  'saidaExtraCorrigida',
] as const;

/** Map corrected field to the original OCR field for valorAnterior tracking. */
const ORIGINAL_FIELD_MAP: Record<string, string> = {
  entradaManhaCorrigida: 'entradaManha',
  saidaManhaCorrigida: 'saidaManha',
  entradaTardeCorrigida: 'entradaTarde',
  saidaTardeCorrigida: 'saidaTarde',
  entradaExtraCorrigida: 'entradaExtra',
  saidaExtraCorrigida: 'saidaExtra',
};

@Injectable()
export class RevisaoService {
  private readonly logger = new Logger(RevisaoService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly groundTruthService: GroundTruthService,
  ) {}

  /** List CartaoPonto with statusRevisao PENDENTE or EM_REVISAO, with pagination. */
  async findPendentes(tenantId: string, filters: FindPendentesFilters) {
    const { page = 1, limit = 20, empresaId, uploadId } = filters;

    const where = {
      tenantId,
      statusRevisao: { in: [StatusRevisao.PENDENTE, StatusRevisao.EM_REVISAO] },
      batidas: { some: {} }, // Only show cartões that have at least 1 batida
      ...(empresaId ? { upload: { empresaId } } : {}),
      ...(uploadId ? { uploadId } : {}),
    };

    const [data, total] = await Promise.all([
      this.prisma.cartaoPonto.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: [
          { uploadId: 'asc' },
          { paginaPdf: 'asc' },
        ],
        include: {
          upload: {
            select: {
              id: true,
              nomeArquivo: true,
              mesReferencia: true,
              empresa: { select: { id: true, razaoSocial: true, nomeFantasia: true } },
            },
          },
        },
      }),
      this.prisma.cartaoPonto.count({ where }),
    ]);

    return {
      data,
      meta: buildPaginationMeta(page, limit, total),
    };
  }

  /** Get a single CartaoPonto with all batidas and existing revisoes. */
  async findOne(tenantId: string, cartaoPontoId: string) {
    const cartao = await this.prisma.cartaoPonto.findFirst({
      where: { id: cartaoPontoId, tenantId },
      include: {
        batidas: {
          orderBy: { dia: 'asc' },
          include: {
            ocrFeedback: {
              select: {
                id: true,
                campo: true,
                valorDi: true,
                valorGpt: true,
                valorFinal: true,
                valorHumano: true,
                concordaDiGpt: true,
              },
            },
          },
        },
        revisoes: {
          orderBy: { createdAt: 'desc' },
          include: { user: { select: { id: true, nome: true, email: true } } },
        },
        upload: {
          select: {
            id: true,
            nomeArquivo: true,
            mesReferencia: true,
            blobUrl: true,
            empresa: { select: { id: true, razaoSocial: true, nomeFantasia: true } },
          },
        },
        funcionario: {
          select: { id: true, nome: true, cargo: true, matricula: true },
        },
      },
    });

    if (!cartao) {
      throw new NotFoundException(`CartaoPonto ${cartaoPontoId} não encontrado`);
    }

    return cartao;
  }

  /** Correct fields on a Batida and create Revisao records for each changed field. */
  async corrigirBatida(
    tenantId: string,
    cartaoPontoId: string,
    batidaId: string,
    userId: string,
    dto: CorrigirBatidaDto,
  ) {
    // Verify cartão belongs to tenant
    const cartao = await this.prisma.cartaoPonto.findFirst({
      where: { id: cartaoPontoId, tenantId },
    });

    if (!cartao) {
      throw new NotFoundException(`CartaoPonto ${cartaoPontoId} não encontrado`);
    }

    if (cartao.statusRevisao === StatusRevisao.APROVADO) {
      throw new BadRequestException('Cartão já aprovado não pode ser corrigido');
    }

    // Verify batida belongs to this cartão
    const batida = await this.prisma.batida.findFirst({
      where: { id: batidaId, cartaoPontoId, tenantId },
    });

    if (!batida) {
      throw new NotFoundException(`Batida ${batidaId} não encontrada neste cartão`);
    }

    // Build update data and revisao records
    const updateData: Record<string, string | null> = {};
    const revisaoRecords: Array<{
      tenantId: string;
      cartaoPontoId: string;
      userId: string;
      acao: AcaoRevisao;
      campo: string;
      valorAnterior: string | null;
      valorNovo: string | null;
      observacao: string | null;
    }> = [];

    for (const field of CORRECTABLE_FIELDS) {
      const newValue = dto[field];
      if (newValue !== undefined) {
        updateData[field] = newValue;

        const originalField = ORIGINAL_FIELD_MAP[field];
        const valorAnterior = (batida[field as keyof typeof batida] as string | null)
          ?? (batida[originalField as keyof typeof batida] as string | null);

        revisaoRecords.push({
          tenantId,
          cartaoPontoId,
          userId,
          acao: AcaoRevisao.CORRECAO,
          campo: field,
          valorAnterior,
          valorNovo: newValue,
          observacao: dto.observacao ?? null,
        });
      }
    }

    // If only observacao was sent (no correctable fields), create an OBSERVACAO record
    if (revisaoRecords.length === 0 && dto.observacao) {
      updateData['observacao'] = dto.observacao;
      revisaoRecords.push({
        tenantId,
        cartaoPontoId,
        userId,
        acao: AcaoRevisao.OBSERVACAO,
        campo: 'observacao',
        valorAnterior: batida.observacao,
        valorNovo: dto.observacao,
        observacao: dto.observacao,
      });
    }

    // Also update observacao on the batida if provided alongside corrections
    if (dto.observacao && revisaoRecords.length > 0 && !('observacao' in updateData)) {
      updateData['observacao'] = dto.observacao;
    }

    // Execute in transaction
    const result = await this.prisma.$transaction(async (tx) => {
      // Update batida
      const updatedBatida = await tx.batida.update({
        where: { id: batidaId },
        data: updateData,
      });

      // Create revisao records
      await tx.revisao.createMany({ data: revisaoRecords });

      // Update OcrFeedback.valorHumano for corrected fields
      for (const record of revisaoRecords) {
        if (record.acao !== AcaoRevisao.CORRECAO || !record.campo) continue;

        const originalField = ORIGINAL_FIELD_MAP[record.campo];
        if (!originalField) continue;

        await tx.ocrFeedback.updateMany({
          where: {
            batidaId,
            campo: originalField,
          },
          data: {
            valorHumano: record.valorNovo,
          },
        });
      }

      // Set statusRevisao to EM_REVISAO if still PENDENTE
      if (cartao.statusRevisao === StatusRevisao.PENDENTE) {
        await tx.cartaoPonto.update({
          where: { id: cartaoPontoId },
          data: { statusRevisao: StatusRevisao.EM_REVISAO },
        });
      }

      return updatedBatida;
    });

    this.logger.log('Batida corrigida', {
      tenantId,
      cartaoPontoId,
      batidaId,
      userId,
      fieldsChanged: Object.keys(updateData),
    });

    return result;
  }

  /** Approve a CartaoPonto. If all cartoes of the upload are approved, set upload to VALIDADO. */
  async aprovar(
    tenantId: string,
    cartaoPontoId: string,
    userId: string,
    observacao?: string,
  ) {
    const cartao = await this.prisma.cartaoPonto.findFirst({
      where: { id: cartaoPontoId, tenantId },
    });

    if (!cartao) {
      throw new NotFoundException(`CartaoPonto ${cartaoPontoId} não encontrado`);
    }

    if (cartao.statusRevisao === StatusRevisao.APROVADO) {
      throw new BadRequestException('Cartão já está aprovado');
    }

    const result = await this.prisma.$transaction(async (tx) => {
      // Update status
      const updated = await tx.cartaoPonto.update({
        where: { id: cartaoPontoId },
        data: { statusRevisao: StatusRevisao.APROVADO },
      });

      // Create revisao record
      await tx.revisao.create({
        data: {
          tenantId,
          cartaoPontoId,
          userId,
          acao: AcaoRevisao.APROVACAO,
          observacao: observacao ?? null,
        },
      });

      // Check if all cartoes of this upload are APROVADO
      const pendingCount = await tx.cartaoPonto.count({
        where: {
          uploadId: cartao.uploadId,
          statusRevisao: { not: StatusRevisao.APROVADO },
          id: { not: cartaoPontoId }, // exclude the one we just updated
        },
      });

      if (pendingCount === 0) {
        await tx.upload.update({
          where: { id: cartao.uploadId },
          data: { status: UploadStatus.VALIDADO },
        });

        this.logger.log('Upload marcado como VALIDADO — todos cartões aprovados', {
          tenantId,
          uploadId: cartao.uploadId,
        });
      }

      return updated;
    });

    this.logger.log('CartaoPonto aprovado', {
      tenantId,
      cartaoPontoId,
      userId,
    });

    // Generate ground truth dataset from approved card (non-blocking)
    this.groundTruthService
      .generateFromApproval(cartaoPontoId, tenantId)
      .catch((err: unknown) => {
        this.logger.error('Falha ao gerar ground truth', {
          cartaoPontoId,
          error: err instanceof Error ? err.message : String(err),
        });
      });

    return result;
  }

  /** Reject a CartaoPonto with a motivo. */
  async rejeitar(
    tenantId: string,
    cartaoPontoId: string,
    userId: string,
    motivo: string,
  ) {
    const cartao = await this.prisma.cartaoPonto.findFirst({
      where: { id: cartaoPontoId, tenantId },
    });

    if (!cartao) {
      throw new NotFoundException(`CartaoPonto ${cartaoPontoId} não encontrado`);
    }

    if (cartao.statusRevisao === StatusRevisao.APROVADO) {
      throw new BadRequestException('Cartão já aprovado não pode ser rejeitado');
    }

    const result = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.cartaoPonto.update({
        where: { id: cartaoPontoId },
        data: { statusRevisao: StatusRevisao.REJEITADO },
      });

      await tx.revisao.create({
        data: {
          tenantId,
          cartaoPontoId,
          userId,
          acao: AcaoRevisao.REJEICAO,
          observacao: motivo,
        },
      });

      return updated;
    });

    this.logger.log('CartaoPonto rejeitado', {
      tenantId,
      cartaoPontoId,
      userId,
      motivo,
    });

    return result;
  }

  /** Get revision history for a CartaoPonto. */
  async getHistorico(tenantId: string, cartaoPontoId: string) {
    // Verify cartão exists and belongs to tenant
    const cartao = await this.prisma.cartaoPonto.findFirst({
      where: { id: cartaoPontoId, tenantId },
      select: { id: true },
    });

    if (!cartao) {
      throw new NotFoundException(`CartaoPonto ${cartaoPontoId} não encontrado`);
    }

    const revisoes = await this.prisma.revisao.findMany({
      where: { cartaoPontoId, tenantId },
      orderBy: { createdAt: 'desc' },
      include: {
        user: { select: { id: true, nome: true, email: true } },
      },
    });

    return revisoes;
  }
}
