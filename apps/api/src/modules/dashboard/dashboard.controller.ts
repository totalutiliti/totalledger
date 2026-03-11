import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth } from '@nestjs/swagger';
import { DashboardService } from './dashboard.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles, Role } from '../../common/decorators/roles.decorator';
import { CurrentTenant } from '../../common/decorators/current-tenant.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { paginationSchema, PaginationDto } from '../../common/dto/pagination.dto';

@Controller('api/v1/dashboard')
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
@ApiBearerAuth()
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  @Get('global')
  @Roles(Role.SUPER_ADMIN)
  async getGlobalDashboard() {
    const data = await this.dashboardService.getGlobalDashboard();
    return { data };
  }

  @Get('resumo')
  @Roles(Role.ADMIN, Role.SUPERVISOR, Role.ANALISTA)
  async getResumo(@CurrentTenant() tenantId: string) {
    const data = await this.dashboardService.getResumo(tenantId);
    return { data };
  }

  @Get('metricas-ocr')
  @Roles(Role.ADMIN, Role.SUPERVISOR, Role.ANALISTA)
  async getMetricasOcr(@CurrentTenant() tenantId: string) {
    const data = await this.dashboardService.getMetricasOcr(tenantId);
    return { data };
  }

  @Get('processamento')
  @Roles(Role.ADMIN, Role.SUPERVISOR, Role.ANALISTA)
  async getProcessamento(
    @CurrentTenant() tenantId: string,
    @Query(new ZodValidationPipe(paginationSchema)) query: PaginationDto,
    @Query('mesReferencia') mesReferencia?: string,
    @Query('empresaId') empresaId?: string,
  ) {
    return this.dashboardService.getProcessamento(tenantId, {
      ...query,
      mesReferencia,
      empresaId,
    });
  }
}
