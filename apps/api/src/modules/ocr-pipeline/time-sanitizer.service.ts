import { Injectable, Logger } from '@nestjs/common';
import { ParsedBatida } from './card-parser.service';

/**
 * Expected time ranges per field (in minutes from midnight).
 * Used for plausibility checks and digit-substitution candidate selection.
 */
export const TIME_FIELD_RANGES: Record<
  string,
  { min: number; max: number; label: string }
> = {
  entradaManha: { min: 360, max: 600, label: '06:00-10:00' },
  saidaManha: { min: 600, max: 780, label: '10:00-13:00' },
  entradaTarde: { min: 720, max: 900, label: '12:00-15:00' },
  saidaTarde: { min: 900, max: 1200, label: '15:00-20:00' },
  entradaExtra: { min: 1080, max: 1380, label: '18:00-23:00' },
  saidaExtra: { min: 1140, max: 1439, label: '19:00-23:59' },
};

/**
 * Common OCR digit confusions observed in punch-card scanning.
 * Each digit maps to the set of digits it's commonly confused with.
 */
const DIGIT_CONFUSIONS: Record<string, string[]> = {
  '7': ['1'],
  '1': ['7'],
  '2': ['1'],
  '0': ['8', '6'],
  '8': ['0', '6'],
  '6': ['8', '5'],
  '5': ['6'],
  '3': ['8'],
  '9': ['4'],
  '4': ['9'],
};

export interface SanitizationResult {
  valorOriginal: string;
  valorCorrigido: string | null;
  regra: string;
  confiancaCorrecao: number;
  autoCorrigido: boolean;
}

export interface TimeSanitization {
  field: string;
  dia: number;
  original: string;
  corrected: string;
  rule: string;
  confidencePenalty: number;
  sanitizationResult?: SanitizationResult;
}

export interface SanitizedBatida extends ParsedBatida {
  sanitizations: TimeSanitization[];
}

const SANITIZATION_CONFIDENCE_PENALTY = 0.25;

const TIME_FIELDS = [
  'entradaManha',
  'saidaManha',
  'entradaTarde',
  'saidaTarde',
  'entradaExtra',
  'saidaExtra',
] as const;

@Injectable()
export class TimeSanitizerService {
  private readonly logger = new Logger(TimeSanitizerService.name);

  sanitize(batidas: ParsedBatida[]): SanitizedBatida[] {
    const result: SanitizedBatida[] = [];
    let totalCorrections = 0;

    for (const batida of batidas) {
      const sanitizations: TimeSanitization[] = [];
      const sanitized: SanitizedBatida = {
        ...batida,
        confidences: { ...batida.confidences },
        sanitizations,
      };

      for (const field of TIME_FIELDS) {
        let value = sanitized[field];
        if (!value) continue;

        const range = TIME_FIELD_RANGES[field];
        if (!range) continue;

        // === Pre-processing: normalize common OCR artifacts ===
        const preProcessed = this.preProcess(value, field, batida.dia);
        if (preProcessed) {
          if (preProcessed.valorCorrigido === null) {
            // Identified as junk — null it out
            (sanitized as unknown as Record<string, string | null>)[field] = null;
            sanitized.confidences[field] = preProcessed.confiancaCorrecao;
            sanitizations.push({
              field,
              dia: batida.dia,
              original: value,
              corrected: '',
              rule: preProcessed.regra,
              confidencePenalty: 1 - preProcessed.confiancaCorrecao,
              sanitizationResult: preProcessed,
            });
            continue;
          }
          if (preProcessed.valorCorrigido !== value) {
            // Pre-processing changed the value
            value = preProcessed.valorCorrigido;
            (sanitized as unknown as Record<string, string | null>)[field] = value;
            if (preProcessed.autoCorrigido) {
              // High confidence correction — minimal penalty
              sanitized.confidences[field] = Math.max(
                0,
                (sanitized.confidences[field] ?? 0) - 0.05,
              );
            } else {
              sanitized.confidences[field] = Math.max(
                0,
                (sanitized.confidences[field] ?? 0) - SANITIZATION_CONFIDENCE_PENALTY,
              );
            }
            sanitizations.push({
              field,
              dia: batida.dia,
              original: sanitized[field] ?? value,
              corrected: value,
              rule: preProcessed.regra,
              confidencePenalty: preProcessed.autoCorrigido ? 0.05 : SANITIZATION_CONFIDENCE_PENALTY,
              sanitizationResult: preProcessed,
            });
          }
        }

        // Check if the time is valid and plausible
        const minutes = this.timeToMinutes(value);

        if (minutes === null) {
          // Invalid format — try digit substitution to find a valid time
          const correction = this.tryDigitCorrection(value, range, field);
          if (correction) {
            (sanitized as unknown as Record<string, string | null>)[field] =
              correction.corrected;
            sanitized.confidences[field] = Math.max(
              0,
              (sanitized.confidences[field] ?? 0) -
                SANITIZATION_CONFIDENCE_PENALTY,
            );
            sanitizations.push({
              field,
              dia: batida.dia,
              original: value,
              corrected: correction.corrected,
              rule: correction.rule,
              confidencePenalty: SANITIZATION_CONFIDENCE_PENALTY,
            });
          } else {
            // Can't fix — null it out so it goes to review
            (sanitized as unknown as Record<string, string | null>)[field] =
              null;
            sanitized.confidences[field] = 0;
            sanitizations.push({
              field,
              dia: batida.dia,
              original: value,
              corrected: '',
              rule: 'unfixable_invalid_time',
              confidencePenalty: 1,
            });
          }
        } else if (minutes < range.min || minutes > range.max) {
          // Valid format but outside expected range — try digit substitution
          const correction = this.tryDigitCorrection(value, range, field);
          if (correction) {
            (sanitized as unknown as Record<string, string | null>)[field] =
              correction.corrected;
            sanitized.confidences[field] = Math.max(
              0,
              (sanitized.confidences[field] ?? 0) -
                SANITIZATION_CONFIDENCE_PENALTY,
            );
            sanitizations.push({
              field,
              dia: batida.dia,
              original: value,
              corrected: correction.corrected,
              rule: correction.rule,
              confidencePenalty: SANITIZATION_CONFIDENCE_PENALTY,
            });
          }
          // If no correction found, keep the original — might be legitimate (e.g., overtime)
        }
        // Valid and within range — no action needed
      }

      if (sanitizations.length > 0) {
        totalCorrections += sanitizations.length;
        for (const s of sanitizations) {
          this.logger.log('Time sanitized', {
            dia: s.dia,
            field: s.field,
            original: s.original,
            corrected: s.corrected,
            rule: s.rule,
          });
        }
      }

      result.push(sanitized);
    }

    if (totalCorrections > 0) {
      this.logger.log('Time sanitization complete', {
        totalBatidas: batidas.length,
        totalCorrections,
      });
    }

    return result;
  }

