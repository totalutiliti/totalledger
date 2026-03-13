import { Injectable, Logger } from '@nestjs/common';
import { AcaoRevisao, TipoCartao, StatusRevisao, UploadStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  PaginationDto,
  buildPaginationMeta,
} from '../../common/dto/pagination.dto';

export interface ResumoResult {
  totalUploads: number;
  totalProcessados: number;
  totalPendentes: number;
  totalErros: number;
  totalValidados: number;
  totalExportados: number;
  totalCartoes: number;
  totalBatidas: number;
}

export interface MetricasOcrResult {
  confiancaMedia: number | null;
  totalPorTipoCartao: Record<TipoCartao, number>;
  totalPorStatusRevisao: Record<StatusRevisao, number>;
  taxaAprovacao: number;
}

export interface GlobalDashboardResult {
  totalTenants: number;
  totalUsers: number;
  totalUploads: number;
  totalCartoes: number;
  statusBreakdown: { status: string; count: number }[];
  uploadsByTenant: { tenantNome: string; count: number }[];
}

export interface UsageMetricsResult {
  periodo: { de: string; ate: string };
  documentIntelligence: {
    totalPaginas: number;
    custoEstimadoUsd: number;
    precoPor1000: number;
  };
  gptMini: {
    chamadas: number;
    tokensIn: number;
    tokensOut: number;
    custoUsd: number;
  };
  gpt52: {
    chamadas: number;
    tokensIn: number;
    tokensOut: number;
    custoUsd: number;
  };
  gpt4oMini: {
    chamadas: number;
    tokensIn: number;
    tokensOut: number;
    custoUsd: number;
  };
  custoTotalUsd: number;
  totalUploadsProcessados: number;
}

export interface OcrAccuracyResult {
  totalGroundTruthRecords: number;
  globalAccuracy: { di: number; gpt: number; sanitizer: number };
  byField: Array<{
    campo: string;
    total: number;
    acuraciaDi: number;
    acuraciaGpt: number;
  }>;
  byTipoCartao: Record<string, { di: number; gpt: number; total: number }>;
  totalCorrections: number;
  correctionsByUser: Array<{
    userId: string;
    nome: string;
    email: string;
    count: number;
  }>;
}

export interface CorrectionRecordResult {
  id: string;
  campo: string;
  valorAnterior: string | null;
  valorNovo: string | null;
  observacao: string | null;
  createdAt: Date;
  user: { nome: string; email: string };
  cartaoPonto: {
    id: string;
    paginaPdf: number;
    nomeExtraido: string | null;
    upload: { id: string; nomeArquivo: string };
  };
}

interface ProcessamentoQuery extends PaginationDto {
  mesReferencia?: string;
  empresaId?: string;
}

interface CorrectionsQuery extends PaginationDto {
  de?: string;
  ate?: string;
  userId?: string;
}

@Injectable()
export class DashboardService {
  private readonly logger = new Logger(DashboardService.name);

  constructor(private readonly prisma: PrismaService) {}

  async getGlobalDashboard(): Promise<GlobalDashboardResult> {
    this.logger.log('Fetching global dashboard metrics');

    const [totalTenants, totalUsers, totalUploads, totalCartoes, statusGroups, tenantUploads] =
      await Promise.all([
        this.prisma.tenant.count({ where: { ativo: true } }),
        this.prisma.user.count({ where: { ativo: true } }),
        this.prisma.upload.count({ where: { deletedAt: null } }),
        this.prisma.cartaoPonto.count(),
        this.prisma.upload.groupBy({
          by: ['status'],
          where: { deletedAt: null },
          _count: { _all: true },
        }),
        this.prisma.upload.groupBy({
          by: ['tenantId'],
          where: { deletedAt: null },
          _count: { _all: true },
          orderBy: { _count: { tenantId: 'desc' } },
          take: 10,
        }),
      ]);

    const statusBreakdown = statusGroups.map((g) => ({
      status: g.status,
      count: g._count._all,
    }));

    // Resolve tenant names for top uploaders
    const tenantIds = tenantUploads.map((t) => t.tenantId);
    const tenants = tenantIds.length > 0
      ? await this.prisma.tenant.findMany({
          where: { id: { in: tenantIds } },
          select: { id: true, nome: true },
        })
      : [];

    const tenantNameMap = new Map(tenants.map((t) => [t.id, t.nome]));
    const uploadsByTenant = tenantUploads.map((t) => ({
      tenantNome: tenantNameMap.get(t.tenantId) ?? 'Desconhecido',
      count: t._count._all,
    }));

    return {
      totalTenants,
      totalUsers,
      totalUploads,
      totalCartoes,
      statusBreakdown,
      uploadsByTenant,
    };
  }

