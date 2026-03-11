import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { BullModule } from '@nestjs/bullmq';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard } from '@nestjs/throttler';
import { validate } from './config/env.validation';
import { PrismaModule } from './modules/prisma/prisma.module';
import { HealthModule } from './modules/health/health.module';
import { AuthModule } from './modules/auth/auth.module';
import { TenantModule } from './modules/tenant/tenant.module';
import { EmpresaModule } from './modules/empresa/empresa.module';
import { FuncionarioModule } from './modules/funcionario/funcionario.module';
import { UploadModule } from './modules/upload/upload.module';
import { OcrPipelineModule } from './modules/ocr-pipeline/ocr-pipeline.module';
import { RevisaoModule } from './modules/revisao/revisao.module';
import { ExportModule } from './modules/export/export.module';
import { DashboardModule } from './modules/dashboard/dashboard.module';
import { FiscalModule } from './modules/fiscal/fiscal.module';
import { SocietarioModule } from './modules/societario/societario.module';
import { ControleModule } from './modules/controle/controle.module';
import { FeatureFlagModule } from './modules/feature-flag/feature-flag.module';
import { AuditModule } from './modules/audit/audit.module';
import { UserModule } from './modules/user/user.module';
import { EventEmitterModule } from '@nestjs/event-emitter';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env.local', '.env'],
      validate,
    }),
    ThrottlerModule.forRoot([
      {
        ttl: 60000,
        limit: 60,
      },
    ]),
    BullModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        connection: {
          host: configService.get<string>('REDIS_HOST', 'localhost'),
          port: configService.get<number>('REDIS_PORT', 6379),
          password: configService.get<string>('REDIS_PASSWORD') || undefined,
        },
      }),
    }),
    PrismaModule,
    HealthModule,
    AuthModule,
    TenantModule,
    EmpresaModule,
    FuncionarioModule,
    UploadModule,
    OcrPipelineModule,
    RevisaoModule,
    ExportModule,
    DashboardModule,
    FiscalModule,
    SocietarioModule,
    ControleModule,
    FeatureFlagModule,
    AuditModule,
    UserModule,
    EventEmitterModule.forRoot(),
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule {}
