import { Injectable, Logger } from '@nestjs/common';
import { TipoCartao } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

const TIME_FIELDS = [
  'entradaManha',
  'saidaManha',
  'entradaTarde',
  'saidaTarde',
  'entradaExtra',
  'saidaExtra',
] as const;

/** Map corrected field to original field name. */
const CORRECTED_FIELD_MAP: Record<string, string> = {
  entradaManha: 'entradaManhaCorrigida',
  saidaManha: 'saidaManhaCorrigida',
  entradaTarde: 'entradaTardeCorrigida',
  saidaTarde: 'saidaTardeCorrigida',
  entradaExtra: 'entradaExtraCorrigida',
  saidaExtra: 'saidaExtraCorrigida',
};

interface FieldAccuracy {
  campo: string;
  total: number;
  acertosDi: number;
  acertosGpt: number;
  acertosSanitizer: number;
  acuraciaDi: number;
  acuraciaGpt: number;
  acuraciaSanitizer: number;
}

export interface AccuracyReport {
  tenantId: string;
  totalRecords: number;
  globalAccuracy: {
    di: number;
    gpt: number;
    sanitizer: number;
  };
  byField: FieldAccuracy[];
  byTipoCartao: Record<string, { di: number; gpt: number; sanitizer: number; total: number }>;
}