  async getUsageMetrics(
    de?: string,
    ate?: string,
    tenantId?: string,
  ): Promise<UsageMetricsResult> {
    this.logger.log(
      `Fetching usage metrics: de=${de ?? 'all'}, ate=${ate ?? 'all'}, tenant=${tenantId ?? 'all'}`,
    );

    const where: Record<string, unknown> = {};
    if (tenantId) where['tenantId'] = tenantId;
    if (de || ate) {
      where['createdAt'] = {
        ...(de ? { gte: new Date(de) } : {}),
        ...(ate ? { lte: new Date(`${ate}T23:59:59.999Z`) } : {}),
      };
    }

    const aggregation = await this.prisma.pipelineMetrics.aggregate({
      where,
      _sum: {
        totalPaginas: true,
        chamadasGpt: true,
        gptTokensIn: true,
        gptTokensOut: true,
        gptCustoDolar: true,
        chamadasMini: true,
        miniTokensIn: true,
        miniTokensOut: true,
        miniCustoDolar: true,
        chamadasGpt52: true,
        gpt52TokensIn: true,
        gpt52TokensOut: true,
        gpt52CustoDolar: true,
      },
      _count: { _all: true },
      _min: { createdAt: true },
      _max: { createdAt: true },
    });

    const s = aggregation._sum;
    const totalPaginas = s.totalPaginas ?? 0;

    // Azure DI pricing: prebuilt-layout = $10 per 1,000 pages
    const diPrecoPor1000 = 10;
    const diCustoUsd = (totalPaginas / 1000) * diPrecoPor1000;

    const miniCusto = s.miniCustoDolar ?? 0;
    const gpt52Custo = s.gpt52CustoDolar ?? 0;
    const gptCusto = s.gptCustoDolar ?? 0;

    const periodoMin = aggregation._min.createdAt ?? new Date();
    const periodoMax = aggregation._max.createdAt ?? new Date();

    return {
      periodo: {
        de: de ?? periodoMin.toISOString().slice(0, 10),
        ate: ate ?? periodoMax.toISOString().slice(0, 10),
      },
      documentIntelligence: {
        totalPaginas,
        custoEstimadoUsd: Math.round(diCustoUsd * 100) / 100,
        precoPor1000: diPrecoPor1000,
      },
      gptMini: {
        chamadas: s.chamadasMini ?? 0,
        tokensIn: s.miniTokensIn ?? 0,
        tokensOut: s.miniTokensOut ?? 0,
        custoUsd: Math.round(miniCusto * 100) / 100,
      },
      gpt52: {
        chamadas: s.chamadasGpt52 ?? 0,
        tokensIn: s.gpt52TokensIn ?? 0,
        tokensOut: s.gpt52TokensOut ?? 0,
        custoUsd: Math.round(gpt52Custo * 100) / 100,
      },
      gpt4oMini: {
        chamadas: s.chamadasGpt ?? 0,
        tokensIn: s.gptTokensIn ?? 0,
        tokensOut: s.gptTokensOut ?? 0,
        custoUsd: Math.round(gptCusto * 100) / 100,
      },
      custoTotalUsd:
        Math.round((diCustoUsd + miniCusto + gpt52Custo + gptCusto) * 100) / 100,
      totalUploadsProcessados: aggregation._count._all,
    };
  }

  async getResumo(tenantId: string): Promise<ResumoResult> {
    this.logger.log(`Fetching resumo for tenant ${tenantId}`);

    const [
      totalUploads,
      totalProcessados,
      totalPendentes,
      totalErros,
      totalValidados,
      totalExportados,
      totalCartoes,
      totalBatidas,
    ] = await Promise.all([
      this.prisma.upload.count({
        where: { tenantId, deletedAt: null },
      }),
      this.prisma.upload.count({
        where: { tenantId, deletedAt: null, status: UploadStatus.PROCESSADO },
      }),
      this.prisma.upload.count({
        where: { tenantId, deletedAt: null, status: UploadStatus.AGUARDANDO },
      }),
      this.prisma.upload.count({
        where: { tenantId, deletedAt: null, status: UploadStatus.ERRO },
      }),
      this.prisma.upload.count({
        where: { tenantId, deletedAt: null, status: UploadStatus.VALIDADO },
      }),
      this.prisma.upload.count({
        where: { tenantId, deletedAt: null, status: UploadStatus.EXPORTADO },
      }),
      this.prisma.cartaoPonto.count({
        where: { tenantId },
      }),
      this.prisma.batida.count({
        where: { tenantId },
      }),
    ]);

    return {
      totalUploads,
      totalProcessados,
      totalPendentes,
      totalErros,
      totalValidados,
      totalExportados,
      totalCartoes,
      totalBatidas,
    };
  }

