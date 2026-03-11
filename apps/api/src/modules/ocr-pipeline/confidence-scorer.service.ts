import { Injectable, Logger } from '@nestjs/common';

export interface ScoredBatida {
  dia: number;
  diaSemana: string | null;
  entradaManha: string | null;
  saidaManha: string | null;
  entradaTarde: string | null;
  saidaTarde: string | null;
  entradaExtra: string | null;
  saidaExtra: string | null;
  confianca: Record<string, number>;
  isManuscrito: boolean;
  isInconsistente: boolean;
  isFaltaDia: boolean;
  needsReview: boolean;
}

export interface RawBatidaInput {
  dia: number;
  diaSemana: string | null;
  entradaManha: string | null;
  saidaManha: string | null;
  entradaTarde: string | null;
  saidaTarde: string | null;
  entradaExtra: string | null;
  saidaExtra: string | null;
  confidences: Record<string, number>;
  isManuscrito: boolean;
}

@Injectable()
export class ConfidenceScorerService {
  private readonly logger = new Logger(ConfidenceScorerService.name);

  private static readonly REVIEW_THRESHOLD = 0.80;
  private static readonly MANUSCRITO_PENALTY = 0.15;
  private static readonly FORMAT_PENALTY = 0.20;
  private static readonly INCONSISTENCY_PENALTY = 0.30;
  private static readonly EXPECTED_RANGE_BONUS = 0.10;

  scoreBatidas(
    batidas: RawBatidaInput[],
    horarioContratual: string | null,
  ): ScoredBatida[] {
    const scored = batidas.map((batida) => this.scoreBatida(batida, horarioContratual));
    const needsReviewCount = scored.filter((b) => b.needsReview).length;
    this.logger.log('Batidas scored', {
      total: scored.length,
      needsReview: needsReviewCount,
    });
    return scored;
  }

  computeOverallConfidence(scored: ScoredBatida[]): number {
    if (scored.length === 0) return 0;

    const allScores = scored.flatMap((b) =>
      Object.values(b.confianca).filter((v) => v > 0),
    );

    if (allScores.length === 0) return 0;
    return allScores.reduce((sum, s) => sum + s, 0) / allScores.length;
  }

  private scoreBatida(
    batida: RawBatidaInput,
    horarioContratual: string | null,
  ): ScoredBatida {
    const fields = [
      'entradaManha',
      'saidaManha',
      'entradaTarde',
      'saidaTarde',
    ] as const;
    const confianca: Record<string, number> = {};

    for (const field of fields) {
      const value = batida[field];
      const baseConfidence = batida.confidences[field] ?? 0;

      if (!value) {
        confianca[field] = 0;
        continue;
      }

      let score = baseConfidence;

      // Manuscrito penalty
      if (batida.isManuscrito) {
        score -= ConfidenceScorerService.MANUSCRITO_PENALTY;
      }

      // Format penalty: not HH:MM
      if (!this.isValidTimeFormat(value)) {
        score -= ConfidenceScorerService.FORMAT_PENALTY;
      }

      // Expected range bonus
      if (
        horarioContratual &&
        this.isWithinExpectedRange(value, field, horarioContratual)
      ) {
        score += ConfidenceScorerService.EXPECTED_RANGE_BONUS;
      }

      confianca[field] = Math.max(0, Math.min(1, score));
    }

    // Check consistency (saida must be after entrada)
    const isInconsistente = this.checkInconsistency(batida);
    if (isInconsistente) {
      for (const field of fields) {
        if (confianca[field]) {
          confianca[field] = Math.max(
            0,
            confianca[field] - ConfidenceScorerService.INCONSISTENCY_PENALTY,
          );
        }
      }
    }

    // Check if falta/folga (no entries at all)
    const isFaltaDia =
      !batida.entradaManha &&
      !batida.saidaManha &&
      !batida.entradaTarde &&
      !batida.saidaTarde;

    // Needs review if any field below threshold
    const needsReview = Object.values(confianca).some(
      (v) => v > 0 && v < ConfidenceScorerService.REVIEW_THRESHOLD,
    );

    return {
      dia: batida.dia,
      diaSemana: batida.diaSemana,
      entradaManha: batida.entradaManha,
      saidaManha: batida.saidaManha,
      entradaTarde: batida.entradaTarde,
      saidaTarde: batida.saidaTarde,
      entradaExtra: batida.entradaExtra,
      saidaExtra: batida.saidaExtra,
      confianca,
      isManuscrito: batida.isManuscrito,
      isInconsistente,
      isFaltaDia,
      needsReview,
    };
  }

  private isValidTimeFormat(value: string): boolean {
    return /^\d{2}:\d{2}$/.test(value);
  }

  private timeToMinutes(time: string): number | null {
    const match = time.match(/^(\d{2}):(\d{2})$/);
    if (!match) return null;
    return parseInt(match[1], 10) * 60 + parseInt(match[2], 10);
  }

  private checkInconsistency(batida: RawBatidaInput): boolean {
    // Check entrada < saida for morning
    if (batida.entradaManha && batida.saidaManha) {
      const entrada = this.timeToMinutes(batida.entradaManha);
      const saida = this.timeToMinutes(batida.saidaManha);
      if (entrada !== null && saida !== null && saida <= entrada) return true;
    }

    // Check entrada < saida for afternoon
    if (batida.entradaTarde && batida.saidaTarde) {
      const entrada = this.timeToMinutes(batida.entradaTarde);
      const saida = this.timeToMinutes(batida.saidaTarde);
      if (entrada !== null && saida !== null && saida <= entrada) return true;
    }

    // Check saidaManha < entradaTarde (lunch break makes sense)
    if (batida.saidaManha && batida.entradaTarde) {
      const saida = this.timeToMinutes(batida.saidaManha);
      const entrada = this.timeToMinutes(batida.entradaTarde);
      if (saida !== null && entrada !== null && entrada < saida) return true;
    }

    return false;
  }

  private isWithinExpectedRange(
    value: string,
    field: string,
    horarioContratual: string,
  ): boolean {
    const minutes = this.timeToMinutes(value);
    if (minutes === null) return false;

    // Parse horarioContratual like "07:00-16:00 Int. 11:00-12:00"
    const match = horarioContratual.match(/(\d{2}:\d{2})-(\d{2}:\d{2})/);
    if (!match) return false;

    const inicioJornada = this.timeToMinutes(match[1]);
    const fimJornada = this.timeToMinutes(match[2]);
    if (inicioJornada === null || fimJornada === null) return false;

    // Allow 1 hour tolerance
    const tolerance = 60;

    if (field === 'entradaManha') {
      return Math.abs(minutes - inicioJornada) <= tolerance;
    }
    if (field === 'saidaTarde') {
      return Math.abs(minutes - fimJornada) <= tolerance;
    }

    // For other fields, just check within workday range
    return (
      minutes >= inicioJornada - tolerance &&
      minutes <= fimJornada + tolerance
    );
  }
}
