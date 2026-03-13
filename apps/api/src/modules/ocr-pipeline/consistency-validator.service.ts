import { Injectable, Logger } from '@nestjs/common';
import { TIME_FIELD_RANGES } from './time-sanitizer.service';
import { ScoredBatida } from './confidence-scorer.service';

export type ConsistencySeverity = 'error' | 'warning' | 'info';

export interface ConsistencyIssue {
  rule: string;
  severity: ConsistencySeverity;
  penalty: number;
  message: string;
  affectedFields: string[];
}

export interface ValidatedBatida extends ScoredBatida {
  consistencyIssues: ConsistencyIssue[];
}

const RULES = {
  SEQUENCE_ERROR: { severity: 'error' as const, penalty: 0.30 },
  SHORT_LUNCH_BREAK: { severity: 'warning' as const, penalty: 0.15 },
  EXCESSIVE_WORKDAY: { severity: 'warning' as const, penalty: 0.10 },
  OUT_OF_RANGE: { severity: 'warning' as const, penalty: 0.20 },
  INCOMPLETE_DAY: { severity: 'info' as const, penalty: 0.05 },
  SUNDAY_WORK: { severity: 'info' as const, penalty: 0 },
};

const MIN_LUNCH_BREAK_MINUTES = 60;
const MAX_WORKDAY_MINUTES = 600; // 10 hours

const TIME_FIELDS_ORDERED = [
  'entradaManha',
  'saidaManha',
  'entradaTarde',
  'saidaTarde',
  'entradaExtra',
  'saidaExtra',
] as const;

@Injectable()
export class ConsistencyValidatorService {
  private readonly logger = new Logger(ConsistencyValidatorService.name);

  validate(batidas: ScoredBatida[]): ValidatedBatida[] {
    const validated = batidas.map((b) => this.validateBatida(b));

    const issueCount = validated.reduce(
      (sum, b) => sum + b.consistencyIssues.length,
      0,
    );

    if (issueCount > 0) {
      this.logger.log('Consistency validation complete', {
        totalBatidas: batidas.length,
        totalIssues: issueCount,
        errors: validated.reduce(
          (sum, b) =>
            sum +
            b.consistencyIssues.filter((i) => i.severity === 'error').length,
          0,
        ),
        warnings: validated.reduce(
          (sum, b) =>
            sum +
            b.consistencyIssues.filter((i) => i.severity === 'warning').length,
          0,
        ),
      });
    }

    return validated;
  }

  private validateBatida(batida: ScoredBatida): ValidatedBatida {
    const issues: ConsistencyIssue[] = [];

    this.checkSequenceErrors(batida, issues);
    this.checkShortLunchBreak(batida, issues);
    this.checkExcessiveWorkday(batida, issues);
    this.checkOutOfRange(batida, issues);
    this.checkIncompleteDay(batida, issues);
    this.checkSundayWork(batida, issues);

    // Apply penalties to confidence scores
    const confianca = { ...batida.confianca };
    for (const issue of issues) {
      if (issue.penalty === 0) continue;
      for (const field of issue.affectedFields) {
        if (confianca[field] && confianca[field] > 0) {
          confianca[field] = Math.max(0, confianca[field] - issue.penalty);
        }
      }
    }

    // Recalculate needsReview based on updated confidence
    const REVIEW_THRESHOLD = 0.80;
    const needsReview =
      batida.needsReview ||
      Object.values(confianca).some(
        (v) => v > 0 && v < REVIEW_THRESHOLD,
      ) ||
      issues.some((i) => i.severity === 'error');

    return {
      ...batida,
      confianca,
      needsReview,
      consistencyIssues: issues,
    };
  }

