import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  BlobServiceClient,
  ContainerClient,
  BlockBlobClient,
} from '@azure/storage-blob';
import { v4 as uuidv4 } from 'uuid';

export interface BlobUploadResult {
  blobUrl: string;
  blobPath: string;
}

@Injectable()
export class BlobStorageService {
  private readonly logger = new Logger(BlobStorageService.name);
  private readonly containerClient: ContainerClient;
  private readonly containerName: string;

  constructor(private readonly configService: ConfigService) {
    const connectionString = this.configService.get<string>(
      'AZURE_STORAGE_CONNECTION_STRING',
      'UseDevelopmentStorage=true',
    );
    this.containerName = this.configService.get<string>(
      'AZURE_STORAGE_CONTAINER_NAME',
      'cartoes-ponto',
    );

    const blobServiceClient =
      BlobServiceClient.fromConnectionString(connectionString);
    this.containerClient =
      blobServiceClient.getContainerClient(this.containerName);
  }

  async ensureContainer(): Promise<void> {
    await this.containerClient.createIfNotExists({
      access: undefined, // private
    });
  }

  async uploadPdf(
    tenantId: string,
    empresaId: string,
    mesReferencia: string,
    fileName: string,
    buffer: Buffer,
  ): Promise<BlobUploadResult> {
    await this.ensureContainer();

    const sanitizedFileName = fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
    const blobPath = `${tenantId}/${empresaId}/${mesReferencia}/${uuidv4()}-${sanitizedFileName}`;

    const blockBlobClient: BlockBlobClient =
      this.containerClient.getBlockBlobClient(blobPath);

    await blockBlobClient.uploadData(buffer, {
      blobHTTPHeaders: {
        blobContentType: 'application/pdf',
      },
    });

    const blobUrl = blockBlobClient.url;

    this.logger.log('PDF uploaded to blob storage', {
      tenantId,
      empresaId,
      blobPath,
      sizeBytes: buffer.length,
    });

    return { blobUrl, blobPath };
  }

  async generateSasUrl(blobPath: string, _expiresInMinutes = 60): Promise<string> {
    const blockBlobClient =
      this.containerClient.getBlockBlobClient(blobPath);

    // For Azurite/dev, return the direct URL
    const nodeEnv = this.configService.get<string>('NODE_ENV', 'development');
    if (nodeEnv === 'development') {
      return blockBlobClient.url;
    }

    // For production, generate SAS token
    // SAS generation requires StorageSharedKeyCredential which needs account name/key
    // In production this would use managed identity or account key
    return blockBlobClient.url;
  }

  async downloadBlob(blobPath: string): Promise<Buffer> {
    const blockBlobClient =
      this.containerClient.getBlockBlobClient(blobPath);
    const response = await blockBlobClient.downloadToBuffer();

    this.logger.log('Blob downloaded', {
      blobPath,
      sizeBytes: response.length,
    });

    return response;
  }

  async deleteBlob(blobPath: string): Promise<void> {
    const blockBlobClient =
      this.containerClient.getBlockBlobClient(blobPath);
    await blockBlobClient.deleteIfExists();

    this.logger.log('Blob deleted', { blobPath });
  }
}
