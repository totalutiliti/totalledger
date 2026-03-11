import {
  Injectable,
  Logger,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateTenantDto } from './dto/create-tenant.dto';
import { UpdateTenantDto } from './dto/update-tenant.dto';
import { PaginationDto, buildPaginationMeta } from '../../common/dto/pagination.dto';

@Injectable()
export class TenantService {
  private readonly logger = new Logger(TenantService.name);

  constructor(private readonly prisma: PrismaService) {}

  async findAll(query: PaginationDto) {
    const { page = 1, limit = 20 } = query;

    const [data, total] = await Promise.all([
      this.prisma.tenant.findMany({
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { nome: 'asc' },
      }),
      this.prisma.tenant.count(),
    ]);

    return {
      data,
      meta: buildPaginationMeta(page, limit, total),
    };
  }

  async findOne(id: string) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id },
      include: {
        _count: {
          select: { usuarios: true, empresas: true },
        },
      },
    });

    if (!tenant) {
      throw new NotFoundException('Tenant não encontrado');
    }

    return tenant;
  }

  async create(dto: CreateTenantDto) {
    const existing = await this.prisma.tenant.findUnique({
      where: { cnpj: dto.cnpj },
    });

    if (existing) {
      throw new ConflictException('CNPJ já cadastrado');
    }

    const tenant = await this.prisma.tenant.create({
      data: {
        nome: dto.nome,
        cnpj: dto.cnpj,
        plano: dto.plano,
      },
    });

    this.logger.log('Tenant created', { tenantId: tenant.id, cnpj: dto.cnpj });

    return tenant;
  }

  async update(id: string, dto: UpdateTenantDto) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id },
    });

    if (!tenant) {
      throw new NotFoundException('Tenant não encontrado');
    }

    const updated = await this.prisma.tenant.update({
      where: { id },
      data: dto,
    });

    this.logger.log('Tenant updated', { tenantId: id });

    return updated;
  }

  async remove(id: string) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id },
    });

    if (!tenant) {
      throw new NotFoundException('Tenant não encontrado');
    }

    // Soft delete: desativar o tenant
    const updated = await this.prisma.tenant.update({
      where: { id },
      data: { ativo: false },
    });

    this.logger.log('Tenant deactivated', { tenantId: id });

    return updated;
  }
}
