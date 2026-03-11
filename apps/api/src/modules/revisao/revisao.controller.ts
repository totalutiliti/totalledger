import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Query,
  Body,
  UseGuards,
  HttpCode,
  HttpStatus,
  ParseUUIDPipe,
} from '@nestjs/common';
import { ApiBearerAuth } from '@nestjs/swagger';
import { RevisaoService } from './revisao.service';
import { corrigirBatidaSchema, CorrigirBatidaDto } from './dto/corrigir-batida.dto';
import { rejeitarRevisaoSchema, RejeitarRevisaoDto } from './dto/rejeitar-revisao.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles, Role } from '../../common/decorators/roles.decorator';
import { CurrentTenant } from '../../common/decorators/current-tenant.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { paginationSchema, PaginationDto } from '../../common/dto/pagination.dto';

@Controller('api/v1/revisao')
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
@ApiBearerAuth()
export class RevisaoController {
  constructor(private readonly revisaoService: RevisaoService) {}

  @Get('pendentes')
  @Roles(Role.ADMIN, Role.SUPERVISOR, Role.ANALISTA)
  async findPendentes(
    @CurrentTenant() tenantId: string,
    @Query(new ZodValidationPipe(paginationSchema)) query: PaginationDto,
    @Query('empresaId') empresaId?: string,
    @Query('uploadId') uploadId?: string,
  ) {
    return this.revisaoService.findPendentes(tenantId, {
      ...query,
      empresaId,
      uploadId,
    });
  }

  @Get(':cartaoPontoId')
  @Roles(Role.ADMIN, Role.SUPERVISOR, Role.ANALISTA)
  async findOne(
    @CurrentTenant() tenantId: string,
    @Param('cartaoPontoId', ParseUUIDPipe) cartaoPontoId: string,
  ) {
    const data = await this.revisaoService.findOne(tenantId, cartaoPontoId);
    return { data };
  }

  @Patch(':cartaoPontoId/batidas/:batidaId')
  @Roles(Role.ADMIN, Role.SUPERVISOR, Role.ANALISTA)
  async corrigirBatida(
    @CurrentTenant() tenantId: string,
    @CurrentUser('sub') userId: string,
    @Param('cartaoPontoId', ParseUUIDPipe) cartaoPontoId: string,
    @Param('batidaId', ParseUUIDPipe) batidaId: string,
    @Body(new ZodValidationPipe(corrigirBatidaSchema)) dto: CorrigirBatidaDto,
  ) {
    const data = await this.revisaoService.corrigirBatida(
      tenantId,
      cartaoPontoId,
      batidaId,
      userId,
      dto,
    );
    return { data };
  }

  @Post(':cartaoPontoId/aprovar')
  @Roles(Role.ADMIN, Role.SUPERVISOR, Role.ANALISTA)
  @HttpCode(HttpStatus.OK)
  async aprovar(
    @CurrentTenant() tenantId: string,
    @CurrentUser('sub') userId: string,
    @Param('cartaoPontoId', ParseUUIDPipe) cartaoPontoId: string,
    @Body('observacao') observacao?: string,
  ) {
    const data = await this.revisaoService.aprovar(
      tenantId,
      cartaoPontoId,
      userId,
      observacao,
    );
    return { data };
  }

  @Post(':cartaoPontoId/rejeitar')
  @Roles(Role.ADMIN, Role.SUPERVISOR, Role.ANALISTA)
  @HttpCode(HttpStatus.OK)
  async rejeitar(
    @CurrentTenant() tenantId: string,
    @CurrentUser('sub') userId: string,
    @Param('cartaoPontoId', ParseUUIDPipe) cartaoPontoId: string,
    @Body(new ZodValidationPipe(rejeitarRevisaoSchema)) dto: RejeitarRevisaoDto,
  ) {
    const data = await this.revisaoService.rejeitar(
      tenantId,
      cartaoPontoId,
      userId,
      dto.motivo,
    );
    return { data };
  }

  @Get(':cartaoPontoId/historico')
  @Roles(Role.ADMIN, Role.SUPERVISOR, Role.ANALISTA)
  async getHistorico(
    @CurrentTenant() tenantId: string,
    @Param('cartaoPontoId', ParseUUIDPipe) cartaoPontoId: string,
  ) {
    const data = await this.revisaoService.getHistorico(tenantId, cartaoPontoId);
    return { data };
  }
}
