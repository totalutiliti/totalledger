import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import { pdfToPng } from 'pdf-to-png-converter';
import { ScoredBatida } from './confidence-scorer.service';
import { RateLimiterService } from './rate-limiter.service';
import {
  MiniDiaResult,
  Gpt52FallbackResult,
  Gpt52DiaResult,
  Gpt52FieldResult,
  TIME_FIELDS as PIPELINE_TIME_FIELDS,
} from './ocr-pipeline.types';

export interface GptFieldResult {
  valor: string | null;
  concordaDi: boolean;
  confidence: number;
}

export interface GptDiaResult {
  dia: number;
  entradaManha: GptFieldResult;
  saidaManha: GptFieldResult;
  entradaTarde: GptFieldResult;
  saidaTarde: GptFieldResult;
  entradaExtra: GptFieldResult;
  saidaExtra: GptFieldResult;
}

export interface GptValidationResult {
  dias: GptDiaResult[];
  gptFailed: boolean;
  tokensIn: number;
  tokensOut: number;
  latencyMs: number;
}

export interface GptMergedBatida extends ScoredBatida {
  gptFailed: boolean;
  gptResult?: GptDiaResult;
}

const TIME_FIELDS = [
  'entradaManha',
  'saidaManha',
  'entradaTarde',
  'saidaTarde',
  'entradaExtra',
  'saidaExtra',
] as const;

const MAX_RETRIES = 3;
const RETRY_BACKOFFS = [1000, 2000, 4000];
const REQUEST_TIMEOUT = 180000;

@Injectable()
export class GptVisionValidatorService {
  private readonly logger = new Logger(GptVisionValidatorService.name);
  private client: OpenAI | null = null;
  private readonly model: string;

  constructor(
    private readonly configService: ConfigService,
    private readonly rateLimiter: RateLimiterService,
  ) {
    const endpoint = this.configService.get<string>('AZURE_OPENAI_ENDPOINT');
    const key = this.configService.get<string>('AZURE_OPENAI_KEY');
    const apiVersion = this.configService.get<string>(
      'AZURE_OPENAI_OCR_API_VERSION',
      '2025-04-01-preview',
    );
    this.model = this.configService.get<string>(
      'AZURE_OPENAI_OCR_DEPLOYMENT',
      'gpt-52-chat',
    );

    if (endpoint && key) {
      this.client = new OpenAI({
        apiKey: key,
        baseURL: `${endpoint}/openai/deployments/${this.model}`,
        defaultQuery: { 'api-version': apiVersion },
        defaultHeaders: { 'api-key': key },
        timeout: REQUEST_TIMEOUT,
      });
      this.logger.log('GPT Vision Validator initialized', {
        deployment: this.model,
        apiVersion,
      });
    } else {
      this.logger.warn(
        'Azure OpenAI not configured — GPT Vision Validator using mock mode',
      );
    }
  }

  /**
   * Convert a specific PDF page to a PNG image buffer.
   * Uses pdf-to-png-converter (pdfjs-dist + canvas under the hood).
   */
  private async convertPageToPng(
    pdfBuffer: Buffer,
    pageNumber: number,
  ): Promise<Buffer> {
    const pages = await pdfToPng(new Uint8Array(pdfBuffer).buffer, {
      pagesToProcess: [pageNumber],
      viewportScale: 2, // 2x scale for better readability
    });

    if (!pages[0]?.content) {
      throw new Error(
        `Failed to convert PDF page ${pageNumber} to PNG — no content returned`,
      );
    }

    this.logger.log('PDF page converted to PNG', {
      pageNumber,
      width: pages[0].width,
      height: pages[0].height,
      sizeKB: Math.round(pages[0].content.length / 1024),
    });

    return pages[0].content;
  }

