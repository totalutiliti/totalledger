import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import { ScoredBatida } from './confidence-scorer.service';
import { RateLimiterService } from './rate-limiter.service';
import {
  MiniExtractionResult,
  MiniDiaResult,
  MiniFieldResult,
  ExtractedHeader,
  TIME_FIELDS,
} from './ocr-pipeline.types';

const MAX_RETRIES = 3;
const RETRY_BACKOFFS = [1000, 2000, 4000];
const REQUEST_TIMEOUT = 180000;

/**
 * GPT-5 Mini Vision — Extrator primario do pipeline.
 *
 * Recebe a imagem PNG da pagina (2x scale) e opcionalmente o texto
 * estruturado do Azure DI como contexto auxiliar. Organiza os dados
 * nos 6 campos de horario + cabecalho.
 *
 * Custo: ~$0.0095/pagina (6x mais barato que GPT-5.2)
 */
@Injectable()
export class GptMiniExtractorService {
  private readonly logger = new Logger(GptMiniExtractorService.name);
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
      'AZURE_OPENAI_MINI_DEPLOYMENT',
      'gpt-5-mini',
    );

    if (endpoint && key) {
      this.client = new OpenAI({
        apiKey: key,
        baseURL: `${endpoint}/openai/deployments/${this.model}`,
        defaultQuery: { 'api-version': apiVersion },
        defaultHeaders: { 'api-key': key },
        timeout: REQUEST_TIMEOUT,
      });
      this.logger.log('GPT-5 Mini Extractor initialized', {
        deployment: this.model,
        apiVersion,
      });
    } else {
      this.logger.warn(
        'Azure OpenAI not configured — GPT-5 Mini Extractor using mock mode',
      );
    }
  }

  /**
   * Extrai horarios e cabecalho de uma pagina de cartao de ponto.
   *
   * @param pageImageBuffer - Buffer PNG da pagina (ja convertida de PDF)
   * @param pageNumber - Numero da pagina no PDF
   * @param diTextContent - Texto estruturado do Azure DI (opcional, contexto auxiliar)
   */
  async extract(
    pageImageBuffer: Buffer,
    pageNumber: number,
    diTextContent?: string | null,
  ): Promise<MiniExtractionResult> {
    const startTime = Date.now();

    if (!this.client) {
      return this.getMockResult(startTime);
    }

    const pageImageBase64 = pageImageBuffer.toString('base64');
    const prompt = this.buildExtractionPrompt(pageNumber, diTextContent ?? null);

    await this.rateLimiter.acquire('mini');

    try {
      for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
        try {
          const completion = await this.client.chat.completions.create({
            model: this.model,
            messages: [
              {
                role: 'system',
                content: `Voce e um especialista em leitura de cartoes de ponto brasileiros manuscritos e impressos. Sua tarefa e extrair TODOS os horarios registrados na imagem do cartao de ponto. Responda APENAS em JSON valido.`,
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

          const parsed = this.parseResponse(content);

          this.logger.log('GPT-5 Mini extraction completed', {
            pageNumber,
            attempt: attempt + 1,
            tokensIn,
            tokensOut,
            latencyMs,
            diasExtracted: parsed.dias.length,
          });

          return {
            header: parsed.header,
            dias: parsed.dias,
            miniFailed: false,
            tokensIn,
            tokensOut,
            latencyMs,
          };
        } catch (error: unknown) {
          const message =
            error instanceof Error ? error.message : 'Unknown error';
          this.logger.warn(
            `GPT-5 Mini extraction attempt ${attempt + 1}/${MAX_RETRIES} failed: ${message}`,
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
        'GPT-5 Mini extraction failed after all retries',
        undefined,
        { pageNumber, latencyMs },
      );

      return {
        header: this.emptyHeader(),
        dias: [],
        miniFailed: true,
        tokensIn: 0,
        tokensOut: 0,
        latencyMs,
      };
    } finally {
      this.rateLimiter.release('mini');
    }
  }

  /**
   * Converte resultado do Mini para ScoredBatida[] (formato do pipeline).
   */
  toScoredBatidas(result: MiniExtractionResult): ScoredBatida[] {
    return result.dias.map((dia) => {
      const confianca: Record<string, number> = {};
      const values: Record<string, string | null> = {};

      for (const field of TIME_FIELDS) {
        const miniField: MiniFieldResult = dia[field];
        confianca[field] = miniField.confidence;
        values[field] = miniField.valor;
      }

      const allConf = Object.values(confianca).filter((v) => v > 0);
      const avgConf =
        allConf.length > 0
          ? allConf.reduce((a, b) => a + b, 0) / allConf.length
          : 0;

      return {
        dia: dia.dia,
        diaSemana: dia.diaSemana,
        entradaManha: values.entradaManha ?? null,
        saidaManha: values.saidaManha ?? null,
        entradaTarde: values.entradaTarde ?? null,
        saidaTarde: values.saidaTarde ?? null,
        entradaExtra: values.entradaExtra ?? null,
        saidaExtra: values.saidaExtra ?? null,
        confianca,
        isManuscrito: avgConf < 0.75,
        isInconsistente: false,
        isFaltaDia:
          !values.entradaManha &&
          !values.saidaManha &&
          !values.entradaTarde &&
          !values.saidaTarde,
        needsReview: avgConf > 0 && avgConf < 0.80,
      };
    });
  }

  // ──────────────────────────────────────────────
  // Prompt
  // ──────────────────────────────────────────────

  private buildExtractionPrompt(
    pageNumber: number,
    diTextContent: string | null,
  ): string {
    const diContext = diTextContent
      ? `\nREFERENCIA OCR (texto extraido por outro sistema — use como referencia para validar sua leitura visual, mas confie na imagem em caso de divergencia):\n${diTextContent}\n`
      : '';

    return `TAREFA:
Voce esta vendo a pagina ${pageNumber} de um cartao de ponto brasileiro.
Extraia TODOS os dados visiveis nesta imagem.
${diContext}
INSTRUCOES:
1. Primeiro, identifique o cabecalho: nome do funcionario, empresa, mes/ano, horario contratual, cargo, CNPJ
2. Depois, para cada linha da tabela de registro de ponto, extraia:
   - Numero do dia (1 a 31)
   - Dia da semana (se visivel)
   - Entrada Manha (primeiro horario de entrada)
   - Saida Manha (primeiro horario de saida)
   - Entrada Tarde (segundo horario de entrada)
   - Saida Tarde (segundo horario de saida)
   - Entrada Extra (se houver)
   - Saida Extra (se houver)
3. Horarios devem estar no formato HH:MM (ex: 07:25, 12:00, 18:05)
4. Se um campo esta vazio ou sem registro, retorne null
5. Se um campo e ilegivel, retorne sua melhor estimativa com confidence baixa (< 0.5)
6. Atribua confidence de 0.0 a 1.0 para cada campo baseado na legibilidade

ATENCAO ESPECIAL para digitos manuscritos:
- Confusoes comuns: 1<->7, 0<->8, 3<->8, 5<->6, 9<->4
- Preste atencao ao contexto (horarios de trabalho geralmente entre 06:00 e 22:00)
- Domingos e feriados geralmente nao tem registros

RESPONDA APENAS em JSON valido com esta estrutura:
{
  "header": {
    "nome": "Nome do Funcionario",
    "empresa": "Nome da Empresa",
    "mes": "03/2026",
    "cargo": "Cargo",
    "cnpj": "00.000.000/0000-00",
    "horarioContratual": "07:00 as 16:00"
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

  // ──────────────────────────────────────────────
  // Response parsing
  // ──────────────────────────────────────────────

  private parseResponse(content: string): {
    header: ExtractedHeader;
    dias: MiniDiaResult[];
  } {
    try {
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('No JSON found in GPT-5 Mini response');
      }

      const parsed = JSON.parse(jsonMatch[0]) as {
        header?: Record<string, unknown>;
        dias?: unknown[];
      };

      const header = this.parseHeader(parsed.header ?? {});

      if (!Array.isArray(parsed.dias)) {
        throw new Error('Response missing "dias" array');
      }

      const dias = parsed.dias.map((dia: unknown) => {
        const d = dia as Record<string, unknown>;
        const diaNum = typeof d.dia === 'number' ? d.dia : 0;
        const diaSemana =
          typeof d.diaSemana === 'string' ? d.diaSemana : null;

        return {
          dia: diaNum,
          diaSemana,
          entradaManha: this.parseField(d.entradaManha),
          saidaManha: this.parseField(d.saidaManha),
          entradaTarde: this.parseField(d.entradaTarde),
          saidaTarde: this.parseField(d.saidaTarde),
          entradaExtra: this.parseField(d.entradaExtra),
          saidaExtra: this.parseField(d.saidaExtra),
        };
      });

      return { header, dias };
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : 'Unknown error';
      this.logger.warn(`Failed to parse GPT-5 Mini response: ${message}`);
      return { header: this.emptyHeader(), dias: [] };
    }
  }

  private parseField(field: unknown): MiniFieldResult {
    if (!field || typeof field !== 'object') {
      return { valor: null, confidence: 0.5 };
    }
    const f = field as Record<string, unknown>;
    return {
      valor:
        f.valor === null || f.valor === undefined ? null : String(f.valor),
      confidence: typeof f.confidence === 'number' ? f.confidence : 0.5,
    };
  }

  private parseHeader(h: Record<string, unknown>): ExtractedHeader {
    return {
      nomeExtraido: h.nome ? String(h.nome) : null,
      empresaExtraida: h.empresa ? String(h.empresa) : null,
      mesExtraido: h.mes ? String(h.mes) : null,
      cargoExtraido: h.cargo ? String(h.cargo) : null,
      cnpjExtraido: h.cnpj
        ? String(h.cnpj).replace(/[.\/-]/g, '')
        : null,
      horarioContratual: h.horarioContratual
        ? String(h.horarioContratual)
        : null,
    };
  }

  private emptyHeader(): ExtractedHeader {
    return {
      nomeExtraido: null,
      empresaExtraida: null,
      mesExtraido: null,
      cargoExtraido: null,
      cnpjExtraido: null,
      horarioContratual: null,
    };
  }

  // ──────────────────────────────────────────────
  // Mock
  // ──────────────────────────────────────────────

  private getMockResult(startTime: number): MiniExtractionResult {
    this.logger.warn('Using mock GPT-5 Mini extraction result');

    const dias: MiniDiaResult[] = [];
    for (let day = 1; day <= 31; day++) {
      const isWeekend = day % 7 === 0 || day % 7 === 1;
      dias.push({
        dia: day,
        diaSemana: null,
        entradaManha: { valor: isWeekend ? null : '07:00', confidence: 0.92 },
        saidaManha: { valor: isWeekend ? null : '12:00', confidence: 0.92 },
        entradaTarde: { valor: isWeekend ? null : '13:00', confidence: 0.92 },
        saidaTarde: { valor: isWeekend ? null : '18:00', confidence: 0.92 },
        entradaExtra: { valor: null, confidence: 1.0 },
        saidaExtra: { valor: null, confidence: 1.0 },
      });
    }

    return {
      header: {
        nomeExtraido: 'Mock Funcionario',
        empresaExtraida: 'Mock Empresa',
        mesExtraido: '03/2026',
        cargoExtraido: 'Operador',
        cnpjExtraido: null,
        horarioContratual: '07:00 as 16:00',
      },
      dias,
      miniFailed: false,
      tokensIn: 0,
      tokensOut: 0,
      latencyMs: Date.now() - startTime,
    };
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
