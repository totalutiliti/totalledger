import { Controller, Get, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

interface HealthResponse {
  status: string;
  timestamp: string;
}

interface ReadinessResponse extends HealthResponse {
  database: string;
}

@Controller('api/v1/health')
export class HealthController {
  private readonly logger = new Logger(HealthController.name);

  constructor(private readonly prisma: PrismaService) {}

  @Get()
  check(): HealthResponse {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
    };
  }

  @Get('ready')
  async readiness(): Promise<ReadinessResponse> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;

      return {
        status: 'ok',
        database: 'connected',
        timestamp: new Date().toISOString(),
      };
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : 'Unknown database error';
      this.logger.error(`Readiness check failed: ${message}`);

      return {
        status: 'error',
        database: 'disconnected',
        timestamp: new Date().toISOString(),
      };
    }
  }
}