@Injectable()
export class GroundTruthService {
  private readonly logger = new Logger(GroundTruthService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Generate ground truth records from an approved CartaoPonto.
   * Truth = valorHumano (if reviewer corrected it) ?? valorFinal (pipeline output).
   * Compares DI, GPT, and Sanitizer values against the truth.
   */
  async generateFromApproval(
    cartaoPontoId: string,
    tenantId: string,
  ): Promise<number> {
    const cartao = await this.prisma.cartaoPonto.findFirst({
      where: { id: cartaoPontoId, tenantId },
      include: {
        batidas: {
          include: {
            ocrFeedback: true,
          },
        },
      },
    });

    if (!cartao) {
      this.logger.warn(`CartaoPonto ${cartaoPontoId} not found for ground truth generation`);
      return 0;
    }

    const records: Array<{
      tenantId: string;
      cartaoPontoId: string;
      batidaId: string;
      dia: number;
      campo: string;
      valorDi: string | null;
      valorGpt: string | null;
      valorSanitizer: string | null;
      valorFinal: string | null;
      valorHumano: string | null;
      acertouDi: boolean | null;
      acertouGpt: boolean | null;
      acertouSanitizer: boolean | null;
      tipoCartao: TipoCartao;
      isManuscrito: boolean;
    }> = [];

    for (const batida of cartao.batidas) {
      for (const campo of TIME_FIELDS) {
        // Get OCR feedback for this field (contains DI vs GPT comparison)
        const feedback = batida.ocrFeedback.find((f) => f.campo === campo);

        // Original DI value = the field value on batida (before any correction)
        const valorDi = feedback?.valorDi
          ?? (batida[campo as keyof typeof batida] as string | null);

        // GPT value
        const valorGpt = feedback?.valorGpt ?? null;

        // Sanitizer value = the corrected field, if it differs from DI
        const correctedField = CORRECTED_FIELD_MAP[campo];
        const correctedValue = correctedField
          ? (batida[correctedField as keyof typeof batida] as string | null)
          : null;
        const valorSanitizer = correctedValue ?? valorDi;

        // Final pipeline value
        const valorFinal = feedback?.valorFinal
          ?? (batida[campo as keyof typeof batida] as string | null);

        // Human value (set during revisao corrections)
        const valorHumano = feedback?.valorHumano ?? null;

        // Truth = human correction if available, otherwise pipeline final value
        const truth = valorHumano ?? valorFinal;

        // Skip fields where truth is null (no data to compare)
        if (truth === null) continue;

        // Compare each source against truth
        const acertouDi = valorDi !== null ? valorDi === truth : null;
        const acertouGpt = valorGpt !== null ? valorGpt === truth : null;
        const acertouSanitizer = valorSanitizer !== null ? valorSanitizer === truth : null;

        records.push({
          tenantId,
          cartaoPontoId,
          batidaId: batida.id,
          dia: batida.dia,
          campo,
          valorDi,
          valorGpt,
          valorSanitizer,
          valorFinal,
          valorHumano,
          acertouDi,
          acertouGpt,
          acertouSanitizer,
          tipoCartao: cartao.tipoCartao,
          isManuscrito: batida.isManuscrito,
        });
      }
    }

    if (records.length === 0) return 0;

    // Upsert: delete old ground truth for this cartão and insert new
    await this.prisma.$transaction(async (tx) => {
      await tx.groundTruth.deleteMany({
        where: { cartaoPontoId, tenantId },
      });

      await tx.groundTruth.createMany({
        data: records,
      });
    });

    this.logger.log('Ground truth generated', {
      tenantId,
      cartaoPontoId,
      records: records.length,
    });

    return records.length;
  }

  /**
   * Compute accuracy report for a tenant across all ground truth data.
   */
  async getAccuracyReport(tenantId: string): Promise<AccuracyReport> {
    const allRecords = await this.prisma.groundTruth.findMany({
      where: { tenantId },
    });

    const totalRecords = allRecords.length;

    if (totalRecords === 0) {
      return {
        tenantId,
        totalRecords: 0,
        globalAccuracy: { di: 0, gpt: 0, sanitizer: 0 },
        byField: [],
        byTipoCartao: {},
      };
    }

    // Global accuracy
    let diHits = 0;
    let diTotal = 0;
    let gptHits = 0;
    let gptTotal = 0;
    let sanHits = 0;
    let sanTotal = 0;

    // By field
    const fieldMap = new Map<string, { total: number; di: number; diT: number; gpt: number; gptT: number; san: number; sanT: number }>();
    // By tipo cartao
    const tipoMap = new Map<string, { di: number; diT: number; gpt: number; gptT: number; san: number; sanT: number; total: number }>();

    for (const r of allRecords) {
      // Global
      if (r.acertouDi !== null) {
        diTotal++;
        if (r.acertouDi) diHits++;
      }
      if (r.acertouGpt !== null) {
        gptTotal++;
        if (r.acertouGpt) gptHits++;
      }
      if (r.acertouSanitizer !== null) {
        sanTotal++;
        if (r.acertouSanitizer) sanHits++;
      }

      // By field
      const f = fieldMap.get(r.campo) ?? { total: 0, di: 0, diT: 0, gpt: 0, gptT: 0, san: 0, sanT: 0 };
      f.total++;
      if (r.acertouDi !== null) { f.diT++; if (r.acertouDi) f.di++; }
      if (r.acertouGpt !== null) { f.gptT++; if (r.acertouGpt) f.gpt++; }
      if (r.acertouSanitizer !== null) { f.sanT++; if (r.acertouSanitizer) f.san++; }
      fieldMap.set(r.campo, f);

      // By tipo cartao
      const t = tipoMap.get(r.tipoCartao) ?? { di: 0, diT: 0, gpt: 0, gptT: 0, san: 0, sanT: 0, total: 0 };
      t.total++;
      if (r.acertouDi !== null) { t.diT++; if (r.acertouDi) t.di++; }
      if (r.acertouGpt !== null) { t.gptT++; if (r.acertouGpt) t.gpt++; }
      if (r.acertouSanitizer !== null) { t.sanT++; if (r.acertouSanitizer) t.san++; }
      tipoMap.set(r.tipoCartao, t);
    }

    const safeDiv = (a: number, b: number): number => (b === 0 ? 0 : a / b);

    const byField: FieldAccuracy[] = Array.from(fieldMap.entries()).map(([campo, f]) => ({
      campo,
      total: f.total,
      acertosDi: f.di,
      acertosGpt: f.gpt,
      acertosSanitizer: f.san,
      acuraciaDi: safeDiv(f.di, f.diT),
      acuraciaGpt: safeDiv(f.gpt, f.gptT),
      acuraciaSanitizer: safeDiv(f.san, f.sanT),
    }));

    const byTipoCartao: Record<string, { di: number; gpt: number; sanitizer: number; total: number }> = {};
    for (const [tipo, t] of tipoMap.entries()) {
      byTipoCartao[tipo] = {
        di: safeDiv(t.di, t.diT),
        gpt: safeDiv(t.gpt, t.gptT),
        sanitizer: safeDiv(t.san, t.sanT),
        total: t.total,
      };
    }

    return {
      tenantId,
      totalRecords,
      globalAccuracy: {
        di: safeDiv(diHits, diTotal),
        gpt: safeDiv(gptHits, gptTotal),
        sanitizer: safeDiv(sanHits, sanTotal),
      },
      byField,
      byTipoCartao,
    };
  }
}