  async getMetricasOcr(tenantId: string): Promise<MetricasOcrResult> {
    this.logger.log(`Fetching metricas OCR for tenant ${tenantId}`);

    const [aggregation, tipoCartaoGroup, statusRevisaoGroup, totalCartoes] =
      await Promise.all([
        this.prisma.cartaoPonto.aggregate({
          where: { tenantId },
          _avg: { confiancaGeral: true },
        }),
        this.prisma.cartaoPonto.groupBy({
          by: ['tipoCartao'],
          where: { tenantId },
          _count: { _all: true },
        }),
        this.prisma.cartaoPonto.groupBy({
          by: ['statusRevisao'],
          where: { tenantId },
          _count: { _all: true },
        }),
        this.prisma.cartaoPonto.count({
          where: { tenantId },
        }),
      ]);

    const totalPorTipoCartao: Record<TipoCartao, number> = {
      [TipoCartao.ELETRONICO]: 0,
      [TipoCartao.MANUSCRITO]: 0,
      [TipoCartao.HIBRIDO]: 0,
      [TipoCartao.DESCONHECIDO]: 0,
    };

    for (const group of tipoCartaoGroup) {
      totalPorTipoCartao[group.tipoCartao] = group._count._all;
    }

    const totalPorStatusRevisao: Record<StatusRevisao, number> = {
      [StatusRevisao.PENDENTE]: 0,
      [StatusRevisao.EM_REVISAO]: 0,
      [StatusRevisao.APROVADO]: 0,
      [StatusRevisao.REJEITADO]: 0,
    };

    for (const group of statusRevisaoGroup) {
      totalPorStatusRevisao[group.statusRevisao] = group._count._all;
    }

    const totalAprovados = totalPorStatusRevisao[StatusRevisao.APROVADO];
    const taxaAprovacao = totalCartoes > 0 ? totalAprovados / totalCartoes : 0;

    return {
      confiancaMedia: aggregation._avg.confiancaGeral,
      totalPorTipoCartao,
      totalPorStatusRevisao,
      taxaAprovacao,
    };
  }

