import { Module } from '@nestjs/common';
import { OcrPipelineModule } from '../ocr-pipeline/ocr-pipeline.module';
import { RevisaoController } from './revisao.controller';
import { RevisaoService } from './revisao.service';

@Module({
  imports: [OcrPipelineModule],
  controllers: [RevisaoController],
  providers: [RevisaoService],
  exports: [RevisaoService],
})
export class RevisaoModule {}
