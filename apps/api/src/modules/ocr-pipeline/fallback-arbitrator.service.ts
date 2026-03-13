import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import { RateLimiterService } from './rate-limiter.service';
import {
  CampoDivergente,
  ArbitroResult,
  ResolucaoArbitro,
} from './ocr-pipeline.types';

const MAX_RETRIES = 3;
const RETRY_BACKOFFS = [1000, 2000, 4000];
const REQUEST_TIMEOUT = 90000;

/**
 * Arbitro GPT-5.2 Vision — chamado APENAS para campos divergentes.
 *
 * Usa prompt anti-ancoragem: apresenta os valores como "hipoteses a verificar",
 * SEM dizer qual sistema escolheu qual valor.
 */
@Injectable()
export class FallbackArbitratorService {
  private readonly logger = new Logger(FallbackArbitratorService.name);
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
      this.logger.log('Fallback Arbitrator (GPT-5.2) initialized', {
        deployment: this.model,
      });
    } else {
      this.logger.warn(
        'Azure OpenAI not configured — Fallback Arbitrator using mock mode',
      );
    }
  }

  /**
   * Chama o GPT-5.2 Vision para resolver campos divergentes.
   *
   * @param imagemBase64 - PNG da pagina completa
   * @param camposDivergentes - Campos onde os 3 extratores divergiram
   */
  async arbitrar(
    imagemBase64: string,
    camposDivergentes: CampoDivergente[],
  ): Promise<ArbitroResult> {
    const startTime = Date.now();

    if (!this.client) {
      return this.getMockResult(camposDivergentes, startTime);
    }

    if (camposDivergentes.length === 0) {
      return {
        resolucoes: [],
        gpt52Failed: false,
        tokensIn: 0,
        tokensOut: 0,
        latencyMs: 0,
      };
    }

    const diasAgrupados = this.agruparPorDia(camposDivergentes);
    const prompt = this.buildPrompt(diasAgrupados);

    await this.rateLimiter.acquire('gpt52');

    try {
      for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
        try {
          const completion = await this.client.chat.completions.create({
            model: this.model,
            messages: [
              {
                role: 'system',
                content: `Voce e um validador especializado em cartoes de ponto brasileiros. Analise a imagem do cartao de ponto e resolva as divergencias. NAO confie nos valores sugeridos — verifique cada um na imagem. Responda APENAS em JSON valido.`,
              },
              {
                role: 'user',
                content: [
                  {
                    type: 'image_url',
                    image_url: {
                      url: `data:image/png;base64,${imagemBase64}`,
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
            max_completion_tokens: 8000,
          });

          const latencyMs = Date.now() - startTime;
          const content = completion.choices[0]?.message?.content ?? '';
          const tokensIn = completion.usage?.prompt_tokens ?? 0;
          const tokensOut = completion.usage?.completion_tokens ?? 0;

          const resolucoes = this.parseResponse(content);

          this.logger.log('Fallback arbitration completed', {
            attempt: attempt + 1,
            divergencias: camposDivergentes.length,
            resolucoes: resolucoes.length,
            tokensIn,
            tokensOut,
            latencyMs,
          });

          return {
            resolucoes,
            gpt52Failed: false,
            tokensIn,
            tokensOut,
            latencyMs,
          };
        } catch (error: unknown) {
          const message =
            error instanceof Error ? error.message : 'Unknown error';
          this.logger.warn(
            `Fallback arbitration attempt ${attempt + 1}/${MAX_RETRIES} failed: ${message}`,
          );

          if (attempt < MAX_RETRIES - 1) {
            await this.sleep(RETRY_BACKOFFS[attempt]);
          }
        }
      }

      const latencyMs = Date.now() - startTime;
      this.logger.error(
        'Fallback arbitration failed after all retries',
      );

      return {
        resolucoes: [],
        gpt52Failed: true,
        tokensIn: 0,
        tokensOut: 0,
        latencyMs,
      };
    } finally {
      this.rateLimiter.release('gpt52');
    }
  }

  private agruparPorDia(
    campos: CampoDivergente[],
  ): Map<number, CampoDivergente[]> {
    const map = new Map<number, CampoDivergente[]>();
    for (const campo of campos) {
      const existing = map.get(campo.dia) ?? [];
      existing.push(campo);
      map.set(campo.dia, existing);
    }
    return map;
  }

  private buildPrompt(
    diasAgrupados: Map<number, CampoDivergente[]>,
  ): string {
    const linhas: string[] = [];

    for (const [dia, campos] of diasAgrupados) {
      linhas.push(`\nDia ${dia}:`);
      for (const campo of campos) {
        // ANTI-ANCORAGEM: apresenta como "hipoteses", sem indicar qual sistema gerou qual
        const valores = [campo.valorA, campo.valorB, campo.valorC]
          .filter((v) => v !== null)
          .map((v) => `"${v}"`)
          .join(', ');
        const temNull = [campo.valorA, campo.valorB, campo.valorC].some(
          (v) => v === null,
        );
        const valoresStr = temNull ? `${valores}, null` : valores;

        linhas.push(
          `  ${campo.campo}: hipoteses = [${valoresStr}]`,
        );
      }
    }

    return `Analise a imagem do cartao de ponto e resolva as seguintes divergencias.

Tres sistemas de extracao retornaram valores diferentes para os campos abaixo.
Olhe a imagem e determine o valor CORRETO baseado no que voce ve.

IMPORTANTE:
- NAO confie nos valores sugeridos. Verifique cada um na imagem.
- Trate cada valor como HIPOTESE, nao como fato.
- Se nao conseguir ler o campo na imagem, retorne null.
- Horarios no formato HH:MM.

Divergencias a resolver:
${linhas.join('\n')}

Retorne um JSON:
{
  "resolucoes": [
    { "dia": 6, "campo": "saidaManha", "valorCorreto": "11:49", "confianca": 0.95 }
  ]
}`;
  }

  private parseResponse(content: string): ResolucaoArbitro[] {
    try {
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('No JSON found in arbitrator response');
      }

      const parsed = JSON.parse(jsonMatch[0]) as {
        resolucoes?: unknown[];
      };

      if (!Array.isArray(parsed.resolucoes)) {
        throw new Error('Response missing "resolucoes" array');
      }

      return parsed.resolucoes.map((r: unknown) => {
        const res = r as Record<string, unknown>;
        return {
          dia: typeof res.dia === 'number' ? res.dia : 0,
          campo: typeof res.campo === 'string' ? res.campo : '',
          valorCorreto:
            res.valorCorreto === null || res.valorCorreto === undefined
              ? null
              : String(res.valorCorreto),
          confianca:
            typeof res.confianca === 'number' ? res.confianca : 0.5,
        };
      });
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : 'Unknown error';
      this.logger.warn(`Failed to parse arbitrator response: ${message}`);
      return [];
    }
  }

  private getMockResult(
    camposDivergentes: CampoDivergente[],
    startTime: number,
  ): ArbitroResult {
    this.logger.warn('Using mock Fallback Arbitrator result');
    return {
      resolucoes: camposDivergentes.map((c) => ({
        dia: c.dia,
        campo: c.campo,
        valorCorreto: c.valorA ?? c.valorB ?? c.valorC,
        confianca: 0.85,
      })),
      gpt52Failed: false,
      tokensIn: 0,
      tokensOut: 0,
      latencyMs: Date.now() - startTime,
    };
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