  /**
   * Try single-digit substitutions to find a valid time within the expected range.
   * For each digit in the time string, try replacing it with commonly confused digits.
   * Return the candidate closest to the range midpoint.
   */
  private tryDigitCorrection(
    value: string,
    range: { min: number; max: number },
    field: string,
  ): { corrected: string; rule: string } | null {
    // Extract digits and separator from the value
    const match = value.match(/^(\d{1,2}):(\d{2})$/);
    if (!match) return null;

    const digits = match[1] + match[2]; // e.g., "7204" from "72:04"
    const rangeMid = (range.min + range.max) / 2;

    interface Candidate {
      time: string;
      minutes: number;
      distance: number;
      rule: string;
      substitutions: number;
    }

    const candidates: Candidate[] = [];

    // Try single-digit substitutions
    for (let i = 0; i < digits.length; i++) {
      const originalDigit = digits[i];
      const confusions = DIGIT_CONFUSIONS[originalDigit];
      if (!confusions) continue;

      for (const replacement of confusions) {
        const newDigits =
          digits.substring(0, i) + replacement + digits.substring(i + 1);
        const candidate = this.digitsToTime(newDigits, match[1].length);
        if (!candidate) continue;

        const minutes = this.timeToMinutes(candidate);
        if (minutes === null) continue;

        if (minutes >= range.min && minutes <= range.max) {
          candidates.push({
            time: candidate,
            minutes,
            distance: Math.abs(minutes - rangeMid),
            rule: `digit_sub_pos${i}_${originalDigit}_to_${replacement}`,
            substitutions: 1,
          });
        }
      }
    }

    // Try two-digit substitutions if no single-digit fix worked
    if (candidates.length === 0) {
      for (let i = 0; i < digits.length; i++) {
        const confusionsI = DIGIT_CONFUSIONS[digits[i]];
        if (!confusionsI) continue;

        for (const repI of confusionsI) {
          for (let j = i + 1; j < digits.length; j++) {
            const confusionsJ = DIGIT_CONFUSIONS[digits[j]];
            if (!confusionsJ) continue;

            for (const repJ of confusionsJ) {
              let newDigits = digits;
              newDigits =
                newDigits.substring(0, i) + repI + newDigits.substring(i + 1);
              newDigits =
                newDigits.substring(0, j) + repJ + newDigits.substring(j + 1);

              const candidate = this.digitsToTime(
                newDigits,
                match[1].length,
              );
              if (!candidate) continue;

              const minutes = this.timeToMinutes(candidate);
              if (minutes === null) continue;

              if (minutes >= range.min && minutes <= range.max) {
                candidates.push({
                  time: candidate,
                  minutes,
                  distance: Math.abs(minutes - rangeMid),
                  rule: `digit_sub_pos${i}_${digits[i]}_to_${repI}_pos${j}_${digits[j]}_to_${repJ}`,
                  substitutions: 2,
                });
              }
            }
          }
        }
      }
    }

    if (candidates.length === 0) return null;

    // Prefer fewer substitutions, then closest to range midpoint
    candidates.sort((a, b) => {
      if (a.substitutions !== b.substitutions)
        return a.substitutions - b.substitutions;
      return a.distance - b.distance;
    });

    const best = candidates[0];

    this.logger.debug('Digit correction candidates', {
      field,
      original: value,
      candidateCount: candidates.length,
      selected: best.time,
      rule: best.rule,
    });

    return { corrected: best.time, rule: best.rule };
  }