  async getProcessamento(tenantId: string, query: ProcessamentoQuery) {
    const { page = 1, limit = 20, mesReferencia, empresaId } = query;

    this.logger.log(
      `Fetching processamento for tenant ${tenantId}, page=${page}, limit=${limit}`,
    );

    const where = {
      tenantId,
      deletedAt: null,
      ...(mesReferencia ? { mesReferencia } : {}),
      ...(empresaId ? { empresaId } : {}),
    };

    const [uploads, total] = await Promise.all([
      this.prisma.upload.findMany({
        where,
        select: {
          id: true,
          nomeArquivo: true,
          status: true,
          empresaId: true,
          mesReferencia: true,
          createdAt: true,
          processadoEm: true,
          empresa: {
            select: { razaoSocial: true },
          },
          _count: {
            select: { cartoesPonto: true },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.upload.count({ where }),
    ]);

    const data = uploads.map((upload) => ({
      id: upload.id,
      nomeArquivo: upload.nomeArquivo,
      status: upload.status,
      empresaId: upload.empresaId,
      razaoSocial: upload.empresa.razaoSocial,
      mesReferencia: upload.mesReferencia,
      createdAt: upload.createdAt,
      processadoEm: upload.processadoEm,
      totalCartoes: upload._count.cartoesPonto,
    }));

    return {
      data,
      meta: buildPaginationMeta(page, limit, total),
    };
  }

  /** OCR accuracy metrics from GroundTruth + correction counts (SUPER_ADMIN). */
  async getOcrAccuracy(de?: string, ate?: string): Promise<OcrAccuracyResult> {
    this.logger.log(`Fetching OCR accuracy: de=${de ?? 'all'}, ate=${ate ?? 'all'}`);

    const dateFilter: Record<string, unknown> = {};
    if (de || ate) {
      dateFilter['createdAt'] = {
        ...(de ? { gte: new Date(de) } : {}),
        ...(ate ? { lte: new Date(`${ate}T23:59:59.999Z`) } : {}),
      };
    }

    // 1. Global accuracy from GroundTruth
    const groundTruthRecords = await this.prisma.groundTruth.findMany({
      where: dateFilter,
      select: {
        campo: true,
        tipoCartao: true,
        acertouDi: true,
        acertouGpt: true,
        acertouSanitizer: true,
      },
    });

    const totalGT = groundTruthRecords.length;

    // Global accuracy
    let diCorrect = 0;
    let gptCorrect = 0;
    let sanitizerCorrect = 0;
    for (const gt of groundTruthRecords) {
      if (gt.acertouDi === true) diCorrect++;
      if (gt.acertouGpt === true) gptCorrect++;
      if (gt.acertouSanitizer === true) sanitizerCorrect++;
    }

    const globalAccuracy = {
      di: totalGT > 0 ? diCorrect / totalGT : 0,
      gpt: totalGT > 0 ? gptCorrect / totalGT : 0,
      sanitizer: totalGT > 0 ? sanitizerCorrect / totalGT : 0,
    };

    // By field
    const fieldMap = new Map<string, { total: number; di: number; gpt: number }>();
    for (const gt of groundTruthRecords) {
      const entry = fieldMap.get(gt.campo) ?? { total: 0, di: 0, gpt: 0 };
      entry.total++;
      if (gt.acertouDi === true) entry.di++;
      if (gt.acertouGpt === true) entry.gpt++;
      fieldMap.set(gt.campo, entry);
    }

    const byField = Array.from(fieldMap.entries()).map(([campo, stats]) => ({
      campo,
      total: stats.total,
      acuraciaDi: stats.total > 0 ? stats.di / stats.total : 0,
      acuraciaGpt: stats.total > 0 ? stats.gpt / stats.total : 0,
    }));

    // By tipoCartao
    const tipoMap = new Map<string, { total: number; di: number; gpt: number }>();
    for (const gt of groundTruthRecords) {
      const tipo = gt.tipoCartao ?? 'DESCONHECIDO';
      const entry = tipoMap.get(tipo) ?? { total: 0, di: 0, gpt: 0 };
      entry.total++;
      if (gt.acertouDi === true) entry.di++;
      if (gt.acertouGpt === true) entry.gpt++;
      tipoMap.set(tipo, entry);
    }

    const byTipoCartao: Record<string, { di: number; gpt: number; total: number }> = {};
    for (const [tipo, stats] of tipoMap.entries()) {
      byTipoCartao[tipo] = {
        di: stats.total > 0 ? stats.di / stats.total : 0,
        gpt: stats.total > 0 ? stats.gpt / stats.total : 0,
        total: stats.total,
      };
    }

    // 2. Correction counts from Revisao
    const totalCorrections = await this.prisma.revisao.count({
      where: { acao: AcaoRevisao.CORRECAO, ...dateFilter },
    });

    // Corrections by user
    const correctionGroups = await this.prisma.revisao.groupBy({
      by: ['userId'],
      where: { acao: AcaoRevisao.CORRECAO, ...dateFilter },
      _count: { _all: true },
      orderBy: { _count: { userId: 'desc' } },
      take: 20,
    });

    const userIds = correctionGroups.map((g) => g.userId);
    const users = userIds.length > 0
      ? await this.prisma.user.findMany({
          where: { id: { in: userIds } },
          select: { id: true, nome: true, email: true },
        })
      : [];

    const userMap = new Map(users.map((u) => [u.id, u]));
    const correctionsByUser = correctionGroups.map((g) => {
      const user = userMap.get(g.userId);
      return {
        userId: g.userId,
        nome: user?.nome ?? 'Desconhecido',
        email: user?.email ?? '',
        count: g._count._all,
      };
    });

    return {
      totalGroundTruthRecords: totalGT,
      globalAccuracy,
      byField,
      byTipoCartao,
      totalCorrections,
      correctionsByUser,
    };
  }

  /** Paginated list of human corrections (SUPER_ADMIN). */
  async getCorrections(query: CorrectionsQuery) {
    const { page = 1, limit = 20, de, ate, userId } = query;

    this.logger.log(`Fetching corrections: page=${page}, limit=${limit}`);

    const where: Record<string, unknown> = {
      acao: AcaoRevisao.CORRECAO,
    };
    if (userId) where['userId'] = userId;
    if (de || ate) {
      where['createdAt'] = {
        ...(de ? { gte: new Date(de) } : {}),
        ...(ate ? { lte: new Date(`${ate}T23:59:59.999Z`) } : {}),
      };
    }

    const [data, total] = await Promise.all([
      this.prisma.revisao.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          campo: true,
          valorAnterior: true,
          valorNovo: true,
          observacao: true,
          createdAt: true,
          user: { select: { nome: true, email: true } },
          cartaoPonto: {
            select: {
              id: true,
              paginaPdf: true,
              nomeExtraido: true,
              upload: { select: { id: true, nomeArquivo: true } },
            },
          },
        },
      }),
      this.prisma.revisao.count({ where }),
    ]);

    return {
      data,
      meta: buildPaginationMeta(page, limit, total),
    };
  }
}
