import {
  Injectable,
  Logger,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateEmpresaDto } from './dto/create-empresa.dto';
import { UpdateEmpresaDto } from './dto/update-empresa.dto';
import {
  PaginationDto,
  buildPaginationMeta,
} from '../../common/dto/pagination.dto';

@Injectable()
export class EmpresaService {
  private readonly logger = new Logger(EmpresaService.name);

  constructor(private readonly prisma: PrismaService) {}

  async findAll(tenantId: string, query: PaginationDto) {
    const { page = 1, limit = 20 } = query;

    const where = { tenantId, deletedAt: null };

    const [data, total] = await Promise.all([
      this.prisma.empresa.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { razaoSocial: 'asc' },
      }),
      this.prisma.empresa.count({ where }),
    ]);

    return {
      data,
      meta: buildPaginationMeta(page, limit, total),
    };
  }

  async findOne(tenantId: string, id: string) {
    const empresa = await this.prisma.empresa.findFirst({
      where: { id, tenantId, deletedAt: null },
    });

    if (!empresa) {
      throw new NotFoundException(`Empresa ${id} não encontrada`);
    }

    return { data: empresa };
  }

  async create(tenantId: string, userId: string, dto: CreateEmpresaDto) {
    await this.checkCnpjUniqueness(tenantId, dto.cnpj);

    const empresa = await this.prisma.empresa.create({
      data: {
        ...dto,
        tenantId,
        createdBy: userId,
      },
    });

    this.logger.log(`Empresa criada: ${empresa.id}`, {
      tenantId,
      userId,
      empresaId: empresa.id,
    });

    return { data: empresa };
  }

  async update(
    tenantId: string,
    userId: string,
    id: string,
    dto: UpdateEmpresaDto,
  ) {
    const existing = await this.prisma.empresa.findFirst({
      where: { id, tenantId, deletedAt: null },
    });

    if (!existing) {
      throw new NotFoundException(`Empresa ${id} não encontrada`);
    }

    if (dto.cnpj && dto.cnpj !== existing.cnpj) {
      await this.checkCnpjUniqueness(tenantId, dto.cnpj, id);
    }

    const empresa = await this.prisma.empresa.update({
      where: { id },
      data: {
        ...dto,
        updatedBy: userId,
      },
    });

    this.logger.log(`Empresa atualizada: ${empresa.id}`, {
      tenantId,
      userId,
      empresaId: empresa.id,
    });

    return { data: empresa };
  }

  async remove(tenantId: string, id: string) {
    const existing = await this.prisma.empresa.findFirst({
      where: { id, tenantId, deletedAt: null },
    });

    if (!existing) {
      throw new NotFoundException(`Empresa ${id} não encontrada`);
    }

    await this.prisma.empresa.update({
      where: { id },
      data: { deletedAt: new Date() },
    });

    this.logger.log(`Empresa removida (soft delete): ${id}`, {
      tenantId,
      empresaId: id,
    });
  }

  private async checkCnpjUniqueness(
    tenantId: string,
    cnpj: string,
    excludeId?: string,
  ) {
    const existing = await this.prisma.empresa.findFirst({
      where: {
        tenantId,
        cnpj,
        deletedAt: null,
        ...(excludeId ? { id: { not: excludeId } } : {}),
      },
    });

    if (existing) {
      throw new ConflictException(
        `CNPJ ${cnpj} já cadastrado para este tenant`,
      );
    }
  }
}