  /**
   * PRIMARY EXTRACTION: GPT-5.2 Vision reads the time card image directly,
   * without relying on Azure DI data. Returns structured time entries.
   */
  async extract(
    pdfBuffer: Buffer,
    pageNumber: number,
  ): Promise<GptValidationResult> {
    const startTime = Date.now();

    if (!this.client) {
      return this.getMockExtractResult(startTime);
    }

    // Convert the specific PDF page to a PNG image
    let pageImageBase64: string;
    try {
      const pngBuffer = await this.convertPageToPng(pdfBuffer, pageNumber);
      pageImageBase64 = pngBuffer.toString('base64');
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(
        `Failed to convert PDF page ${pageNumber} to PNG: ${message}`,
        undefined,
        { pageNumber },
      );
      return {
        dias: [],
        gptFailed: true,
        tokensIn: 0,
        tokensOut: 0,
        latencyMs: Date.now() - startTime,
      };
    }

    const prompt = this.buildExtractionPrompt(pageNumber);

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        const completion = await this.client.chat.completions.create({
          model: this.model,
          messages: [
            {
              role: 'system',
              content: `Você é um especialista em leitura de cartões de ponto brasileiros manuscritos e impressos. Sua tarefa é extrair TODOS os horários registrados na imagem do cartão de ponto. Responda APENAS em JSON válido.`,
            },
            {
              role: 'user',
              content: [
                {
                  type: 'image_url',
                  image_url: {
                    url: `data:image/png;base64,${pageImageBase64}`,
                    detail: 'high',
                  },
                },
                {
                  type: 'text',
                  text: prompt,
                },
              ],
            },
          ],
          max_completion_tokens: 16000,
        });

        const latencyMs = Date.now() - startTime;
        const content = completion.choices[0]?.message?.content ?? '';
        const tokensIn = completion.usage?.prompt_tokens ?? 0;
        const tokensOut = completion.usage?.completion_tokens ?? 0;

        const parsed = this.parseExtractionResponse(content);

        this.logger.log('GPT Vision extraction completed', {
          pageNumber,
          attempt: attempt + 1,
          tokensIn,
          tokensOut,
          latencyMs,
          diasExtracted: parsed.length,
        });

        return {
          dias: parsed,
          gptFailed: false,
          tokensIn,
          tokensOut,
          latencyMs,
        };
      } catch (error: unknown) {
        const message =
          error instanceof Error ? error.message : 'Unknown error';
        this.logger.warn(
          `GPT Vision extraction attempt ${attempt + 1}/${MAX_RETRIES} failed: ${message}`,
          { pageNumber },
        );

        if (attempt < MAX_RETRIES - 1) {
          await this.sleep(RETRY_BACKOFFS[attempt]);
        }
      }
    }

    // All retries exhausted
    const latencyMs = Date.now() - startTime;
    this.logger.error(
      'GPT Vision extraction failed after all retries',
      undefined,
      { pageNumber, latencyMs },
    );

    return {
      dias: [],
      gptFailed: true,
      tokensIn: 0,
      tokensOut: 0,
      latencyMs,
    };
  }

  /**
   * FALLBACK: Verify problematic days using GPT-5.2 Vision with cropped images.
   * Only called when Mini confidence is low, consistency errors are severe,
   * or outliers are detected with low confidence.
   *
   * Uses anti-anchoring prompt: presents Mini output as "hypothesis" to verify,
   * not as ground truth. Instructs GPT-5.2 to read independently first.
   *
   * @param croppedImages - PNG buffers of cropped row strips for problematic days
   * @param miniHypothesis - Mini extraction results for the problematic days
   * @param problematicDays - Day numbers to verify
   * @param pageNumber - Page number for logging
   */
  async verifyProblematicDays(
    croppedImages: Buffer[],
    miniHypothesis: MiniDiaResult[],
    problematicDays: number[],
    pageNumber: number,
  ): Promise<Gpt52FallbackResult> {
    const startTime = Date.now();

    if (!this.client) {
      return this.getMockFallbackResult(miniHypothesis, startTime);
    }

    // Combine cropped images into a single request with the anti-anchoring prompt
    const imageContents: OpenAI.Chat.Completions.ChatCompletionContentPart[] =
      croppedImages.map((img) => ({
        type: 'image_url' as const,
        image_url: {
          url: `data:image/png;base64,${img.toString('base64')}`,
          detail: 'high' as const,
        },
      }));

    const prompt = this.buildFallbackPrompt(miniHypothesis, problematicDays);

    await this.rateLimiter.acquire('gpt52');

    try {
      for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
        try {
          const completion = await this.client.chat.completions.create({
            model: this.model,
            messages: [
              {
                role: 'system',
                content: `Voce e um verificador especialista em cartoes de ponto brasileiros. Sua tarefa e ler INDEPENDENTEMENTE as imagens fornecidas, sem se deixar influenciar pela hipotese do sistema anterior. Reporte divergencias com clareza. Responda APENAS em JSON valido.`,
              },
              {
                role: 'user',
                content: [
                  ...imageContents,
                  { type: 'text', text: prompt },
                ],
              },
            ],
            max_completion_tokens: 16000,
          });

          const latencyMs = Date.now() - startTime;
          const content = completion.choices[0]?.message?.content ?? '';
          const tokensIn = completion.usage?.prompt_tokens ?? 0;
          const tokensOut = completion.usage?.completion_tokens ?? 0;

          const dias = this.parseFallbackResponse(content, problematicDays);

          this.logger.log('GPT-5.2 fallback verification completed', {
            pageNumber,
            attempt: attempt + 1,
            tokensIn,
            tokensOut,
            latencyMs,
            daysVerified: dias.length,
            divergences: dias.reduce((sum, d) => {
              let count = 0;
              for (const field of PIPELINE_TIME_FIELDS) {
                const f = d[field] as Gpt52FieldResult;
                if (!f.concordaMini) count++;
              }
              return sum + count;
            }, 0),
          });

          return {
            dias,
            gpt52Failed: false,
            tokensIn,
            tokensOut,
            latencyMs,
          };
        } catch (error: unknown) {
          const message =
            error instanceof Error ? error.message : 'Unknown error';
          this.logger.warn(
            `GPT-5.2 fallback attempt ${attempt + 1}/${MAX_RETRIES} failed: ${message}`,
            { pageNumber },
          );

          if (attempt < MAX_RETRIES - 1) {
            await this.sleep(RETRY_BACKOFFS[attempt]);
          }
        }
      }

      // All retries exhausted
      const latencyMs = Date.now() - startTime;
      this.logger.error(
        'GPT-5.2 fallback verification failed after all retries',
        undefined,
        { pageNumber, latencyMs },
      );

      return {
        dias: [],
        gpt52Failed: true,
        tokensIn: 0,
        tokensOut: 0,
        latencyMs,
      };
    } finally {
      this.rateLimiter.release('gpt52');
    }
  }

  /**
   * Anti-anchoring prompt: presents Mini values as hypothesis, not fact.
   * Instructs GPT-5.2 to read the image independently first.
   */
  private buildFallbackPrompt(
    miniHypothesis: MiniDiaResult[],
    problematicDays: number[],
  ): string {
    const hypothesisData = miniHypothesis.map((h) => ({
      dia: h.dia,
      entradaManha: h.entradaManha.valor,
      saidaManha: h.saidaManha.valor,
      entradaTarde: h.entradaTarde.valor,
      saidaTarde: h.saidaTarde.valor,
      entradaExtra: h.entradaExtra.valor,
      saidaExtra: h.saidaExtra.valor,
    }));

    return `TAREFA DE VERIFICACAO:
As imagens acima mostram linhas especificas de um cartao de ponto brasileiro que precisam de verificacao.
Os dias a verificar sao: ${problematicDays.join(', ')}

INSTRUCOES CRITICAS:
1. LEIA a imagem INDEPENDENTEMENTE primeiro. Nao se deixe influenciar pela hipotese abaixo.
2. Para cada dia, extraia os 6 campos de horario diretamente da imagem.
3. DEPOIS de ler, compare sua leitura com a hipotese do sistema anterior.
4. Reporte EXPLICITAMENTE qualquer divergencia.

HIPOTESE DO SISTEMA ANTERIOR (pode conter erros — verifique na imagem):
${JSON.stringify(hypothesisData, null, 2)}

FORMATO DE RESPOSTA (JSON):
{
  "dias": [
    {
      "dia": 15,
      "entradaManha": { "valor": "07:25", "concordaMini": true, "confidence": 0.95, "divergencia": null },
      "saidaManha": { "valor": "12:10", "concordaMini": false, "confidence": 0.88, "divergencia": "Mini leu 12:00, eu li 12:10 — o digito parece ser 1 nao 0" },
      "entradaTarde": { "valor": "13:00", "concordaMini": true, "confidence": 0.90, "divergencia": null },
      "saidaTarde": { "valor": "18:05", "concordaMini": true, "confidence": 0.92, "divergencia": null },
      "entradaExtra": { "valor": null, "concordaMini": true, "confidence": 1.0, "divergencia": null },
      "saidaExtra": { "valor": null, "concordaMini": true, "confidence": 1.0, "divergencia": null }
    }
  ]
}`;
  }

  private parseFallbackResponse(
    content: string,
    _expectedDays: number[],
  ): Gpt52DiaResult[] {
    try {
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('No JSON found in GPT-5.2 fallback response');
      }

      const parsed = JSON.parse(jsonMatch[0]) as { dias?: unknown[] };

      if (!Array.isArray(parsed.dias)) {
        throw new Error('Response missing "dias" array');
      }

      return parsed.dias.map((dia: unknown) => {
        const d = dia as Record<string, unknown>;
        const diaNum = typeof d.dia === 'number' ? d.dia : 0;

        return {
          dia: diaNum,
          entradaManha: this.parseFallbackField(d.entradaManha),
          saidaManha: this.parseFallbackField(d.saidaManha),
          entradaTarde: this.parseFallbackField(d.entradaTarde),
          saidaTarde: this.parseFallbackField(d.saidaTarde),
          entradaExtra: this.parseFallbackField(d.entradaExtra),
          saidaExtra: this.parseFallbackField(d.saidaExtra),
        };
      });
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : 'Unknown error';
      this.logger.warn(`Failed to parse GPT-5.2 fallback response: ${message}`);
      return [];
    }
  }

  private parseFallbackField(field: unknown): Gpt52FieldResult {
    if (!field || typeof field !== 'object') {
      return { valor: null, concordaMini: true, confidence: 0.5, divergencia: null };
    }
    const f = field as Record<string, unknown>;
    return {
      valor: f.valor === null || f.valor === undefined ? null : String(f.valor),
      concordaMini: typeof f.concordaMini === 'boolean' ? f.concordaMini : true,
      confidence: typeof f.confidence === 'number' ? f.confidence : 0.5,
      divergencia: typeof f.divergencia === 'string' ? f.divergencia : null,
    };
  }

  private getMockFallbackResult(
    miniHypothesis: MiniDiaResult[],
    startTime: number,
  ): Gpt52FallbackResult {
    this.logger.warn('Using mock GPT-5.2 fallback result');
    return {
      dias: miniHypothesis.map((h) => ({
        dia: h.dia,
        entradaManha: { valor: h.entradaManha.valor, concordaMini: true, confidence: 0.95, divergencia: null },
        saidaManha: { valor: h.saidaManha.valor, concordaMini: true, confidence: 0.95, divergencia: null },
        entradaTarde: { valor: h.entradaTarde.valor, concordaMini: true, confidence: 0.95, divergencia: null },
        saidaTarde: { valor: h.saidaTarde.valor, concordaMini: true, confidence: 0.95, divergencia: null },
        entradaExtra: { valor: h.entradaExtra.valor, concordaMini: true, confidence: 0.95, divergencia: null },
        saidaExtra: { valor: h.saidaExtra.valor, concordaMini: true, confidence: 0.95, divergencia: null },
      })),
      gpt52Failed: false,
      tokensIn: 0,
      tokensOut: 0,
      latencyMs: Date.now() - startTime,
    };
  }

  /**
   * LEGACY: Validate OCR-extracted data against the original PDF using GPT vision.
   * Kept for future use but currently not called (GPT is now primary extractor).
   */
  async validate(
    pdfBuffer: Buffer,
    pageNumber: number,
    batidas: ScoredBatida[],
    header: {
      nomeExtraido?: string | null;
      empresaExtraida?: string | null;
      horarioContratual?: string | null;
      mesExtraido?: string | null;
    },
  ): Promise<GptValidationResult> {
    const startTime = Date.now();

    if (!this.client) {
      return this.getMockResult(batidas, startTime);
    }

    let pageImageBase64: string;
    try {
      const pngBuffer = await this.convertPageToPng(pdfBuffer, pageNumber);
      pageImageBase64 = pngBuffer.toString('base64');
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(
        `Failed to convert PDF page ${pageNumber} to PNG: ${message}`,
        undefined,
        { pageNumber },
      );
      return {
        dias: this.buildFallbackResult(batidas),
        gptFailed: true,
        tokensIn: 0,
        tokensOut: 0,
        latencyMs: Date.now() - startTime,
      };
    }

    const diData = batidas.map((b) => ({
      dia: b.dia,
      diaSemana: b.diaSemana,
      entradaManha: b.entradaManha,
      saidaManha: b.saidaManha,
      entradaTarde: b.entradaTarde,
      saidaTarde: b.saidaTarde,
      entradaExtra: b.entradaExtra,
      saidaExtra: b.saidaExtra,
    }));

    const prompt = this.buildValidationPrompt(diData, header, pageNumber);

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        const completion = await this.client.chat.completions.create({
          model: this.model,
          messages: [
            {
              role: 'system',
              content: `Você é um especialista em leitura de cartões de ponto brasileiros manuscritos e impressos. Sua tarefa é comparar os dados extraídos pelo OCR (Azure Document Intelligence) com a imagem real do documento PDF. Responda APENAS em JSON válido.`,
            },
            {
              role: 'user',
              content: [
                {
                  type: 'image_url',
                  image_url: {
                    url: `data:image/png;base64,${pageImageBase64}`,
                    detail: 'high',
                  },
                },
                {
                  type: 'text',
                  text: prompt,
                },
              ],
            },
          ],
          max_completion_tokens: 16000,
        });

        const latencyMs = Date.now() - startTime;
        const content = completion.choices[0]?.message?.content ?? '';
        const tokensIn = completion.usage?.prompt_tokens ?? 0;
        const tokensOut = completion.usage?.completion_tokens ?? 0;

        const parsed = this.parseGptResponse(content, batidas);

        this.logger.log('GPT Vision validation completed', {
          pageNumber,
          attempt: attempt + 1,
          tokensIn,
          tokensOut,
          latencyMs,
          diasProcessed: parsed.length,
          disagreements: this.countDisagreements(parsed),
        });

        return {
          dias: parsed,
          gptFailed: false,
          tokensIn,
          tokensOut,
          latencyMs,
        };
      } catch (error: unknown) {
        const message =
          error instanceof Error ? error.message : 'Unknown error';
        this.logger.warn(
          `GPT Vision attempt ${attempt + 1}/${MAX_RETRIES} failed: ${message}`,
          { pageNumber },
        );

        if (attempt < MAX_RETRIES - 1) {
          await this.sleep(RETRY_BACKOFFS[attempt]);
        }
      }
    }

    const latencyMs = Date.now() - startTime;
    this.logger.error(
      'GPT Vision validation failed after all retries — using DI values',
      undefined,
      { pageNumber, latencyMs },
    );

    return {
      dias: this.buildFallbackResult(batidas),
      gptFailed: true,
      tokensIn: 0,
      tokensOut: 0,
      latencyMs,
    };
  }

  /**
   * Merge GPT validation results back into scored batidas.
   * If GPT agrees with DI → boost confidence.
   * If GPT disagrees → use the value with higher confidence.
   */
  mergeResults(
    batidas: ScoredBatida[],
    gptResult: GptValidationResult,
  ): GptMergedBatida[] {
    const merged: GptMergedBatida[] = [];

    for (const batida of batidas) {
      const gptDia = gptResult.dias.find((d) => d.dia === batida.dia);

      if (!gptDia || gptResult.gptFailed) {
        merged.push({
          ...batida,
          gptFailed: gptResult.gptFailed,
        });
        continue;
      }

      const mergedBatida: GptMergedBatida = {
        ...batida,
        confianca: { ...batida.confianca },
        gptFailed: false,
        gptResult: gptDia,
      };

      for (const field of TIME_FIELDS) {
        const gptField = gptDia[field];
        if (!gptField) continue;

        const diConfidence = batida.confianca[field] ?? 0;

        if (gptField.concordaDi) {
          // GPT agrees — boost confidence
          mergedBatida.confianca[field] = Math.min(
            1,
            Math.max(diConfidence, gptField.confidence),
          );
        } else {
          // GPT disagrees — use higher confidence value
          if (gptField.confidence > diConfidence && gptField.valor) {
            (mergedBatida as unknown as Record<string, string | null>)[field] =
              gptField.valor;
            mergedBatida.confianca[field] = gptField.confidence;
          }
          // If DI confidence is higher, keep DI value (already there)
        }
      }

      // Recalculate needsReview
      const REVIEW_THRESHOLD = 0.80;
      mergedBatida.needsReview = Object.values(mergedBatida.confianca).some(
        (v) => v > 0 && v < REVIEW_THRESHOLD,
      );

      merged.push(mergedBatida);
    }

    return merged;
  }

  private buildExtractionPrompt(pageNumber: number): string {
    return `TAREFA:
Você está vendo a página ${pageNumber} de um cartão de ponto brasileiro.
Extraia TODOS os dados visíveis nesta imagem.

INSTRUÇÕES:
1. Primeiro, identifique o cabeçalho: nome do funcionário, empresa, mês/ano, horário contratual, cargo, CNPJ
2. Depois, para cada linha da tabela de registro de ponto, extraia:
   - Número do dia (1 a 31)
   - Dia da semana (se visível)
   - Entrada Manhã (primeiro horário de entrada)
   - Saída Manhã (primeiro horário de saída)
   - Entrada Tarde (segundo horário de entrada)
   - Saída Tarde (segundo horário de saída)
   - Entrada Extra (se houver)
   - Saída Extra (se houver)
3. Horários devem estar no formato HH:MM (ex: 07:25, 12:00, 18:05)
4. Se um campo está vazio ou sem registro, retorne null
5. Se um campo é ilegível, retorne sua melhor estimativa com confidence baixa (< 0.5)
6. Atribua confidence de 0.0 a 1.0 para cada campo baseado na legibilidade

ATENÇÃO ESPECIAL para dígitos manuscritos:
- Confusões comuns: 1↔7, 0↔8, 3↔8, 5↔6, 9↔4
- Preste atenção ao contexto (horários de trabalho geralmente entre 06:00 e 22:00)
- Domingos e feriados geralmente não têm registros

RESPONDA APENAS em JSON válido com esta estrutura:
{
  "header": {
    "nome": "Nome do Funcionário",
    "empresa": "Nome da Empresa",
    "mes": "03/2026",
    "cargo": "Cargo",
    "cnpj": "00.000.000/0000-00",
    "horarioContratual": "07:00 às 16:00"
  },
  "dias": [
    {
      "dia": 1,
      "diaSemana": "Seg",
      "entradaManha": { "valor": "07:25", "confidence": 0.95 },
      "saidaManha": { "valor": "12:00", "confidence": 0.85 },
      "entradaTarde": { "valor": "13:00", "confidence": 0.90 },
      "saidaTarde": { "valor": "18:05", "confidence": 0.95 },
      "entradaExtra": { "valor": null, "confidence": 1.0 },
      "saidaExtra": { "valor": null, "confidence": 1.0 }
    }
  ]
}`;
  }

  /**
   * Parse GPT extraction response (primary extraction mode — no concordaDi).
   */
  private parseExtractionResponse(content: string): GptDiaResult[] {
    try {
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('No JSON found in GPT extraction response');
      }

      const parsed = JSON.parse(jsonMatch[0]) as {
        header?: Record<string, unknown>;
        dias?: unknown[];
      };

      // Store extracted header for later use
      if (parsed.header) {
        this._lastExtractedHeader = parsed.header;
      }

      if (!Array.isArray(parsed.dias)) {
        throw new Error('Response missing "dias" array');
      }

      return parsed.dias.map((dia: unknown) => {
        const d = dia as Record<string, unknown>;
        const diaNum = typeof d.dia === 'number' ? d.dia : 0;

        const parseField = (field: unknown): GptFieldResult => {
          if (!field || typeof field !== 'object') {
            return { valor: null, concordaDi: true, confidence: 0.5 };
          }
          const f = field as Record<string, unknown>;
          return {
            valor: f.valor === null || f.valor === undefined ? null : String(f.valor),
            concordaDi: true, // No DI to compare against — always "agrees"
            confidence: typeof f.confidence === 'number' ? f.confidence : 0.5,
          };
        };

        return {
          dia: diaNum,
          entradaManha: parseField(d.entradaManha),
          saidaManha: parseField(d.saidaManha),
          entradaTarde: parseField(d.entradaTarde),
          saidaTarde: parseField(d.saidaTarde),
          entradaExtra: parseField(d.entradaExtra),
          saidaExtra: parseField(d.saidaExtra),
        };
      });
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : 'Unknown error';
      this.logger.warn(`Failed to parse GPT extraction response: ${message}`);
      return [];
    }
  }

  /** Stores the header extracted by GPT in the last extraction call */
  private _lastExtractedHeader: Record<string, unknown> | null = null;

  /** Get the header extracted by GPT in the last `extract()` call */
  getLastExtractedHeader(): {
    nomeExtraido: string | null;
    empresaExtraida: string | null;
    mesExtraido: string | null;
    cargoExtraido: string | null;
    cnpjExtraido: string | null;
    horarioContratual: string | null;
  } {
    const h = this._lastExtractedHeader;
    if (!h) {
      return {
        nomeExtraido: null,
        empresaExtraida: null,
        mesExtraido: null,
        cargoExtraido: null,
        cnpjExtraido: null,
        horarioContratual: null,
      };
    }
    return {
      nomeExtraido: h.nome ? String(h.nome) : null,
      empresaExtraida: h.empresa ? String(h.empresa) : null,
      mesExtraido: h.mes ? String(h.mes) : null,
      cargoExtraido: h.cargo ? String(h.cargo) : null,
      cnpjExtraido: h.cnpj ? String(h.cnpj).replace(/[.\/-]/g, '') : null,
      horarioContratual: h.horarioContratual ? String(h.horarioContratual) : null,
    };
  }

  /**
   * Convert GPT extraction results into ScoredBatida format
   * for compatibility with the rest of the pipeline.
   */
  toScoredBatidas(gptResult: GptValidationResult): ScoredBatida[] {
    return gptResult.dias.map((dia) => {
      const confianca: Record<string, number> = {};
      const values: Record<string, string | null> = {};

      for (const field of TIME_FIELDS) {
        const gptField = dia[field];
        confianca[field] = gptField?.confidence ?? 0;
        values[field] = gptField?.valor ?? null;
      }

      const allConf = Object.values(confianca).filter((v) => v > 0);
      const avgConf = allConf.length > 0
        ? allConf.reduce((a, b) => a + b, 0) / allConf.length
        : 0;

      return {
        dia: dia.dia,
        diaSemana: null,
        entradaManha: values.entradaManha,
        saidaManha: values.saidaManha,
        entradaTarde: values.entradaTarde,
        saidaTarde: values.saidaTarde,
        entradaExtra: values.entradaExtra,
        saidaExtra: values.saidaExtra,
        confianca,
        isManuscrito: avgConf < 0.75,
        isInconsistente: false,
        isFaltaDia: !values.entradaManha && !values.saidaManha && !values.entradaTarde && !values.saidaTarde,
        needsReview: avgConf < 0.80,
        confidences: confianca,
      };
    });
  }

  private getMockExtractResult(startTime: number): GptValidationResult {
    this.logger.warn('Using mock GPT Vision extraction result');
    // Generate mock data for days 1-31
    const dias: GptDiaResult[] = [];
    for (let day = 1; day <= 31; day++) {
      const isWeekend = day % 7 === 0 || day % 7 === 1;
      dias.push({
        dia: day,
        entradaManha: {
          valor: isWeekend ? null : '07:00',
          concordaDi: true,
          confidence: 0.90,
        },
        saidaManha: {
          valor: isWeekend ? null : '12:00',
          concordaDi: true,
          confidence: 0.90,
        },
        entradaTarde: {
          valor: isWeekend ? null : '13:00',
          concordaDi: true,
          confidence: 0.90,
        },
        saidaTarde: {
          valor: isWeekend ? null : '18:00',
          concordaDi: true,
          confidence: 0.90,
        },
        entradaExtra: { valor: null, concordaDi: true, confidence: 1.0 },
        saidaExtra: { valor: null, concordaDi: true, confidence: 1.0 },
      });
    }
    this._lastExtractedHeader = {
      nome: 'Mock Funcionário',
      empresa: 'Mock Empresa',
      mes: '03/2026',
      cargo: 'Operador',
      cnpj: null,
      horarioContratual: '07:00 às 16:00',
    };
    return {
      dias,
      gptFailed: false,
      tokensIn: 0,
      tokensOut: 0,
      latencyMs: Date.now() - startTime,
    };
  }

  private buildValidationPrompt(
    diData: Record<string, unknown>[],
    header: Record<string, string | null | undefined>,
    pageNumber: number,
  ): string {
    return `CONTEXTO:
Página ${pageNumber} de um cartão de ponto brasileiro.
- Funcionário: ${header.nomeExtraido ?? 'Desconhecido'}
- Empresa: ${header.empresaExtraida ?? 'Desconhecida'}
- Mês/Ano: ${header.mesExtraido ?? 'Desconhecido'}
- Horário contratual: ${header.horarioContratual ?? 'Não informado'}

DADOS EXTRAÍDOS PELO OCR (Azure Document Intelligence):
${JSON.stringify(diData, null, 2)}

TAREFA:
Compare CUIDADOSAMENTE a imagem do cartão de ponto com os dados JSON acima.
Para cada dia e cada campo de horário (entradaManha, saidaManha, entradaTarde, saidaTarde, entradaExtra, saidaExtra):
1. Leia o valor real escrito/impresso no cartão
2. Compare com o valor do JSON
3. Se concorda: concordaDi = true, valor = mesmo do JSON
4. Se discorda: concordaDi = false, valor = o que VOCÊ leu na imagem
5. Atribua confidence de 0.0 a 1.0 baseado em quão legível está o valor

ATENÇÃO ESPECIAL:
- Dígitos manuscritos são frequentemente confundidos: 1↔7, 0↔8, 3↔8, 5↔6, 9↔4
- Se o campo está vazio no cartão, retorne valor: null
- Se o campo é ilegível, retorne valor com confidence baixa (< 0.5)

RESPONDA APENAS em JSON válido com esta estrutura:
{
  "dias": [
    {
      "dia": 1,
      "entradaManha": { "valor": "07:25", "concordaDi": true, "confidence": 0.95 },
      "saidaManha": { "valor": "12:00", "concordaDi": false, "confidence": 0.85 },
      "entradaTarde": { "valor": "13:00", "concordaDi": true, "confidence": 0.90 },
      "saidaTarde": { "valor": "18:05", "concordaDi": true, "confidence": 0.95 },
      "entradaExtra": { "valor": null, "concordaDi": true, "confidence": 1.0 },
      "saidaExtra": { "valor": null, "concordaDi": true, "confidence": 1.0 }
    }
  ]
}`;
  }

  private parseGptResponse(
    content: string,
    batidas: ScoredBatida[],
  ): GptDiaResult[] {
    try {
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('No JSON found in GPT response');
      }

      const parsed = JSON.parse(jsonMatch[0]) as {
        dias?: unknown[];
      };

      if (!Array.isArray(parsed.dias)) {
        throw new Error('Response missing "dias" array');
      }

      return parsed.dias.map((dia: unknown) => {
        const d = dia as Record<string, unknown>;
        const diaNum = typeof d.dia === 'number' ? d.dia : 0;

        const result: GptDiaResult = {
          dia: diaNum,
          entradaManha: this.parseFieldResult(d.entradaManha),
          saidaManha: this.parseFieldResult(d.saidaManha),
          entradaTarde: this.parseFieldResult(d.entradaTarde),
          saidaTarde: this.parseFieldResult(d.saidaTarde),
          entradaExtra: this.parseFieldResult(d.entradaExtra),
          saidaExtra: this.parseFieldResult(d.saidaExtra),
        };

        return result;
      });
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : 'Unknown error';
      this.logger.warn(`Failed to parse GPT response: ${message}`);
      return this.buildFallbackResult(batidas);
    }
  }

  private parseFieldResult(field: unknown): GptFieldResult {
    if (!field || typeof field !== 'object') {
      return { valor: null, concordaDi: true, confidence: 0.5 };
    }

    const f = field as Record<string, unknown>;
    return {
      valor: f.valor === null || f.valor === undefined ? null : String(f.valor),
      concordaDi: typeof f.concordaDi === 'boolean' ? f.concordaDi : true,
      confidence: typeof f.confidence === 'number' ? f.confidence : 0.5,
    };
  }

  private buildFallbackResult(batidas: ScoredBatida[]): GptDiaResult[] {
    return batidas.map((b) => ({
      dia: b.dia,
      entradaManha: {
        valor: b.entradaManha,
        concordaDi: true,
        confidence: 0.5,
      },
      saidaManha: { valor: b.saidaManha, concordaDi: true, confidence: 0.5 },
      entradaTarde: {
        valor: b.entradaTarde,
        concordaDi: true,
        confidence: 0.5,
      },
      saidaTarde: { valor: b.saidaTarde, concordaDi: true, confidence: 0.5 },
      entradaExtra: {
        valor: b.entradaExtra,
        concordaDi: true,
        confidence: 0.5,
      },
      saidaExtra: { valor: b.saidaExtra, concordaDi: true, confidence: 0.5 },
    }));
  }

  private getMockResult(
    batidas: ScoredBatida[],
    startTime: number,
  ): GptValidationResult {
    this.logger.warn('Using mock GPT Vision result');
    return {
      dias: batidas.map((b) => ({
        dia: b.dia,
        entradaManha: {
          valor: b.entradaManha,
          concordaDi: true,
          confidence: 0.90,
        },
        saidaManha: {
          valor: b.saidaManha,
          concordaDi: true,
          confidence: 0.90,
        },
        entradaTarde: {
          valor: b.entradaTarde,
          concordaDi: true,
          confidence: 0.90,
        },
        saidaTarde: {
          valor: b.saidaTarde,
          concordaDi: true,
          confidence: 0.90,
        },
        entradaExtra: {
          valor: b.entradaExtra,
          concordaDi: true,
          confidence: 0.90,
        },
        saidaExtra: {
          valor: b.saidaExtra,
          concordaDi: true,
          confidence: 0.90,
        },
      })),
      gptFailed: false,
      tokensIn: 0,
      tokensOut: 0,
      latencyMs: Date.now() - startTime,
    };
  }

  private countDisagreements(dias: GptDiaResult[]): number {
    let count = 0;
    for (const dia of dias) {
      for (const field of TIME_FIELDS) {
        if (!dia[field].concordaDi) count++;
      }
    }
    return count;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
