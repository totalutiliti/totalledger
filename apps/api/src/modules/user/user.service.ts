import {
  Injectable,
  Logger,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { HashingService } from '../auth/hashing/hashing.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import {
  PaginationDto,
  buildPaginationMeta,
} from '../../common/dto/pagination.dto';
import { Role } from '../../common/decorators/roles.decorator';
import { Prisma } from '@prisma/client';

export interface UserQueryDto extends PaginationDto {
  tenantId?: string;
  role?: string;
  ativo?: boolean;
}

@Injectable()
export class UserService {
  private readonly logger = new Logger(UserService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly hashingService: HashingService,
  ) {}

  async findAll(query: UserQueryDto) {
    const { page = 1, limit = 20, tenantId, role, ativo } = query;

    const where: Prisma.UserWhereInput = {};

    if (tenantId) {
      where.tenantId = tenantId;
    }

    if (role) {
      where.role = role as Role;
    }

    if (ativo !== undefined) {
      where.ativo = ativo;
    }

    const [data, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { nome: 'asc' },
        select: {
          id: true,
          tenantId: true,
          email: true,
          nome: true,
          role: true,
          ativo: true,
          mustChangePassword: true,
          lastLoginAt: true,
          createdAt: true,
          updatedAt: true,
          tenant: {
            select: { id: true, nome: true },
          },
        },
      }),
      this.prisma.user.count({ where }),
    ]);

    return {
      data,
      meta: buildPaginationMeta(page, limit, total),
    };
  }

  async findOne(id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        tenantId: true,
        email: true,
        nome: true,
        role: true,
        ativo: true,
        mustChangePassword: true,
        lastLoginAt: true,
        createdAt: true,
        updatedAt: true,
        createdBy: true,
        updatedBy: true,
        tenant: {
          select: { id: true, nome: true },
        },
      },
    });

    if (!user) {
      throw new NotFoundException(`Usuário ${id} não encontrado`);
    }

    return { data: user };
  }

  async create(dto: CreateUserDto, createdBy: string) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: dto.tenantId },
    });

    if (!tenant) {
      throw new BadRequestException(
        `Tenant ${dto.tenantId} não encontrado`,
      );
    }

    if (!tenant.ativo) {
      throw new BadRequestException(
        `Tenant ${dto.tenantId} está inativo`,
      );
    }

    await this.checkEmailUniqueness(dto.tenantId, dto.email);

    const passwordHash = await this.hashingService.hash(dto.password);

    const user = await this.prisma.user.create({
      data: {
        tenantId: dto.tenantId,
        email: dto.email,
        nome: dto.nome,
        role: dto.role,
        passwordHash,
        createdBy,
      },
      select: {
        id: true,
        tenantId: true,
        email: true,
        nome: true,
        role: true,
        ativo: true,
        mustChangePassword: true,
        createdAt: true,
      },
    });

    this.logger.log(`Usuário criado: ${user.id}`, {
      tenantId: dto.tenantId,
      userId: user.id,
      createdBy,
    });

    return { data: user };
  }

  async update(id: string, dto: UpdateUserDto, updatedBy: string) {
    const existing = await this.prisma.user.findUnique({
      where: { id },
    });

    if (!existing) {
      throw new NotFoundException(`Usuário ${id} não encontrado`);
    }

    const user = await this.prisma.user.update({
      where: { id },
      data: {
        ...dto,
        updatedBy,
      },
      select: {
        id: true,
        tenantId: true,
        email: true,
        nome: true,
        role: true,
        ativo: true,
        mustChangePassword: true,
        updatedAt: true,
      },
    });

    this.logger.log(`Usuário atualizado: ${user.id}`, {
      tenantId: existing.tenantId,
      userId: user.id,
      updatedBy,
    });

    return { data: user };
  }

  async deactivate(id: string) {
    const existing = await this.prisma.user.findUnique({
      where: { id },
    });

    if (!existing) {
      throw new NotFoundException(`Usuário ${id} não encontrado`);
    }

    await this.prisma.user.update({
      where: { id },
      data: { ativo: false },
    });

    this.logger.log(`Usuário desativado: ${id}`, {
      tenantId: existing.tenantId,
      userId: id,
    });
  }

  private async checkEmailUniqueness(
    tenantId: string,
    email: string,
    excludeId?: string,
  ) {
    const existing = await this.prisma.user.findFirst({
      where: {
        tenantId,
        email,
        ...(excludeId ? { id: { not: excludeId } } : {}),
      },
    });

    if (existing) {
      throw new ConflictException(
        `Email ${email} já cadastrado para este tenant`,
      );
    }
  }
}
