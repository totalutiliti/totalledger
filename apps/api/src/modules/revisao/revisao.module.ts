import { Module } from '@nestjs/common';
import { RevisaoController } from './revisao.controller';
import { RevisaoService } from './revisao.service';

@Module({
  controllers: [RevisaoController],
  providers: [RevisaoService],
  exports: [RevisaoService],
})
export class RevisaoModule {}
