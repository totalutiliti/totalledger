import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  Query,
  Body,
  Res,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  UploadedFiles,
  HttpCode,
  HttpStatus,
  ParseFilePipe,
} from '@nestjs/common';
import type { Response } from 'express';
import { FileInterceptor, FilesInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth } from '@nestjs/swagger';
import { UploadService } from './upload.service';
import { CreateUploadDto, createUploadSchema } from './dto/create-upload.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles, Role } from '../../common/decorators/roles.decorator';
import { CurrentTenant } from '../../common/decorators/current-tenant.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { paginationSchema, PaginationDto } from '../../common/dto/pagination.dto';

@Controller('api/v1/uploads')
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
@ApiBearerAuth()
export class UploadController {
  constructor(private readonly uploadService: UploadService) {}

  @Get()
  @Roles(Role.ADMIN, Role.SUPERVISOR, Role.ANALISTA)
  async findAll(
    @CurrentTenant() tenantId: string,
    @Query(new ZodValidationPipe(paginationSchema)) query: PaginationDto,
    @Query('empresaId') empresaId?: string,
    @Query('status') status?: string,
  ) {
    return this.uploadService.findAll(tenantId, { ...query, empresaId, status });
  }

  @Get(':id')
  @Roles(Role.ADMIN, Role.SUPERVISOR, Role.ANALISTA)
  async findOne(
    @CurrentTenant() tenantId: string,
    @Param('id') id: string,
  ) {
    const data = await this.uploadService.findOne(tenantId, id);
    return { data };
  }

  @Get(':id/status')
  @Roles(Role.ADMIN, Role.SUPERVISOR, Role.ANALISTA)
  async getStatus(
    @CurrentTenant() tenantId: string,
    @Param('id') id: string,
  ) {
    const data = await this.uploadService.getStatus(tenantId, id);
    return { data };
  }

  @Get(':id/pdf')
  @Roles(Role.ADMIN, Role.SUPERVISOR, Role.ANALISTA)
  async downloadPdf(
    @CurrentTenant() tenantId: string,
    @Param('id') id: string,
    @Res() res: Response,
  ) {
    const { buffer, fileName } = await this.uploadService.downloadPdf(tenantId, id);
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${encodeURIComponent(fileName)}"`,
      'Content-Length': buffer.length.toString(),
    });
    res.end(buffer);
  }

  @Post()
  @Roles(Role.ADMIN, Role.SUPERVISOR, Role.ANALISTA)
  @HttpCode(HttpStatus.ACCEPTED)
  @UseInterceptors(FileInterceptor('file'))
  async uploadSingle(
    @CurrentTenant() tenantId: string,
    @CurrentUser('sub') userId: string,
    @Body(new ZodValidationPipe(createUploadSchema)) dto: CreateUploadDto,
    @UploadedFile(new ParseFilePipe({ fileIsRequired: true }))
    file: Express.Multer.File,
  ) {
    const data = await this.uploadService.uploadSingle({
      tenantId,
      userId,
      dto,
      file,
    });
    return { data };
  }

  @Post('batch')
  @Roles(Role.ADMIN, Role.SUPERVISOR)
  @HttpCode(HttpStatus.ACCEPTED)
  @UseInterceptors(FilesInterceptor('files', 50))
  async uploadBatch(
    @CurrentTenant() tenantId: string,
    @CurrentUser('sub') userId: string,
    @Body(new ZodValidationPipe(createUploadSchema)) dto: CreateUploadDto,
    @UploadedFiles(new ParseFilePipe({ fileIsRequired: true }))
    files: Express.Multer.File[],
  ) {
    return this.uploadService.uploadBatch(tenantId, userId, dto, files);
  }

  @Post(':id/reprocess')
  @Roles(Role.ADMIN, Role.SUPERVISOR)
  @HttpCode(HttpStatus.ACCEPTED)
  async reprocess(
    @CurrentTenant() tenantId: string,
    @Param('id') id: string,
  ) {
    await this.uploadService.reprocess(tenantId, id);
    return { message: 'Upload queued for reprocessing' };
  }

  @Delete(':id')
  @Roles(Role.ADMIN)
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @CurrentTenant() tenantId: string,
    @Param('id') id: string,
  ) {
    await this.uploadService.remove(tenantId, id);
  }
}
