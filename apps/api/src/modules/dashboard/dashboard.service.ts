import { Injectable, Logger } from '@nestjs/common';
import { TipoCartao, StatusRevisao, UploadStatus } from '@prisma/client';
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

interface ProcessamentoQuery extends PaginationDto {
  mesReferencia?: string;
  empresaId?: string;
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
}
