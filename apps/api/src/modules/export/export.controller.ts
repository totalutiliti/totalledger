import {
  Controller,
  Post,
  Body,
  Res,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiBearerAuth } from '@nestjs/swagger';
import { Response } from 'express';
import { ExportService } from './export.service';
import {
  ExportRequestDto,
  exportRequestSchema,
} from './dto/export-request.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles, Role } from '../../common/decorators/roles.decorator';
import { CurrentTenant } from '../../common/decorators/current-tenant.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';

@Controller('api/v1/export')
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
@ApiBearerAuth()
export class ExportController {
  constructor(private readonly exportService: ExportService) {}

  @Post('csv')
  @Roles(Role.ADMIN, Role.SUPERVISOR)
  @HttpCode(HttpStatus.OK)
  async exportCsv(
    @CurrentTenant() tenantId: string,
    @Body(new ZodValidationPipe(exportRequestSchema)) dto: ExportRequestDto,
    @Res() res: Response,
  ): Promise<void> {
    const result = await this.exportService.generateCsv(tenantId, dto);

    res.set({
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${result.fileName}"`,
      'Content-Length': String(result.buffer.length),
      'X-Total-Registros': String(result.totalRegistros),
    });

    res.send(result.buffer);
  }

  @Post('xlsx')
  @Roles(Role.ADMIN, Role.SUPERVISOR)
  @HttpCode(HttpStatus.OK)
  async exportXlsx(
    @CurrentTenant() tenantId: string,
    @Body(new ZodValidationPipe(exportRequestSchema)) dto: ExportRequestDto,
    @Res() res: Response,
  ): Promise<void> {
    const result = await this.exportService.generateXlsx(tenantId, dto);

    res.set({
      'Content-Type':
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${result.fileName}"`,
      'Content-Length': String(result.buffer.length),
      'X-Total-Registros': String(result.totalRegistros),
    });

    res.send(result.buffer);
  }
}
