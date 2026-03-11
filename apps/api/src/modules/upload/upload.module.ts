import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { MulterModule } from '@nestjs/platform-express';
import { UploadController } from './upload.controller';
import { UploadService } from './upload.service';
import { BlobStorageService } from './blob-storage.service';

@Module({
  imports: [
    BullModule.registerQueue({ name: 'ocr-queue' }),
    MulterModule.register({
      limits: { fileSize: 20 * 1024 * 1024 }, // 20MB
    }),
  ],
  controllers: [UploadController],
  providers: [UploadService, BlobStorageService],
  exports: [UploadService, BlobStorageService],
})
export class UploadModule {}