  private digitsToTime(
    digits: string,
    hourDigits: number,
  ): string | null {
    const h = parseInt(digits.substring(0, hourDigits), 10);
    const m = parseInt(digits.substring(hourDigits), 10);
    if (h < 0 || h > 23 || m < 0 || m > 59) return null;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }

  private timeToMinutes(time: string): number | null {
    const match = time.match(/^(\d{1,2}):(\d{2})$/);
    if (!match) return null;
    const h = parseInt(match[1], 10);
    const m = parseInt(match[2], 10);
    if (h < 0 || h > 23 || m < 0 || m > 59) return null;
    return h * 60 + m;
  }

  /**
   * Pre-processing step before digit correction.
   * Handles common OCR normalization issues:
   * 1. "." to ":" normalization (e.g., "10.50" → "10:50")
   * 2. 4 digits without separator (e.g., "1600" → "16:00")
   * 3. OCR junk detection (> 5 chars, letters mixed in)
   * 4. Single-digit isolated values
   */
  private preProcess(
    value: string,
    field: string,
    dia: number,
  ): SanitizationResult | null {
    const trimmed = value.trim();

    // 1. Detect OCR junk: too many characters, mixed letters and digits
    if (trimmed.length > 5) {
      const digitCount = (trimmed.match(/\d/g) ?? []).length;
      const letterCount = (trimmed.match(/[a-zA-Z]/g) ?? []).length;

      if (letterCount > 0 || digitCount > 5) {
        this.logger.debug('Pre-process: junk detected', { field, dia, value: trimmed });
        return {
          valorOriginal: trimmed,
          valorCorrigido: null,
          regra: 'junk_ocr_artifact',
          confiancaCorrecao: 0.10,
          autoCorrigido: false,
        };
      }
    }

    // 2. Normalize "." to ":" (e.g., "10.50" → "10:50")
    if (/^\d{1,2}\.\d{2}$/.test(trimmed)) {
      const normalized = trimmed.replace('.', ':');
      const minutes = this.timeToMinutes(normalized);
      if (minutes !== null) {
        return {
          valorOriginal: trimmed,
          valorCorrigido: normalized,
          regra: 'dot_to_colon',
          confiancaCorrecao: 0.95,
          autoCorrigido: true,
        };
      }
    }

    // 3. 4 digits without separator (e.g., "1600" → "16:00")
    if (/^\d{4}$/.test(trimmed)) {
      const h = parseInt(trimmed.substring(0, 2), 10);
      const m = parseInt(trimmed.substring(2, 4), 10);
      if (h >= 0 && h <= 23 && m >= 0 && m <= 59) {
        const formatted = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
        return {
          valorOriginal: trimmed,
          valorCorrigido: formatted,
          regra: 'four_digits_no_separator',
          confiancaCorrecao: 0.90,
          autoCorrigido: true,
        };
      }
    }

    // 4. 3 digits without separator (e.g., "800" → "08:00", "730" → "07:30")
    if (/^\d{3}$/.test(trimmed)) {
      const h = parseInt(trimmed.substring(0, 1), 10);
      const m = parseInt(trimmed.substring(1, 3), 10);
      if (h >= 0 && h <= 9 && m >= 0 && m <= 59) {
        const formatted = `0${h}:${String(m).padStart(2, '0')}`;
        const minutes = this.timeToMinutes(formatted);
        const range = TIME_FIELD_RANGES[field];
        if (minutes !== null && range && minutes >= range.min && minutes <= range.max) {
          return {
            valorOriginal: trimmed,
            valorCorrigido: formatted,
            regra: 'three_digits_no_separator',
            confiancaCorrecao: 0.85,
            autoCorrigido: true,
          };
        }
      }
    }

    // 5. Single digit — too ambiguous for auto-correction
    if (/^\d$/.test(trimmed)) {
      return {
        valorOriginal: trimmed,
        valorCorrigido: null,
        regra: 'single_digit_ambiguous',
        confiancaCorrecao: 0.10,
        autoCorrigido: false,
      };
    }

    // 6. Two digits — could be hours only (e.g., "08" → "08:00") but low confidence
    if (/^\d{2}$/.test(trimmed)) {
      const h = parseInt(trimmed, 10);
      if (h >= 0 && h <= 23) {
        const formatted = `${String(h).padStart(2, '0')}:00`;
        const minutes = this.timeToMinutes(formatted);
        const range = TIME_FIELD_RANGES[field];
        if (minutes !== null && range && minutes >= range.min && minutes <= range.max) {
          return {
            valorOriginal: trimmed,
            valorCorrigido: formatted,
            regra: 'two_digits_hours_only',
            confiancaCorrecao: 0.50,
            autoCorrigido: false, // Below threshold — needs review
          };
        }
      }
    }

    return null; // No pre-processing needed
  }
}
