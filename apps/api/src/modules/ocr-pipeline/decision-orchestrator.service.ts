import { Injectable } from '@nestjs/common';
import { OutlierFlag } from './outlier-detector.service';
import {
  PreOrchestratedBatida,
  OrchestratedBatida,
  FieldDecision,
  DecisionSource,
  Gpt52FieldResult,
  TIME_FIELDS,
  TimeField,
} from './ocr-pipeline.types';

/**
 * Criticidade de negocio por campo.
 * Entrada/saida manha e tarde sao criticos para calculo de horas.
 * Extra tem criticidade menor.
 */
const FIELD_CRITICALITY: Record<string, number> = {
  entradaManha: 0.9,
  saidaManha: 0.8,
  entradaTarde: 0.9,
  saidaTarde: 0.8,
  entradaExtra: 0.5,
  saidaExtra: 0.5,
};

@Injectable()
export class DecisionOrchestratorService {
  /**
   * Orchestrate decisions for all batidas.
   * Applies prioritized rules to determine the final value for each field.
   *
   * Pipeline otimizado:
   * - Caminho feliz (Mini alta confianca, sem fallback): R0 — aceita Mini direto
   * - Caminho com fallback (Mini + GPT-5.2): arbitra entre MINI e GPT52
   */
  orchestrate(
    batidas: PreOrchestratedBatida[],
    outlierBatidaFlags: OutlierFlag[][],
  ): OrchestratedBatida[] {
    return batidas.map((batida, idx) => {
      const outlierFlags = outlierBatidaFlags[idx] ?? [];
      return this.orchestrateBatida(batida, outlierFlags);
    });
  }

  private orchestrateBatida(
    batida: PreOrchestratedBatida,
    outlierFlags: OutlierFlag[],
  ): OrchestratedBatida {
    const decisions: Record<string, FieldDecision> = {};
    const reviewReasons: string[] = [];
    let globalNeedsReview = false;

    for (const field of TIME_FIELDS) {
      const decision = this.decideField(batida, field, outlierFlags);
      decisions[field] = decision;

      if (decision.needsReview) {
        globalNeedsReview = true;
        if (decision.reviewReason) {
          reviewReasons.push(decision.reviewReason);
        }
      }
    }

    // Build final values from decisions
    const finalValues: Record<string, string | null> = {};
    const finalConfianca: Record<string, number> = {};

    for (const field of TIME_FIELDS) {
      finalValues[field] = decisions[field].valorFinal;
      finalConfianca[field] = decisions[field].confiancaFinal;
    }

    return {
      dia: batida.dia,
      diaSemana: batida.diaSemana,
      entradaManha: finalValues.entradaManha ?? null,
      saidaManha: finalValues.saidaManha ?? null,
      entradaTarde: finalValues.entradaTarde ?? null,
      saidaTarde: finalValues.saidaTarde ?? null,
      entradaExtra: finalValues.entradaExtra ?? null,
      saidaExtra: finalValues.saidaExtra ?? null,
      confianca: finalConfianca,
      isManuscrito: batida.isManuscrito,
      isInconsistente: batida.isInconsistente,
      isFaltaDia: batida.isFaltaDia,
      needsReview: globalNeedsReview,
      reviewReasons,
      miniFailed: batida.miniFailed,
      miniResult: batida.miniResult,
      gpt52Failed: batida.gpt52Failed,
      gpt52Result: batida.gpt52Result,
      consistencyIssues: batida.consistencyIssues,
      decisions,
    };
  }

