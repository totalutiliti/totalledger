import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import { RateLimiterService } from './rate-limiter.service';
import {
  ExtracaoEstruturada,
  DiaExtracao,
  CabecalhoExtracao,
} from './ocr-pipeline.types';

const MAX_RETRIES = 3;
const RETRY_BACKOFFS = [2000, 4000, 8000];
const REQUEST_TIMEOUT = 180000;

/**
 * Extrator direto via GPT-5.2 — recebe tabela limpa do DI + imagem da pagina.
 *
 * Estrategia: o DI Layout ja fornece a estrutura tabular com erros pontuais de OCR.
 * O GPT-5.2 recebe os dois inputs (tabela estruturada + imagem) e cruza as fontes
 * para corrigir erros e produzir a extracao final.
 *
 * Beneficios vs 3x Mini + votacao:
 * - 1 chamada vs 4+ chamadas
 * - ~95% acuracia vs ~70-80%
 * - ~40s vs ~3min
 * - Mais simples (sem votacao/divergencia/fallback)
 */
@Injectable()
export class Gpt52DirectExtractorService {
  private readonly logger = new Logger(Gpt52DirectExtractorService.name);
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
      this.logger.log('GPT-5.2 Direct Extractor initialized', {
        deployment: this.model,
      });
    } else {
      this.logger.warn(
        'Azure OpenAI not configured — GPT-5.2 Direct Extractor using mock mode',
      );
    }
  }

  /**
   * Extrai dados do cartao de ponto usando DI table + imagem via GPT-5.2.
   *
   * @param imagemBase64 - PNG da pagina em base64
   * @param diCleanTable - Tabela limpa extraida do DI Layout (texto formatado)
   * @param tipoCartao - 'mensal' ou 'quinzenal' para contexto do prompt
   */
  async extrair(
    imagemBase64: string,
    diCleanTable: string,
    tipoCartao: 'mensal' | 'quinzenal' = 'mensal',
    pageContext?: 'frente' | 'verso',
  ): Promise<ExtracaoEstruturada> {
    const startTime = Date.now();

    if (!this.client) {
      return this.getMockResult(tipoCartao);
    }

    const prompt = this.buildPrompt(diCleanTable, tipoCartao, pageContext);

    await this.rateLimiter.acquire('gpt52');

    try {
      for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
        try {
          const completion = await this.client.chat.completions.create({
            model: this.model,
            messages: [
              {
                role: 'system',
                content: this.getSystemPrompt(),
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
            max_completion_tokens: 16000,
          });

          const latencyMs = Date.now() - startTime;
          const content = completion.choices[0]?.message?.content ?? '';
          const finishReason = completion.choices[0]?.finish_reason ?? 'unknown';
          const tokensIn = completion.usage?.prompt_tokens ?? 0;
          const tokensOut = completion.usage?.completion_tokens ?? 0;

          if (!content || content.trim().length === 0) {
            this.logger.warn(
              `GPT-5.2 Direct attempt ${attempt + 1}/${MAX_RETRIES}: empty response`,
              { finishReason, tokensIn, tokensOut },
            );

            if (attempt < MAX_RETRIES - 1) {
              await this.sleep(RETRY_BACKOFFS[attempt]);
              continue;
            }
            throw new Error('GPT-5.2 returned empty content after all retries');
          }

          const result = this.parseResponse(content, tipoCartao);

          // Attach token usage to result for metrics tracking
          result.tokensIn = tokensIn;
          result.tokensOut = tokensOut;
          result.latencyMs = latencyMs;

          this.logger.log('GPT-5.2 Direct extraction completed', {
            attempt: attempt + 1,
            dias: result.dias.length,
            confianca: result.confianca,
            finishReason,
            tokensIn,
            tokensOut,
            latencyMs,
          });

          return result;
        } catch (error: unknown) {
          const message =
            error instanceof Error ? error.message : 'Unknown error';
          this.logger.warn(
            `GPT-5.2 Direct attempt ${attempt + 1}/${MAX_RETRIES} failed: ${message}`,
          );

          if (attempt < MAX_RETRIES - 1) {
            await this.sleep(RETRY_BACKOFFS[attempt]);
          }
        }
      }

      throw new Error('GPT-5.2 Direct extraction failed after all retries');
    } finally {
      this.rateLimiter.release('gpt52');
    }
  }

  private getSystemPrompt(): string {
    return `Voce e um especialista em leitura de cartoes de ponto brasileiros.
Voce recebera DUAS fontes de informacao:
1. Uma IMAGEM do cartao de ponto (fonte visual primaria)
2. Uma TABELA extraida por OCR automatico (pode conter erros de leitura)

Sua tarefa:
- CRUZE as duas fontes: use a tabela OCR como guia da estrutura, mas VALIDE cada valor olhando a imagem.
- Se a tabela OCR mostra um valor estranho (ex: "77:33", "73:05", "19:02"), OLHE A IMAGEM e corrija.
- Se um campo esta vazio na tabela mas tem valor na imagem, INCLUA o valor.
- Se nao conseguir ler um campo nem na tabela nem na imagem, use null.
- Horarios SEMPRE no formato HH:MM (24h).
- Responda APENAS com JSON valido, sem markdown, sem explicacoes.`;
  }

  private buildPrompt(
    diCleanTable: string,
    tipoCartao: string,
    pageContext?: 'frente' | 'verso',
  ): string {
    let pageHint = '';
    if (tipoCartao === 'quinzenal' && pageContext === 'verso') {
      pageHint = `
IMPORTANTE — VERSO DO CARTAO QUINZENAL:
Esta pagina e a SEGUNDA METADE (verso) de um cartao quinzenal.
Os dias desta pagina devem ser numerados de 16 a 31 (segunda quinzena do mes).
Se a tabela OCR ou a imagem mostram numeros de dia menores (ex: 1, 2, 3...), RENUMERE para 16, 17, 18... pois sao os dias reais do mes.
Se a tabela ja mostra dias 16-31, mantenha como esta.`;
    } else if (tipoCartao === 'quinzenal' && pageContext === 'frente') {
      pageHint = `
IMPORTANTE — FRENTE DO CARTAO QUINZENAL:
Esta pagina e a PRIMEIRA METADE (frente) de um cartao quinzenal.
Os dias desta pagina devem ser numerados de 1 a 15 (primeira quinzena do mes).`;
    }

    return `Analise este cartao de ponto ${tipoCartao} brasileiro.${pageHint}

TABELA OCR (extraida automaticamente — pode conter erros):
${diCleanTable}

INSTRUCOES:
1. Olhe a imagem do cartao de ponto.
2. Use a tabela acima como REFERENCIA, mas NAO confie cegamente nos valores.
3. Para cada dia, verifique visualmente: entrada manha, saida manha, entrada tarde, saida tarde, entrada extra, saida extra.
4. Corrija erros de OCR (ex: "77:33" provavelmente e "11:33", "73:05" provavelmente e "13:05").
5. Extraia tambem o cabecalho: nome, empresa, CNPJ, cargo, mes, horario contratual.${tipoCartao === 'quinzenal' && pageContext === 'verso' ? '\n6. RENUMERE os dias para a faixa 16-31 se necessario (esta e a segunda quinzena).' : ''}

Retorne JSON no formato:
{
  "cabecalho": {
    "nome": "string ou null",
    "empresa": "string ou null",
    "cnpj": "string ou null",
    "cargo": "string ou null",
    "mes": "string ou null",
    "horarioContratual": {
      "segSex": "HH:MM as HH:MM ou null",
      "sabado": "HH:MM as HH:MM ou null",
      "intervalo": "HH:MM as HH:MM ou null"
    }
  },
  "dias": [
    {
      "dia": 1,
      "diaSemana": "Seg",
      "entradaManha": "HH:MM ou null",
      "saidaManha": "HH:MM ou null",
      "entradaTarde": "HH:MM ou null",
      "saidaTarde": "HH:MM ou null",
      "entradaExtra": "HH:MM ou null",
      "saidaExtra": "HH:MM ou null",
      "observacao": "string ou null"
    }
  ],
  "confianca": 0.95,
  "tipo": "${tipoCartao}"
}`;
  }

  private parseResponse(
    content: string,
    tipoCartao: string,
  ): ExtracaoEstruturada {
    try {
      // Extrair JSON do response (pode vir com markdown)
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('No JSON found in GPT-5.2 response');
      }

      const parsed = JSON.parse(jsonMatch[0]) as Record<string, unknown>;

      // Parse cabecalho
      const rawCab = (parsed.cabecalho ?? {}) as Record<string, unknown>;
      const rawHorario = (rawCab.horarioContratual ?? null) as Record<
        string,
        unknown
      > | null;

      const cabecalho: CabecalhoExtracao = {
        nome: this.asStringOrNull(rawCab.nome),
        empresa: this.asStringOrNull(rawCab.empresa),
        cnpj: this.asStringOrNull(rawCab.cnpj),
        cargo: this.asStringOrNull(rawCab.cargo),
        mes: this.asStringOrNull(rawCab.mes),
        horarioContratual: rawHorario
          ? {
              segSex: this.asStringOrNull(rawHorario.segSex),
              sabado: this.asStringOrNull(rawHorario.sabado),
              intervalo: this.asStringOrNull(rawHorario.intervalo),
            }
          : null,
      };

      // Parse dias
      const rawDias = Array.isArray(parsed.dias) ? parsed.dias : [];
      const dias: DiaExtracao[] = rawDias.map((d: unknown) => {
        const dia = d as Record<string, unknown>;
        return {
          dia: typeof dia.dia === 'number' ? dia.dia : 0,
          diaSemana: this.asStringOrNull(dia.diaSemana),
          entradaManha: this.normalizeTime(this.asStringOrNull(dia.entradaManha)),
          saidaManha: this.normalizeTime(this.asStringOrNull(dia.saidaManha)),
          entradaTarde: this.normalizeTime(this.asStringOrNull(dia.entradaTarde)),
          saidaTarde: this.normalizeTime(this.asStringOrNull(dia.saidaTarde)),
          entradaExtra: this.normalizeTime(this.asStringOrNull(dia.entradaExtra)),
          saidaExtra: this.normalizeTime(this.asStringOrNull(dia.saidaExtra)),
          observacao: this.asStringOrNull(dia.observacao),
        };
      });

      // Parse confianca
      const confianca =
        typeof parsed.confianca === 'number' ? parsed.confianca : 0.5;

      // Determinar tipo
      const tipo = tipoCartao === 'quinzenal' ? 'quinzenal_1' as const : 'mensal' as const;

      return { cabecalho, dias, confianca, tipo };
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(
        `Failed to parse GPT-5.2 Direct response: ${message}`,
      );
      this.logger.debug(
        `Raw GPT-5.2 response (first 500 chars): ${content.substring(0, 500)}`,
      );
      throw new Error(`Parse error: ${message}`);
    }
  }

  /**
   * Normaliza horario: remove espacos, substitui . por :, zero-pad horas.
   */
  private normalizeTime(value: string | null): string | null {
    if (!value) return null;

    let v = value.trim().replace(/\./g, ':');

    // Remove caracteres invalidos
    v = v.replace(/[^0-9:]/g, '');

    if (!v || v === ':') return null;

    // Zero-pad: "7:00" → "07:00"
    const parts = v.split(':');
    if (parts.length === 2) {
      const hour = parts[0].padStart(2, '0');
      const minute = parts[1].padStart(2, '0');

      // Validacao basica
      const h = parseInt(hour, 10);
      const m = parseInt(minute, 10);
      if (isNaN(h) || isNaN(m) || h > 23 || m > 59) {
        return null;
      }

      return `${hour}:${minute}`;
    }

    return null;
  }

  private asStringOrNull(value: unknown): string | null {
    if (value === null || value === undefined) return null;
    if (typeof value === 'string') {
      const trimmed = value.trim();
      return trimmed.length > 0 ? trimmed : null;
    }
    return String(value);
  }

  private getMockResult(tipoCartao: string): ExtracaoEstruturada {
    this.logger.warn('Using mock GPT-5.2 Direct result');
    return {
      cabecalho: {
        nome: null,
        empresa: null,
        cnpj: null,
        cargo: null,
        mes: null,
        horarioContratual: null,
      },
      dias: [],
      confianca: 0,
      tipo: tipoCartao === 'quinzenal' ? 'quinzenal_1' : 'mensal',
    };
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
