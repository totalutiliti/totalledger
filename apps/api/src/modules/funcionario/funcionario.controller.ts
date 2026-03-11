import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Query,
  Body,
  UseGuards,
  ParseUUIDPipe,
} from '@nestjs/common';
import { ApiBearerAuth } from '@nestjs/swagger';
import { FuncionarioService } from './funcionario.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles, Role } from '../../common/decorators/roles.decorator';
import { CurrentTenant } from '../../common/decorators/current-tenant.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import {
  paginationSchema,
  PaginationDto,
} from '../../common/dto/pagination.dto';
import {
  createFuncionarioSchema,
  CreateFuncionarioDto,
} from './dto/create-funcionario.dto';
import {
  updateFuncionarioSchema,
  UpdateFuncionarioDto,
} from './dto/update-funcionario.dto';

@Controller('api/v1/funcionarios')
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
@ApiBearerAuth()
export class FuncionarioController {
  constructor(private readonly funcionarioService: FuncionarioService) {}

  @Get()
  @Roles(Role.ADMIN, Role.SUPERVISOR, Role.ANALISTA)
  async findAll(
    @CurrentTenant() tenantId: string,
    @Query(new ZodValidationPipe(paginationSchema)) pagination: PaginationDto,
    @Query('empresaId') empresaId?: string,
  ) {
    return this.funcionarioService.findAll(tenantId, {
      ...pagination,
      empresaId,
    });
  }

  @Get(':id')
  @Roles(Role.ADMIN, Role.SUPERVISOR, Role.ANALISTA)
  async findOne(
    @CurrentTenant() tenantId: string,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    const data = await this.funcionarioService.findOne(tenantId, id);
    return { data };
  }

  @Post()
  @Roles(Role.ADMIN)
  async create(
    @CurrentTenant() tenantId: string,
    @Body(new ZodValidationPipe(createFuncionarioSchema))
    dto: CreateFuncionarioDto,
  ) {
    const data = await this.funcionarioService.create(tenantId, dto);
    return { data };
  }

  @Patch(':id')
  @Roles(Role.ADMIN)
  async update(
    @CurrentTenant() tenantId: string,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(updateFuncionarioSchema))
    dto: UpdateFuncionarioDto,
  ) {
    const data = await this.funcionarioService.update(tenantId, id, dto);
    return { data };
  }

  @Delete(':id')
  @Roles(Role.ADMIN)
  async remove(
    @CurrentTenant() tenantId: string,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    const data = await this.funcionarioService.remove(tenantId, id);
    return { data };
  }
}