  /**
   * SEQUENCE_ERROR: times must be in chronological order
   * entradaManha < saidaManha < entradaTarde < saidaTarde < entradaExtra < saidaExtra
   */
  private checkSequenceErrors(
    batida: ScoredBatida,
    issues: ConsistencyIssue[],
  ): void {
    const pairs: [string, string][] = [
      ['entradaManha', 'saidaManha'],
      ['saidaManha', 'entradaTarde'],
      ['entradaTarde', 'saidaTarde'],
      ['saidaTarde', 'entradaExtra'],
      ['entradaExtra', 'saidaExtra'],
    ];

    for (const [before, after] of pairs) {
      const beforeValue = (batida as unknown as Record<string, string | null>)[
        before
      ];
      const afterValue = (batida as unknown as Record<string, string | null>)[
        after
      ];

      if (!beforeValue || !afterValue) continue;

      const beforeMin = this.timeToMinutes(beforeValue);
      const afterMin = this.timeToMinutes(afterValue);

      if (beforeMin === null || afterMin === null) continue;

      if (afterMin <= beforeMin) {
        issues.push({
          rule: 'SEQUENCE_ERROR',
          severity: RULES.SEQUENCE_ERROR.severity,
          penalty: RULES.SEQUENCE_ERROR.penalty,
          message: `${before} (${beforeValue}) deve ser antes de ${after} (${afterValue})`,
          affectedFields: [before, after],
        });
      }
    }
  }

  /**
   * SHORT_LUNCH_BREAK: intervalo entre saidaManha e entradaTarde < 60 min (CLT)
   */
  private checkShortLunchBreak(
    batida: ScoredBatida,
    issues: ConsistencyIssue[],
  ): void {
    if (!batida.saidaManha || !batida.entradaTarde) return;

    const saidaMin = this.timeToMinutes(batida.saidaManha);
    const entradaMin = this.timeToMinutes(batida.entradaTarde);

    if (saidaMin === null || entradaMin === null) return;

    const breakMinutes = entradaMin - saidaMin;

    if (breakMinutes > 0 && breakMinutes < MIN_LUNCH_BREAK_MINUTES) {
      issues.push({
        rule: 'SHORT_LUNCH_BREAK',
        severity: RULES.SHORT_LUNCH_BREAK.severity,
        penalty: RULES.SHORT_LUNCH_BREAK.penalty,
        message: `Intervalo de almoço de ${breakMinutes}min (mínimo CLT: ${MIN_LUNCH_BREAK_MINUTES}min)`,
        affectedFields: ['saidaManha', 'entradaTarde'],
      });
    }
  }

  /**
   * EXCESSIVE_WORKDAY: jornada total > 10h
   */
  private checkExcessiveWorkday(
    batida: ScoredBatida,
    issues: ConsistencyIssue[],
  ): void {
    // Determine first entry and last exit
    const firstEntry = batida.entradaManha || batida.entradaTarde;
    const lastExit =
      batida.saidaExtra || batida.saidaTarde || batida.saidaManha;

    if (!firstEntry || !lastExit) return;

    const firstMin = this.timeToMinutes(firstEntry);
    const lastMin = this.timeToMinutes(lastExit);

    if (firstMin === null || lastMin === null) return;

    // Calculate total work time (subtract lunch break if available)
    let totalWorkMinutes = lastMin - firstMin;

    if (batida.saidaManha && batida.entradaTarde) {
      const lunchStart = this.timeToMinutes(batida.saidaManha);
      const lunchEnd = this.timeToMinutes(batida.entradaTarde);
      if (lunchStart !== null && lunchEnd !== null && lunchEnd > lunchStart) {
        totalWorkMinutes -= lunchEnd - lunchStart;
      }
    }

    if (totalWorkMinutes > MAX_WORKDAY_MINUTES) {
      const hours = Math.floor(totalWorkMinutes / 60);
      const mins = totalWorkMinutes % 60;
      const affectedFields: string[] = [];
      for (const field of TIME_FIELDS_ORDERED) {
        if (
          (batida as unknown as Record<string, string | null>)[field]
        ) {
          affectedFields.push(field);
        }
      }

      issues.push({
        rule: 'EXCESSIVE_WORKDAY',
        severity: RULES.EXCESSIVE_WORKDAY.severity,
        penalty: RULES.EXCESSIVE_WORKDAY.penalty,
        message: `Jornada de ${hours}h${mins.toString().padStart(2, '0')} (máximo recomendado: 10h)`,
        affectedFields,
      });
    }
  }

