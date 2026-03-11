import {
  Injectable,
  Logger,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateFuncionarioDto } from './dto/create-funcionario.dto';
import { UpdateFuncionarioDto } from './dto/update-funcionario.dto';
import {
  PaginationDto,
  buildPaginationMeta,
  PaginationMeta,
} from '../../common/dto/pagination.dto';
import { Funcionario } from '@prisma/client';

interface FuncionarioListQuery extends PaginationDto {
  empresaId?: string;
}

export interface PaginatedResult {
  data: Funcionario[];
  meta: PaginationMeta;
}

@Injectable()
export class FuncionarioService {
  private readonly logger = new Logger(FuncionarioService.name);

  constructor(private readonly prisma: PrismaService) {}

  async findAll(
    tenantId: string,
    query: FuncionarioListQuery,
  ): Promise<PaginatedResult> {
    const { page, limit, empresaId } = query;
    const skip = (page - 1) * limit;

    const where = {
      tenantId,
      deletedAt: null,
      ...(empresaId ? { empresaId } : {}),
    };

    const [data, total] = await Promise.all([
      this.prisma.funcionario.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.funcionario.count({ where }),
    ]);

    this.logger.log({
      message: 'Listed funcionarios',
      tenantId,
      total,
      page,
      limit,
    });

    return {
      data,
      meta: buildPaginationMeta(page, limit, total),
    };
  }

  async findOne(tenantId: string, id: string): Promise<Funcionario> {
    const funcionario = await this.prisma.funcionario.findFirst({
      where: { id, tenantId, deletedAt: null },
      include: { empresa: true },
    });

    if (!funcionario) {
      throw new NotFoundException(`Funcionário ${id} não encontrado`);
    }

    return funcionario;
  }

  async create(
    tenantId: string,
    dto: CreateFuncionarioDto,
  ): Promise<Funcionario> {
    // Validate that empresa belongs to the tenant
    const empresa = await this.prisma.empresa.findFirst({
      where: { id: dto.empresaId, tenantId, deletedAt: null },
    });

    if (!empresa) {
      throw new BadRequestException(
        `Empresa ${dto.empresaId} não encontrada neste tenant`,
      );
    }

    // Check CPF uniqueness within tenant + empresa
    if (dto.cpf) {
      const existing = await this.prisma.funcionario.findFirst({
        where: {
          tenantId,
          empresaId: dto.empresaId,
          cpf: dto.cpf,
          deletedAt: null,
        },
      });

      if (existing) {
        throw new ConflictException(
          `Já existe um funcionário com CPF ${dto.cpf} nesta empresa`,
        );
      }
    }

    const funcionario = await this.prisma.funcionario.create({
      data: {
        tenantId,
        ...dto,
      },
    });

    this.logger.log({
      message: 'Created funcionario',
      tenantId,
      funcionarioId: funcionario.id,
    });

    return funcionario;
  }

  async update(
    tenantId: string,
    id: string,
    dto: UpdateFuncionarioDto,
  ): Promise<Funcionario> {
    const existing = await this.prisma.funcionario.findFirst({
      where: { id, tenantId, deletedAt: null },
    });

    if (!existing) {
      throw new NotFoundException(`Funcionário ${id} não encontrado`);
    }

    // If CPF is being changed, check uniqueness
    if (dto.cpf && dto.cpf !== existing.cpf) {
      const duplicate = await this.prisma.funcionario.findFirst({
        where: {
          tenantId,
          empresaId: existing.empresaId,
          cpf: dto.cpf,
          deletedAt: null,
          id: { not: id },
        },
      });

      if (duplicate) {
        throw new ConflictException(
          `Já existe um funcionário com CPF ${dto.cpf} nesta empresa`,
        );
      }
    }

    const funcionario = await this.prisma.funcionario.update({
      where: { id },
      data: dto,
    });

    this.logger.log({
      message: 'Updated funcionario',
      tenantId,
      funcionarioId: id,
    });

    return funcionario;
  }

  async remove(tenantId: string, id: string): Promise<Funcionario> {
    const existing = await this.prisma.funcionario.findFirst({
      where: { id, tenantId, deletedAt: null },
    });

    if (!existing) {
      throw new NotFoundException(`Funcionário ${id} não encontrado`);
    }

    const funcionario = await this.prisma.funcionario.update({
      where: { id },
      data: { deletedAt: new Date() },
    });

    this.logger.log({
      message: 'Soft deleted funcionario',
      tenantId,
      funcionarioId: id,
    });

    return funcionario;
  }
}
