import { Injectable, Logger } from '@nestjs/common';
import { ScoredBatida } from './confidence-scorer.service';
import { SanitizedBatida } from './time-sanitizer.service';
import { ValidatedBatida } from './consistency-validator.service';

export interface GatekeeperDecision {
  shouldCallGpt: boolean;
  reason: string;
  fieldsToValidate: string[];
}

const TIME_FIELDS = [
  'entradaManha',
  'saidaManha',
  'entradaTarde',
  'saidaTarde',
  'entradaExtra',
  'saidaExtra',
] as const;

/** Default thresholds — overridable via tenant config */
const DEFAULT_SKIP_THRESHOLD = 0.90;
const DEFAULT_UNCERTAIN_THRESHOLD = 0.75;

@Injectable()
export class GptGatekeeperService {
  private readonly logger = new Logger(GptGatekeeperService.name);

  /**
   * Decide whether GPT Vision should be called for this page.
   *
   * SKIP GPT when:
   * - ALL fields have confidence >= skipThreshold
   * - No sanitizer corrections were applied
   * - No consistency errors (severity = 'error')
   *
   * CALL GPT when:
   * - Any field < uncertainThreshold (0.75)
   * - Sanitizer made corrections
   * - SEQUENCE_ERROR consistency issue
   * - Page is manuscrito
   * - More than MAX_UNCERTAIN_FIELDS fields between uncertain and skip threshold
   */
  decide(
    scored: ScoredBatida[],
    sanitized: SanitizedBatida[],
    validated: ValidatedBatida[],
    isManuscrito: boolean,
    _skipThreshold = DEFAULT_SKIP_THRESHOLD,
  ): GatekeeperDecision {
    // GPT Vision is always called for every page — provides a second opinion
    // on all time values regardless of DI confidence
    const reason = isManuscrito
      ? 'always_call_gpt (manuscrito)'
      : this.detectDetailedReason(scored, sanitized, validated);

    this.logger.log(`[Gatekeeper] Calling GPT: ${reason}`);

    return {
      shouldCallGpt: true,
      reason,
      fieldsToValidate: [...TIME_FIELDS],
    };
  }

  /**
   * Detect the most specific reason for calling GPT (for metrics/logging).
   * GPT is always called, but the reason helps track why.
   */
  private detectDetailedReason(
    scored: ScoredBatida[],
    sanitized: SanitizedBatida[],
    validated: ValidatedBatida[],
  ): string {
    const hasSanitizerCorrections = sanitized.some(
      (b) => b.sanitizations.length > 0,
    );
    if (hasSanitizerCorrections) return 'always_call_gpt (sanitizer_corrections)';

    const hasConsistencyErrors = validated.some((b) =>
      b.consistencyIssues.some((issue) => issue.severity === 'error'),
    );
    if (hasConsistencyErrors) return 'always_call_gpt (consistency_errors)';

    let lowConfidenceCount = 0;
    for (const batida of scored) {
      for (const field of TIME_FIELDS) {
        const conf = batida.confianca[field] ?? 0;
        if (conf > 0 && conf < DEFAULT_UNCERTAIN_THRESHOLD) {
          lowConfidenceCount++;
        }
      }
    }
    if (lowConfidenceCount > 0) return `always_call_gpt (low_confidence: ${lowConfidenceCount})`;

    return 'always_call_gpt (high_confidence)';
  }
}