  /**
   * Apply prioritized rules to decide the final value for a field.
   *
   * Rules adapted for MINI/GPT52 sources:
   * R0: Mini >= 0.90, no GPT52, no issues → accept Mini (happy path)
   * R1: Mini + GPT52 concordam, both >= 0.90 → accept Mini
   * R2: GPT52 discorda, GPT52 >= 0.85, Mini < 0.70 → use GPT52
   * R3: Discordam, confianca similar → use higher, review
   * R4: Both < 0.70 → keep Mini, review
   * R5: Consistency penalty >= 0.25 → forced review (post-rule)
   * R6: Outlier + confidence < 0.80 → review (post-rule)
   * R7: GPT52 not called/failed + Mini < 0.80 → review
   * R9: Mini != GPT52, both moderate confidence → review
   */
  private decideField(
    batida: PreOrchestratedBatida,
    field: string,
    outlierFlags: OutlierFlag[],
  ): FieldDecision {
    // Mini values (primary source)
    const miniValue = (batida as unknown as Record<string, string | null>)[field];
    const miniConfidence = batida.confianca[field] ?? 0;

    // GPT-5.2 values (fallback, may not exist)
    const gpt52Dia = batida.gpt52Result;
    const gpt52Field: Gpt52FieldResult | undefined = gpt52Dia
      ? (gpt52Dia[field as TimeField] as Gpt52FieldResult)
      : undefined;
    const gpt52Value = gpt52Field?.valor ?? null;
    const gpt52Confidence = gpt52Field?.confidence ?? 0;
    const gpt52Called = gpt52Dia !== undefined;
    const concordaMini = gpt52Field?.concordaMini ?? true;

    const criticidade = FIELD_CRITICALITY[field] ?? 0.5;

    // Check consistency issues affecting this field
    const fieldConsistencyIssues = batida.consistencyIssues.filter(
      (issue) => issue.affectedFields.includes(field),
    );
    const maxConsistencyPenalty = fieldConsistencyIssues.reduce(
      (max, issue) => Math.max(max, issue.penalty),
      0,
    );

    // Check outlier flags for this field
    const fieldOutliers = outlierFlags.filter((f) => f.campo === field);
    const hasOutlier = fieldOutliers.length > 0;

    let valorFinal: string | null;
    let fonteEscolhida: DecisionSource;
    let confiancaLeitura: number;
    let justificativa: string;
    let needsReview = false;
    let reviewReason: string | null = null;

    // === RULE 0: Happy path — Mini >= 0.90, no GPT52, no issues ===
    if (
      !gpt52Called &&
      miniConfidence >= 0.90 &&
      maxConsistencyPenalty < 0.25 &&
      !hasOutlier
    ) {
      valorFinal = miniValue;
      fonteEscolhida = 'MINI';
      confiancaLeitura = miniConfidence;
      justificativa = 'R0: Mini alta confianca, sem fallback necessario';
    }
    // === RULE 1: Mini + GPT52 concordam, ambos >= 0.90 ===
    else if (gpt52Called && concordaMini && miniConfidence >= 0.90 && gpt52Confidence >= 0.90) {
      valorFinal = miniValue;
      fonteEscolhida = 'MINI';
      confiancaLeitura = Math.max(miniConfidence, gpt52Confidence);
      justificativa = 'R1: Mini+GPT52 concordam, alta confianca';
    }
    // === RULE 2: GPT52 discorda, GPT52 >= 0.85, Mini < 0.70 ===
    else if (gpt52Called && !concordaMini && gpt52Confidence >= 0.85 && miniConfidence < 0.70 && gpt52Value !== null) {
      valorFinal = gpt52Value;
      fonteEscolhida = 'GPT52';
      confiancaLeitura = gpt52Confidence;
      justificativa = 'R2: GPT52 discorda, GPT52 alta conf, Mini baixa conf';
    }
    // === RULE 3: Discordam, confianca similar (diff < 0.15) ===
    else if (gpt52Called && !concordaMini && Math.abs(miniConfidence - gpt52Confidence) < 0.15) {
      if (gpt52Confidence >= miniConfidence && gpt52Value !== null) {
        valorFinal = gpt52Value;
        fonteEscolhida = 'GPT52';
        confiancaLeitura = gpt52Confidence;
      } else {
        valorFinal = miniValue;
        fonteEscolhida = 'MINI';
        confiancaLeitura = miniConfidence;
      }
      justificativa = 'R3: Mini/GPT52 discordam, confianca similar';
      needsReview = true;
      reviewReason = `${field}: Mini/GPT52 discordam com confianca similar (Mini=${miniConfidence.toFixed(2)}, GPT52=${gpt52Confidence.toFixed(2)})`;
    }
    // === RULE 4: Ambos < 0.70 ===
    else if (miniConfidence < 0.70 && (!gpt52Called || gpt52Confidence < 0.70)) {
      valorFinal = miniValue;
      fonteEscolhida = 'MINI';
      confiancaLeitura = gpt52Called
        ? Math.max(miniConfidence, gpt52Confidence)
        : miniConfidence;
      justificativa = 'R4: Baixa confianca em todas as fontes';
      needsReview = true;
      reviewReason = gpt52Called
        ? `${field}: Baixa confianca (Mini=${miniConfidence.toFixed(2)}, GPT52=${gpt52Confidence.toFixed(2)})`
        : `${field}: Mini baixa confianca (${miniConfidence.toFixed(2)}), sem fallback`;
    }
    // === RULE 7: GPT52 nao chamado/falhou + Mini < 0.80 ===
    else if ((!gpt52Called || batida.gpt52Failed) && miniConfidence < 0.80) {
      valorFinal = miniValue;
      fonteEscolhida = 'MINI';
      confiancaLeitura = miniConfidence;
      justificativa = gpt52Called
        ? 'R7: GPT52 falhou, Mini incerto'
        : 'R7: Sem fallback, Mini incerto';
      needsReview = true;
      reviewReason = `${field}: Mini < 0.80 (${miniConfidence.toFixed(2)})${batida.gpt52Failed ? ', GPT52 falhou' : ''}`;
    }
    // === Default: use Mini ===
    else {
      valorFinal = miniValue;
      fonteEscolhida = 'MINI';
      confiancaLeitura = miniConfidence;
      justificativa = 'Default: Mini aceito';
    }

    // === RULE 5: Consistency violation penalty >= 0.25 → forced review ===
    if (maxConsistencyPenalty >= 0.25) {
      needsReview = true;
      reviewReason = reviewReason ?? `${field}: Violacao consistencia severa (penalty=${maxConsistencyPenalty.toFixed(2)})`;
      justificativa += ' + R5: consistencia severa';
    }

    // === RULE 6: Outlier + confianca < 0.80 → review ===
    if (hasOutlier && confiancaLeitura < 0.80) {
      needsReview = true;
      reviewReason = reviewReason ?? `${field}: Outlier detectado com confianca < 0.80`;
      justificativa += ' + R6: outlier+baixa conf';
    }

    // === RULE 9: Mini != GPT52, both moderate confidence → review ===
    if (gpt52Called && miniValue && gpt52Value && miniValue !== gpt52Value) {
      if (miniConfidence > 0.50 && gpt52Confidence > 0.50 && !concordaMini) {
        if (!needsReview && Math.abs(miniConfidence - gpt52Confidence) >= 0.15) {
          needsReview = true;
          reviewReason = reviewReason ?? `${field}: Valores distintos Mini/GPT52`;
          justificativa += ' + R9: valores distintos';
        }
      }
    }

    // Compute confiancaFinal = confiancaLeitura * (1 - criticidadeNegocio * 0.5)
    const confiancaFinal = confiancaLeitura * (1 - criticidade * 0.5);

    return {
      campo: field,
      valorFinal,
      fonteEscolhida,
      confiancaLeitura,
      criticidadeNegocio: criticidade,
      confiancaFinal,
      justificativa,
      needsReview,
      reviewReason,
    };
  }
}
