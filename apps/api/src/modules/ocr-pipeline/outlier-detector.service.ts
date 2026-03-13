import { Injectable, Logger } from '@nestjs/common';
import { ScoredBatida } from './confidence-scorer.service';

export type OutlierSeverity = 'warning' | 'error';

export interface OutlierFlag {
  campo: string;
  valor: string;
  dia: number;
  zScore: number;
  severity: OutlierSeverity;
  penalty: number;
  message: string;
}

export interface OutlierResult {
  /** Outlier flags for each batida, indexed by array position */
  batidaFlags: OutlierFlag[][];
}

/** Default thresholds — overridable via tenant config */
const DEFAULT_MIN_DAYS = 5;
const DEFAULT_Z_WARNING = 2.0;
const DEFAULT_Z_ERROR = 3.0;
const IQR_WARNING_MULTIPLIER = 1.5;
const IQR_ERROR_MULTIPLIER = 3.0;
const IQR_MAX_DAYS = 10;
const WARNING_PENALTY = 0.10;
const ERROR_PENALTY = 0.20;

export interface OutlierConfig {
  minDays: number;
  zWarning: number;
  zError: number;
}

const TIME_FIELDS = [
  'entradaManha',
  'saidaManha',
  'entradaTarde',
  'saidaTarde',
  'entradaExtra',
  'saidaExtra',
] as const;

@Injectable()
export class OutlierDetectorService {
  private readonly logger = new Logger(OutlierDetectorService.name);

  /**
   * Detect statistical outliers across days for each time column.
   *
   * Dynamic strategy selection:
   * - n < minDays → skip (AMOSTRA_INSUFICIENTE)
   * - minDays <= n < IQR_MAX_DAYS → use IQR
   * - n >= IQR_MAX_DAYS → use z-score
   */
  detect(
    batidas: ScoredBatida[],
    config?: OutlierConfig,
  ): OutlierResult {
    const cfg: OutlierConfig = {
      minDays: config?.minDays ?? DEFAULT_MIN_DAYS,
      zWarning: config?.zWarning ?? DEFAULT_Z_WARNING,
      zError: config?.zError ?? DEFAULT_Z_ERROR,
    };

    const batidaFlags: OutlierFlag[][] = batidas.map(() => []);

    for (const field of TIME_FIELDS) {
      this.detectFieldOutliersDynamic(batidas, field, batidaFlags, cfg);
    }

    const totalFlags = batidaFlags.reduce((s, f) => s + f.length, 0);
    if (totalFlags > 0) {
      this.logger.log('Outlier detection complete', {
        totalBatidas: batidas.length,
        totalFlags,
        warnings: batidaFlags
          .flat()
          .filter((f) => f.severity === 'warning').length,
        errors: batidaFlags
          .flat()
          .filter((f) => f.severity === 'error').length,
      });
    }

    return { batidaFlags };
  }

  /**
   * Dynamic outlier detection: IQR for small samples, z-score for large.
   */
  private detectFieldOutliersDynamic(
    batidas: ScoredBatida[],
    field: string,
    batidaFlags: OutlierFlag[][],
    config: OutlierConfig,
  ): void {
    const entries = this.collectFieldEntries(batidas, field);

    if (entries.length < config.minDays) {
      if (entries.length > 0) {
        this.logger.debug(`AMOSTRA_INSUFICIENTE: ${field} n=${entries.length} < min=${config.minDays}`);
      }
      return;
    }

    if (entries.length < IQR_MAX_DAYS) {
      this.detectFieldOutliersIqr(entries, field, batidaFlags);
    } else {
      this.detectFieldOutliersZScore(entries, field, batidaFlags, config);
    }
  }

  /**
   * Collect valid time entries for a field.
   */
  private collectFieldEntries(
    batidas: ScoredBatida[],
    field: string,
  ): { index: number; minutes: number; value: string; dia: number }[] {
    const entries: { index: number; minutes: number; value: string; dia: number }[] = [];

    for (let i = 0; i < batidas.length; i++) {
      const value = (batidas[i] as unknown as Record<string, string | null>)[field];
      if (!value) continue;

      const minutes = this.timeToMinutes(value);
      if (minutes === null) continue;

      entries.push({ index: i, minutes, value, dia: batidas[i].dia });
    }

    return entries;
  }

