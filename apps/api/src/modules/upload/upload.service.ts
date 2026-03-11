import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { UploadStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { BlobStorageService } from './blob-storage.service';
import { CreateUploadDto } from './dto/create-upload.dto';
import {
  PaginationDto,
  buildPaginationMeta,
} from '../../common/dto/pagination.dto';

const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20MB
const ALLOWED_MIME_TYPE = 'application/pdf';

interface UploadFileParams {
  tenantId: string;
  userId: string;
  dto: CreateUploadDto;
  file: {
    originalname: string;
    buffer: Buffer;
    mimetype: string;
    size: number;
  };
}

@Injectable()
export class UploadService {
  private readonly logger = new Logger(UploadService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly blobStorage: BlobStorageService,
    @InjectQueue('ocr-queue') private readonly ocrQueue: Queue,
  ) {}

  async findAll(tenantId: string, query: PaginationDto & { empresaId?: string; status?: string }) {
    const { page = 1, limit = 20, empresaId, status } = query;

    const where = {
      tenantId,
      deletedAt: null,
      ...(empresaId ? { empresaId } : {}),
      ...(status ? { status: status as UploadStatus } : {}),
    };

    const [data, total] = await Promise.all([
      this.prisma.upload.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: { empresa: { select: { razaoSocial: true, nomeFantasia: true } } },
      }),
      this.prisma.upload.count({ where }),
    ]);

    return {
      data,
      meta: buildPaginationMeta(page, limit, total),
    };
  }

  async findOne(tenantId: string, id: string) {
    const upload = await this.prisma.upload.findFirst({
      where: { id, tenantId, deletedAt: null },
      include: {
        empresa: { select: { razaoSocial: true, nomeFantasia: true } },
        cartoesPonto: {
          select: { id: true, statusRevisao: true, confiancaGeral: true, nomeExtraido: true },
        },
      },
    });

    if (!upload) {
      throw new NotFoundException(`Upload ${id} não encontrado`);
    }

    return upload;
  }

  async downloadPdf(tenantId: string, id: string): Promise<{ buffer: Buffer; fileName: string }> {
    const upload = await this.prisma.upload.findFirst({
      where: { id, tenantId, deletedAt: null },
      select: { blobPath: true, nomeArquivo: true },
    });

    if (!upload) {
      throw new NotFoundException(`Upload ${id} não encontrado`);
    }

    const buffer = await this.blobStorage.downloadBlob(upload.blobPath);
    return { buffer, fileName: upload.nomeArquivo };
  }

  async getStatus(tenantId: string, id: string) {
    const upload = await this.prisma.upload.findFirst({
      where: { id, tenantId },
      select: {
        id: true,
        status: true,
        erroMensagem: true,
        processadoEm: true,
        totalPaginas: true,
        _count: { select: { cartoesPonto: true } },
      },
    });

    if (!upload) {
      throw new NotFoundException(`Upload ${id} não encontrado`);
    }

    return upload;
  }

  async uploadSingle(params: UploadFileParams) {
    const { tenantId, userId, dto, file } = params;

    // Validate file
    this.validateFile(file);

    // Validate empresa belongs to tenant
    const empresa = await this.prisma.empresa.findFirst({
      where: { id: dto.empresaId, tenantId, deletedAt: null },
    });

    if (!empresa) {
      throw new BadRequestException(`Empresa ${dto.empresaId} não encontrada neste tenant`);
    }

    // Upload to Blob Storage
    const { blobUrl, blobPath } = await this.blobStorage.uploadPdf(
      tenantId,
      dto.empresaId,
      dto.mesReferencia,
      file.originalname,
      file.buffer,
    );

    // Create upload record
    const upload = await this.prisma.upload.create({
      data: {
        tenantId,
        empresaId: dto.empresaId,
        userId,
        mesReferencia: dto.mesReferencia,
        nomeArquivo: file.originalname,
        blobUrl,
        blobPath,
        tamanhoBytes: file.size,
        status: UploadStatus.AGUARDANDO,
      },
    });

    // Enqueue OCR job
    await this.ocrQueue.add(
      'process-pdf',
      { uploadId: upload.id, tenantId },
      {
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
      },
    );

    this.logger.log('Upload created and enqueued for OCR', {
      tenantId,
      userId,
      uploadId: upload.id,
      fileName: file.originalname,
      sizeBytes: file.size,
    });

    return upload;
  }

  async uploadBatch(
    tenantId: string,
    userId: string,
    dto: CreateUploadDto,
    files: Array<{ originalname: string; buffer: Buffer; mimetype: string; size: number }>,
  ) {
    if (files.length === 0) {
      throw new BadRequestException('Nenhum arquivo enviado');
    }

    if (files.length > 50) {
      throw new BadRequestException('Máximo de 50 arquivos por lote');
    }

    const results = [];
    const errors = [];

    for (const file of files) {
      try {
        const upload = await this.uploadSingle({
          tenantId,
          userId,
          dto,
          file,
        });
        results.push({ id: upload.id, fileName: file.originalname, status: 'enqueued' });
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Erro desconhecido';
        errors.push({ fileName: file.originalname, error: message });
        this.logger.error(`Batch upload failed for ${file.originalname}`, undefined, {
          tenantId,
          fileName: file.originalname,
        });
      }
    }

    return { uploaded: results, errors };
  }

  async updateStatus(
    id: string,
    status: UploadStatus,
    erroMensagem?: string,
  ): Promise<void> {
    await this.prisma.upload.update({
      where: { id },
      data: {
        status,
        erroMensagem: erroMensagem ?? null,
        ...(status === UploadStatus.PROCESSADO ? { processadoEm: new Date() } : {}),
      },
    });
  }

  async reprocess(tenantId: string, id: string): Promise<void> {
    const upload = await this.prisma.upload.findFirst({
      where: { id, tenantId, deletedAt: null },
    });

    if (!upload) {
      throw new NotFoundException(`Upload ${id} não encontrado`);
    }

    // Delete existing cartões and batidas for this upload
    await this.prisma.$transaction(async (tx) => {
      // Delete batidas first (FK constraint)
      await tx.batida.deleteMany({
        where: { cartaoPonto: { uploadId: id } },
      });
      // Delete revisoes
      await tx.revisao.deleteMany({
        where: { cartaoPonto: { uploadId: id } },
      });
      // Delete cartões
      await tx.cartaoPonto.deleteMany({
        where: { uploadId: id },
      });
      // Reset upload status
      await tx.upload.update({
        where: { id },
        data: {
          status: UploadStatus.AGUARDANDO,
          totalPaginas: null,
          erroMensagem: null,
        },
      });
    });

    // Re-queue for processing
    await this.ocrQueue.add('process-ocr', {
      uploadId: id,
      tenantId,
    });

    this.logger.log('Upload queued for reprocessing', {
      tenantId,
      uploadId: id,
    });
  }

  async remove(tenantId: string, id: string): Promise<void> {
    const upload = await this.prisma.upload.findFirst({
      where: { id, tenantId, deletedAt: null },
    });

    if (!upload) {
      throw new NotFoundException(`Upload ${id} não encontrado`);
    }

    await this.prisma.upload.update({
      where: { id },
      data: { deletedAt: new Date() },
    });

    this.logger.log('Upload soft deleted', { tenantId, uploadId: id });
  }

  private validateFile(file: { mimetype: string; size: number; originalname: string }): void {
    if (file.mimetype !== ALLOWED_MIME_TYPE) {
      throw new BadRequestException(
        `Tipo de arquivo inválido: ${file.mimetype}. Apenas PDF é aceito.`,
      );
    }

    if (file.size > MAX_FILE_SIZE) {
      throw new BadRequestException(
        `Arquivo muito grande: ${(file.size / 1024 / 1024).toFixed(1)}MB. Máximo: 20MB.`,
      );
    }
  }
}