  /**
   * OUT_OF_RANGE: horário fora da faixa esperada (reutiliza TIME_FIELD_RANGES)
   */
  private checkOutOfRange(
    batida: ScoredBatida,
    issues: ConsistencyIssue[],
  ): void {
    for (const field of TIME_FIELDS_ORDERED) {
      const value = (batida as unknown as Record<string, string | null>)[field];
      if (!value) continue;

      const range = TIME_FIELD_RANGES[field];
      if (!range) continue;

      const minutes = this.timeToMinutes(value);
      if (minutes === null) continue;

      // Allow 30min tolerance beyond the range
      const tolerance = 30;
      if (minutes < range.min - tolerance || minutes > range.max + tolerance) {
        issues.push({
          rule: 'OUT_OF_RANGE',
          severity: RULES.OUT_OF_RANGE.severity,
          penalty: RULES.OUT_OF_RANGE.penalty,
          message: `${field} (${value}) fora da faixa esperada ${range.label}`,
          affectedFields: [field],
        });
      }
    }
  }

  /**
   * INCOMPLETE_DAY: campos parciais (tem entrada sem saída ou vice-versa)
   */
  private checkIncompleteDay(
    batida: ScoredBatida,
    issues: ConsistencyIssue[],
  ): void {
    if (batida.isFaltaDia) return; // All empty is OK (folga/falta)

    const pairs: [string, string, string][] = [
      ['entradaManha', 'saidaManha', 'manhã'],
      ['entradaTarde', 'saidaTarde', 'tarde'],
      ['entradaExtra', 'saidaExtra', 'extra'],
    ];

    for (const [entrada, saida, periodo] of pairs) {
      const hasEntrada = !!(
        batida as unknown as Record<string, string | null>
      )[entrada];
      const hasSaida = !!(batida as unknown as Record<string, string | null>)[
        saida
      ];

      if (hasEntrada !== hasSaida) {
        const missing = hasEntrada ? saida : entrada;
        const present = hasEntrada ? entrada : saida;
        issues.push({
          rule: 'INCOMPLETE_DAY',
          severity: RULES.INCOMPLETE_DAY.severity,
          penalty: RULES.INCOMPLETE_DAY.penalty,
          message: `Período ${periodo}: tem ${present} mas falta ${missing}`,
          affectedFields: [entrada, saida],
        });
      }
    }
  }

  /**
   * SUNDAY_WORK: trabalho em domingo (dia da semana = 'DOM')
   * Only flags, no penalty — just informational
   */
  private checkSundayWork(
    batida: ScoredBatida,
    issues: ConsistencyIssue[],
  ): void {
    if (!batida.diaSemana) return;

    const diaSemana = batida.diaSemana.toUpperCase().trim();
    if (diaSemana !== 'DOM' && diaSemana !== 'DOMINGO') return;

    // Check if there's any time entry
    const hasWork = TIME_FIELDS_ORDERED.some(
      (f) => !!(batida as unknown as Record<string, string | null>)[f],
    );

    if (hasWork) {
      const affectedFields = TIME_FIELDS_ORDERED.filter(
        (f) => !!(batida as unknown as Record<string, string | null>)[f],
      );
      issues.push({
        rule: 'SUNDAY_WORK',
        severity: RULES.SUNDAY_WORK.severity,
        penalty: RULES.SUNDAY_WORK.penalty,
        message: 'Trabalho registrado em domingo',
        affectedFields: [...affectedFields],
      });
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