  /**
   * IQR-based outlier detection for small samples (5 <= n < 10).
   */
  private detectFieldOutliersIqr(
    entries: { index: number; minutes: number; value: string; dia: number }[],
    field: string,
    batidaFlags: OutlierFlag[][],
  ): void {
    const sorted = [...entries].sort((a, b) => a.minutes - b.minutes);
    const n = sorted.length;

    const q1 = sorted[Math.floor(n * 0.25)].minutes;
    const q3 = sorted[Math.floor(n * 0.75)].minutes;
    const iqr = q3 - q1;

    if (iqr < 1) return; // No spread

    const warningLower = q1 - IQR_WARNING_MULTIPLIER * iqr;
    const warningUpper = q3 + IQR_WARNING_MULTIPLIER * iqr;
    const errorLower = q1 - IQR_ERROR_MULTIPLIER * iqr;
    const errorUpper = q3 + IQR_ERROR_MULTIPLIER * iqr;

    for (const entry of entries) {
      if (entry.minutes < errorLower || entry.minutes > errorUpper) {
        batidaFlags[entry.index].push({
          campo: field,
          valor: entry.value,
          dia: entry.dia,
          zScore: 0, // IQR doesn't use z-score
          severity: 'error',
          penalty: ERROR_PENALTY,
          message: `${field} dia ${entry.dia} (${entry.value}) outlier IQR (fora de ${IQR_ERROR_MULTIPLIER}×IQR)`,
        });
      } else if (entry.minutes < warningLower || entry.minutes > warningUpper) {
        batidaFlags[entry.index].push({
          campo: field,
          valor: entry.value,
          dia: entry.dia,
          zScore: 0,
          severity: 'warning',
          penalty: WARNING_PENALTY,
          message: `${field} dia ${entry.dia} (${entry.value}) suspeito IQR (fora de ${IQR_WARNING_MULTIPLIER}×IQR)`,
        });
      }
    }
  }

  /**
   * Z-score based outlier detection for larger samples (n >= 10).
   */
  private detectFieldOutliersZScore(
    entries: { index: number; minutes: number; value: string; dia: number }[],
    field: string,
    batidaFlags: OutlierFlag[][],
    config: OutlierConfig,
  ): void {
    const values = entries.map((e) => e.minutes);
    const mean = values.reduce((s, v) => s + v, 0) / values.length;
    const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length;
    const stdDev = Math.sqrt(variance);

    if (stdDev < 1) return;

    for (const entry of entries) {
      const zScore = (entry.minutes - mean) / stdDev;
      const absZ = Math.abs(zScore);

      if (absZ >= config.zError) {
        batidaFlags[entry.index].push({
          campo: field,
          valor: entry.value,
          dia: entry.dia,
          zScore: parseFloat(zScore.toFixed(2)),
          severity: 'error',
          penalty: ERROR_PENALTY,
          message: `${field} dia ${entry.dia} (${entry.value}) é outlier estatístico (z=${zScore.toFixed(2)})`,
        });
      } else if (absZ >= config.zWarning) {
        batidaFlags[entry.index].push({
          campo: field,
          valor: entry.value,
          dia: entry.dia,
          zScore: parseFloat(zScore.toFixed(2)),
          severity: 'warning',
          penalty: WARNING_PENALTY,
          message: `${field} dia ${entry.dia} (${entry.value}) difere da média (z=${zScore.toFixed(2)})`,
        });
      }
    }
  }

  private timeToMinutes(time: string): number | null {
    const match = time.match(/^(\d{2}):(\d{2})$/);
    if (!match) return null;
    const h = parseInt(match[1], 10);
    const m = parseInt(match[2], 10);
    if (h < 0 || h > 23 || m < 0 || m > 59) return null;
    return h * 60 + m;
  }
}
