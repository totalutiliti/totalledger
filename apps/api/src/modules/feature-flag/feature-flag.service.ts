import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class FeatureFlagService {
  private readonly logger = new Logger(FeatureFlagService.name);

  constructor(private readonly prisma: PrismaService) {}

  async isEnabled(tenantId: string, feature: string): Promise<boolean> {
    const flag = await this.prisma.featureFlag.findUnique({
      where: { tenantId_feature: { tenantId, feature } },
    });

    return flag?.enabled ?? false;
  }

  async getAll(tenantId: string): Promise<{ feature: string; enabled: boolean }[]> {
    const flags = await this.prisma.featureFlag.findMany({
      where: { tenantId },
      select: { feature: true, enabled: true },
      orderBy: { feature: 'asc' },
    });

    return flags;
  }

  async setFlag(tenantId: string, feature: string, enabled: boolean): Promise<void> {
    await this.prisma.featureFlag.upsert({
      where: { tenantId_feature: { tenantId, feature } },
      update: { enabled },
      create: { tenantId, feature, enabled },
    });

    this.logger.log('Feature flag updated', { tenantId, feature, enabled });
  }
}
