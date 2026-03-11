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
  HttpCode,
  HttpStatus,
  UsePipes,
} from '@nestjs/common';
import { ApiBearerAuth } from '@nestjs/swagger';
import { EmpresaService } from './empresa.service';
import { createEmpresaSchema, CreateEmpresaDto } from './dto/create-empresa.dto';
import { updateEmpresaSchema, UpdateEmpresaDto } from './dto/update-empresa.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles, Role } from '../../common/decorators/roles.decorator';
import { CurrentTenant } from '../../common/decorators/current-tenant.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { paginationSchema, PaginationDto } from '../../common/dto/pagination.dto';

@Controller('api/v1/empresas')
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
@ApiBearerAuth()
export class EmpresaController {
  constructor(private readonly empresaService: EmpresaService) {}

  @Get()
  @Roles(Role.ADMIN, Role.SUPERVISOR, Role.ANALISTA)
  async findAll(
    @CurrentTenant() tenantId: string,
    @Query(new ZodValidationPipe(paginationSchema)) query: PaginationDto,
  ) {
    return this.empresaService.findAll(tenantId, query);
  }

  @Get(':id')
  @Roles(Role.ADMIN, Role.SUPERVISOR, Role.ANALISTA)
  async findOne(
    @CurrentTenant() tenantId: string,
    @Param('id') id: string,
  ) {
    return this.empresaService.findOne(tenantId, id);
  }

  @Post()
  @Roles(Role.ADMIN)
  @UsePipes(new ZodValidationPipe(createEmpresaSchema))
  async create(
    @CurrentTenant() tenantId: string,
    @CurrentUser('sub') userId: string,
    @Body() dto: CreateEmpresaDto,
  ) {
    return this.empresaService.create(tenantId, userId, dto);
  }

  @Patch(':id')
  @Roles(Role.ADMIN)
  async update(
    @CurrentTenant() tenantId: string,
    @CurrentUser('sub') userId: string,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateEmpresaSchema)) dto: UpdateEmpresaDto,
  ) {
    return this.empresaService.update(tenantId, userId, id, dto);
  }

  @Delete(':id')
  @Roles(Role.ADMIN)
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @CurrentTenant() tenantId: string,
    @Param('id') id: string,
  ) {
    return this.empresaService.remove(tenantId, id);
  }
}
