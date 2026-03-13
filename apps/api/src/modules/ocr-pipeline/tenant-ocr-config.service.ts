import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Resolved OCR configuration with defaults applied.
 * All consumers receive this typed interface instead of raw DB rows.
 */
export interface ResolvedOcrConfig {
  minLunchBreakMinutes: number;
  maxWorkdayMinutes: number;
  reviewThreshold: number;
  gptSkipThreshold: number;
  outlierZWarning: number;
  outlierZError: number;
  outlierMinDays: number;
  timeFieldRanges: Record<string, { min: number; max: number }> | null;
  /** Threshold abaixo do qual o Mini trigger o fallback GPT-5.2 */
  miniFallbackThreshold: number;
  /** Penalidade de consistencia que forca fallback */
  fallbackConsistencyPenalty: number;
  /** Threshold de confianca para manuscritos no fallback */
  manuscritoFallbackThreshold: number;
}

const DEFAULTS: ResolvedOcrConfig = {
  minLunchBreakMinutes: 60,
  maxWorkdayMinutes: 600,
  reviewThreshold: 0.80,
  gptSkipThreshold: 0.90,
  outlierZWarning: 2.0,
  outlierZError: 3.0,
  outlierMinDays: 5,
  timeFieldRanges: null,
  miniFallbackThreshold: 0.80,
  fallbackConsistencyPenalty: 0.25,
  manuscritoFallbackThreshold: 0.85,
};

@Injectable()
export class TenantOcrConfigService {
  private readonly logger = new Logger(TenantOcrConfigService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Get resolved OCR config for a tenant.
   * Falls back to defaults if no config exists.
   */
  async getConfig(tenantId: string): Promise<ResolvedOcrConfig> {
    const config = await this.prisma.tenantOcrConfig.findUnique({
      where: { tenantId },
    });

    if (!config) {
      this.logger.debug(`No OCR config for tenant ${tenantId}, using defaults`);
      return { ...DEFAULTS };
    }

    // Extract optional new fields from DB config (may not exist yet in schema)
    const raw = config as Record<string, unknown>;

    return {
      minLunchBreakMinutes: config.minLunchBreakMinutes,
      maxWorkdayMinutes: config.maxWorkdayMinutes,
      reviewThreshold: config.reviewThreshold,
      gptSkipThreshold: config.gptSkipThreshold,
      outlierZWarning: config.outlierZWarning,
      outlierZError: config.outlierZError,
      outlierMinDays: config.outlierMinDays,
      timeFieldRanges: config.timeFieldRanges as Record<string, { min: number; max: number }> | null,
      miniFallbackThreshold:
        typeof raw.miniFallbackThreshold === 'number'
          ? raw.miniFallbackThreshold
          : DEFAULTS.miniFallbackThreshold,
      fallbackConsistencyPenalty:
        typeof raw.fallbackConsistencyPenalty === 'number'
          ? raw.fallbackConsistencyPenalty
          : DEFAULTS.fallbackConsistencyPenalty,
      manuscritoFallbackThreshold:
        typeof raw.manuscritoFallbackThreshold === 'number'
          ? raw.manuscritoFallbackThreshold
          : DEFAULTS.manuscritoFallbackThreshold,
    };
  }
}
