import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditQueryDto } from './dto/audit-query.dto';
import { buildPaginationMeta } from '../../common/dto/pagination.dto';

export interface CreateAuditLogInput {
  tenantId: string;
  userId: string;
  acao: string;
  entidade: string;
  entidadeId: string;
  dados?: Prisma.InputJsonValue;
  ip?: string;
  userAgent?: string;
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  async log(input: CreateAuditLogInput): Promise<void> {
    await this.prisma.auditLog.create({
      data: {
        tenantId: input.tenantId,
        userId: input.userId,
        acao: input.acao,
        entidade: input.entidade,
        entidadeId: input.entidadeId,
        dados: input.dados ?? undefined,
        ip: input.ip,
        userAgent: input.userAgent,
      },
    });

    this.logger.log('Audit log created', {
      tenantId: input.tenantId,
      acao: input.acao,
      entidade: input.entidade,
      entidadeId: input.entidadeId,
    });
  }

  async findAll(query: AuditQueryDto) {
    const { page = 1, limit = 20, tenantId, userId, action, startDate, endDate } = query;

    const where: Prisma.AuditLogWhereInput = {};

    if (tenantId) {
      where.tenantId = tenantId;
    }

    if (userId) {
      where.userId = userId;
    }

    if (action) {
      where.acao = action;
    }

    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) {
        where.createdAt.gte = startDate;
      }
      if (endDate) {
        where.createdAt.lte = endDate;
      }
    }

    const [data, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          user: {
            select: { id: true, nome: true, email: true },
          },
        },
      }),
      this.prisma.auditLog.count({ where }),
    ]);

    return {
      data,
      meta: buildPaginationMeta(page, limit, total),
    };
  }

  async findByEntity(
    tenantId: string,
    entidade: string,
    entidadeId: string,
  ) {
    return this.prisma.auditLog.findMany({
      where: { tenantId, entidade, entidadeId },
      include: { user: { select: { id: true, nome: true, email: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }
}
