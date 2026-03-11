import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { UploadModule } from '../upload/upload.module';
import { DocumentIntelligenceService } from './document-intelligence.service';
import { CardParserService } from './card-parser.service';
import { ConfidenceScorerService } from './confidence-scorer.service';
import { AiFilterService } from './ai-filter.service';
import { OcrProcessor } from './processors/ocr.processor';

@Module({
  imports: [
    BullModule.registerQueue({ name: 'ocr-queue' }),
    UploadModule,
  ],
  providers: [
    DocumentIntelligenceService,
    CardParserService,
    ConfidenceScorerService,
    AiFilterService,
    OcrProcessor,
  ],
  exports: [
    DocumentIntelligenceService,
    CardParserService,
    ConfidenceScorerService,
    AiFilterService,
  ],
})
export class OcrPipelineModule {}
