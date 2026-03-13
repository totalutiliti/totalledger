import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { UploadModule } from '../upload/upload.module';
import { DocumentIntelligenceService } from './document-intelligence.service';
import { DocumentClassifierService } from './document-classifier.service';
import { CardParserService } from './card-parser.service';
import { ConfidenceScorerService } from './confidence-scorer.service';
import { AiFilterService } from './ai-filter.service';
import { TimeSanitizerService } from './time-sanitizer.service';
import { GptVisionValidatorService } from './gpt-vision-validator.service';
import { ConsistencyValidatorService } from './consistency-validator.service';
import { OutlierDetectorService } from './outlier-detector.service';
import { DecisionOrchestratorService } from './decision-orchestrator.service';
import { GptGatekeeperService } from './gpt-gatekeeper.service';
import { TenantOcrConfigService } from './tenant-ocr-config.service';
import { OcrMetricsService } from './ocr-metrics.service';
import { GroundTruthService } from './ground-truth.service';
import { OcrProcessor } from './processors/ocr.processor';
import { GptMiniExtractorService } from './gpt-mini-extractor.service';
import { ImageCropperService } from './image-cropper.service';
import { RateLimiterService } from './rate-limiter.service';
import { PageProcessor } from './processors/page.processor';

// Pipeline v2 services
import { DiReadExtractorService } from './di-read-extractor.service';
import { MiniVisionExtractorService } from './mini-vision-extractor.service';
import { MiniTextTranslatorService } from './mini-text-translator.service';
import { VotingComparatorService } from './voting-comparator.service';
import { FallbackArbitratorService } from './fallback-arbitrator.service';
import { CardGrouperService } from './card-grouper.service';
import { PipelineV2OrchestratorService } from './pipeline-v2-orchestrator.service';

// Pipeline v3 services (DI Clean + GPT-5.2 direto)
import { DiCleanTableExtractorService } from './di-clean-table-extractor.service';
import { Gpt52DirectExtractorService } from './gpt52-direct-extractor.service';

@Module({
  imports: [
    BullModule.registerQueue({ name: 'ocr-queue' }),
    BullModule.registerQueue({ name: 'ocr-page-queue' }),
    UploadModule,
  ],
  providers: [
    // Pipeline v1 (existing)
    DocumentIntelligenceService,
    DocumentClassifierService,
    CardParserService,
    TimeSanitizerService,
    ConfidenceScorerService,
    AiFilterService,
    GptVisionValidatorService,
    ConsistencyValidatorService,
    OutlierDetectorService,
    DecisionOrchestratorService,
    GptGatekeeperService,
    TenantOcrConfigService,
    OcrMetricsService,
    GroundTruthService,
    GptMiniExtractorService,
    ImageCropperService,
    RateLimiterService,
    PageProcessor,
    OcrProcessor,

    // Pipeline v2 (multi-extrator com votacao)
    DiReadExtractorService,
    MiniVisionExtractorService,
    MiniTextTranslatorService,
    VotingComparatorService,
    FallbackArbitratorService,
    CardGrouperService,
    PipelineV2OrchestratorService,

    // Pipeline v3 (DI Clean + GPT-5.2 direto)
    DiCleanTableExtractorService,
    Gpt52DirectExtractorService,
  ],
  exports: [
    // Pipeline v1 (existing)
    DocumentIntelligenceService,
    DocumentClassifierService,
    CardParserService,
    TimeSanitizerService,
    ConfidenceScorerService,
    AiFilterService,
    GptVisionValidatorService,
    ConsistencyValidatorService,
    OutlierDetectorService,
    DecisionOrchestratorService,
    GptGatekeeperService,
    TenantOcrConfigService,
    OcrMetricsService,
    GroundTruthService,
    GptMiniExtractorService,
    ImageCropperService,
    RateLimiterService,

    // Pipeline v2
    DiReadExtractorService,
    MiniVisionExtractorService,
    MiniTextTranslatorService,
    VotingComparatorService,
    FallbackArbitratorService,
    CardGrouperService,
    PipelineV2OrchestratorService,

    // Pipeline v3
    DiCleanTableExtractorService,
    Gpt52DirectExtractorService,
  ],
})
export class OcrPipelineModule {}
