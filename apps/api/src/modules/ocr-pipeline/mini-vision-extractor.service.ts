import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import { RateLimiterService } from './rate-limiter.service';
import { ExtracaoEstruturada, DiaExtracao, CabecalhoExtracao, HorarioContratualExtracao } from './ocr-pipeline.types';
import { ResolvedOcrConfig } from './tenant-ocr-config.service';

const MAX_RETRIES = 3;
const RETRY_BACKOFFS = [1000, 2000, 4000];
const REQUEST_TIMEOUT = 180000;

/**
 * Extrator Mini com visao — usado para variantes A e B.
 *
 * Mini A: prompt focado em precisao
 * Mini B: prompt focado em recall
 *
 * Ambos retornam o mesmo formato ExtracaoEstruturada.
 */
@Injectable()
export class MiniVisionExtractorService {
  private readonly logger = new Logger(MiniVisionExtractorService.name);
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
      this.logger.log('Mini Vision Extractor v2 initialized', {
        deployment: this.model,
      });
    } else {
      this.logger.warn(
        'Azure OpenAI not configured — Mini Vision Extractor v2 using mock mode',
      );
    }
  }

  /**
   * Extrai dados do cartao de ponto usando GPT-5 Mini com visao.
   *
   * @param imagemBase64 - PNG da pagina codificado em base64
   * @param promptVariante - 'A' (precisao) ou 'B' (recall)
   * @param configTenant - Config do tenant para horarios contratuais
   */
  async extrair(
    imagemBase64: string,
    promptVariante: 'A' | 'B',
    configTenant: ResolvedOcrConfig,
  ): Promise<ExtracaoEstruturada> {
    if (!this.client) {
      return this.getMockResult(promptVariante);
    }

    const prompt = this.buildPrompt(promptVariante, configTenant);

    await this.rateLimiter.acquire('mini');

    try {
      for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
        try {
          const completion = await this.client.chat.completions.create({
            model: this.model,
            messages: [
              { role: 'system', content: prompt },
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
                    text: 'Extraia todos os horarios deste cartao de ponto.',
                  },
                ],
              },
            ],
            max_completion_tokens: 16000,
          });

          const choice = completion.choices[0];
          const content = choice?.message?.content ?? '';
          const finishReason = choice?.finish_reason;
          const refusal = (choice?.message as unknown as Record<string, unknown>)?.refusal;

          if (!content) {
            this.logger.warn(`Mini ${promptVariante}: empty response`, {
              finishReason,
              refusal: refusal ?? null,
              usage: completion.usage,
            });
          }

          const parsed = this.parseResponse(content);

          this.logger.log(`Mini ${promptVariante} extraction completed`, {
            attempt: attempt + 1,
            dias: parsed.dias.length,
            confianca: parsed.confianca,
            finishReason,
          });

          return parsed;
        } catch (error: unknown) {
          const message =
            error instanceof Error ? error.message : 'Unknown error';
          this.logger.warn(
            `Mini ${promptVariante} attempt ${attempt + 1}/${MAX_RETRIES} failed: ${message}`,
          );

          if (attempt < MAX_RETRIES - 1) {
            await this.sleep(RETRY_BACKOFFS[attempt]);
          }
        }
      }

      this.logger.error(
        `Mini ${promptVariante} failed after all retries`,
      );
      throw new Error(`Mini ${promptVariante} extraction failed after ${MAX_RETRIES} retries`);
    } finally {
      this.rateLimiter.release('mini');
    }
  }

  private buildPrompt(
    variante: 'A' | 'B',
    config: ResolvedOcrConfig,
  ): string {
    const horarioInfo = config.timeFieldRanges
      ? `\nHorario contratual de referencia do tenant disponivel na configuracao.`
      : '';

    if (variante === 'A') {
      return `Voce e um especialista em leitura de cartoes de ponto brasileiros manuscritos e impressos.
Extraia com PRECISAO todos os horarios registrados na imagem.
Se nao conseguir ler um campo com seguranca, retorne null.
Priorize ACURACIA sobre completude — e melhor retornar null do que um valor errado.
${horarioInfo}

FORMATO DE SAIDA (JSON):
{
  "cabecalho": {
    "nome": "Nome do Funcionario",
    "empresa": "Nome da Empresa",
    "cnpj": "00.000.000/0000-00",
    "cargo": "Cargo",
    "mes": "03/2026",
    "horarioContratual": {
      "segSex": "07:00 as 16:00",
      "sabado": "07:00 as 11:00",
      "intervalo": "11:00 as 12:00"
    }
  },
  "dias": [
    {
      "dia": 1,
      "diaSemana": "Seg",
      "entradaManha": "07:25",
      "saidaManha": "12:00",
      "entradaTarde": "13:00",
      "saidaTarde": "18:05",
      "entradaExtra": null,
      "saidaExtra": null,
      "observacao": null
    }
  ],
  "confianca": 0.90,
  "tipo": "mensal"
}

REGRAS:
- Horarios no formato HH:MM (ex: 07:25, 12:00)
- Se campo vazio, retorne null
- Se ilegivel, retorne null (nao adivinhe)
- "tipo": "mensal" se 1-31, "quinzenal_1" se 1-15, "quinzenal_2" se 16-31
- "confianca": auto-avaliacao geral de 0.0 a 1.0
- Responda APENAS em JSON valido`;
    }

    return `Voce e um especialista em leitura de cartoes de ponto brasileiros manuscritos e impressos.
Extraia TODOS os horarios visiveis na imagem do cartao de ponto.
Mesmo que tenha duvida sobre um valor, reporte sua MELHOR LEITURA e indique na observacao.
Priorize COMPLETUDE sobre acuracia — e melhor reportar um valor incerto do que pular.
${horarioInfo}

FORMATO DE SAIDA (JSON):
{
  "cabecalho": {
    "nome": "Nome do Funcionario",
    "empresa": "Nome da Empresa",
    "cnpj": "00.000.000/0000-00",
    "cargo": "Cargo",
    "mes": "03/2026",
    "horarioContratual": {
      "segSex": "07:00 as 16:00",
      "sabado": "07:00 as 11:00",
      "intervalo": "11:00 as 12:00"
    }
  },
  "dias": [
    {
      "dia": 1,
      "diaSemana": "Seg",
      "entradaManha": "07:25",
      "saidaManha": "12:00",
      "entradaTarde": "13:00",
      "saidaTarde": "18:05",
      "entradaExtra": null,
      "saidaExtra": null,
      "observacao": "saidaManha parcialmente ilegivel"
    }
  ],
  "confianca": 0.85,
  "tipo": "mensal"
}

REGRAS:
- Horarios no formato HH:MM (ex: 07:25, 12:00)
- Se campo vazio, retorne null
- Se parcialmente ilegivel, reporte sua melhor estimativa e anote na observacao
- "tipo": "mensal" se 1-31, "quinzenal_1" se 1-15, "quinzenal_2" se 16-31
- "confianca": auto-avaliacao geral de 0.0 a 1.0
- Responda APENAS em JSON valido`;
  }

  private parseResponse(content: string): ExtracaoEstruturada {
    try {
      this.logger.debug(`Raw Mini Vision response (first 500 chars): ${content.substring(0, 500)}`);

      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('No JSON found in Mini Vision response');
      }

      const parsed = JSON.parse(jsonMatch[0]) as Record<string, unknown>;

      const cabecalho = this.parseCabecalho(
        parsed.cabecalho as Record<string, unknown> | undefined,
      );

      const diasRaw = parsed.dias;
      if (!Array.isArray(diasRaw)) {
        throw new Error('Response missing "dias" array');
      }

      const dias: DiaExtracao[] = diasRaw.map((d: unknown) => {
        const dia = d as Record<string, unknown>;
        return {
          dia: typeof dia.dia === 'number' ? dia.dia : 0,
          diaSemana: typeof dia.diaSemana === 'string' ? dia.diaSemana : null,
          entradaManha: this.parseHorario(dia.entradaManha),
          saidaManha: this.parseHorario(dia.saidaManha),
          entradaTarde: this.parseHorario(dia.entradaTarde),
          saidaTarde: this.parseHorario(dia.saidaTarde),
          entradaExtra: this.parseHorario(dia.entradaExtra),
          saidaExtra: this.parseHorario(dia.saidaExtra),
          observacao:
            typeof dia.observacao === 'string' ? dia.observacao : null,
        };
      });

      const confianca =
        typeof parsed.confianca === 'number' ? parsed.confianca : 0.5;
      const tipo = this.parseTipo(parsed.tipo);

      return { cabecalho, dias, confianca, tipo };
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : 'Unknown error';
      this.logger.warn(`Failed to parse Mini Vision response: ${message}`);
      return this.emptyExtracao();
    }
  }

  private parseCabecalho(
    raw: Record<string, unknown> | undefined,
  ): CabecalhoExtracao {
    if (!raw) {
      return {
        nome: null,
        empresa: null,
        cnpj: null,
        cargo: null,
        mes: null,
        horarioContratual: null,
      };
    }

    let horarioContratual: HorarioContratualExtracao | null = null;
    if (raw.horarioContratual && typeof raw.horarioContratual === 'object') {
      const hc = raw.horarioContratual as Record<string, unknown>;
      horarioContratual = {
        segSex: typeof hc.segSex === 'string' ? hc.segSex : null,
        sabado: typeof hc.sabado === 'string' ? hc.sabado : null,
        intervalo: typeof hc.intervalo === 'string' ? hc.intervalo : null,
      };
    }

    return {
      nome: typeof raw.nome === 'string' ? raw.nome : null,
      empresa: typeof raw.empresa === 'string' ? raw.empresa : null,
      cnpj: typeof raw.cnpj === 'string' ? raw.cnpj : null,
      cargo: typeof raw.cargo === 'string' ? raw.cargo : null,
      mes: typeof raw.mes === 'string' ? raw.mes : null,
      horarioContratual,
    };
  }

  private parseHorario(value: unknown): string | null {
    if (value === null || value === undefined) return null;
    const str = String(value).trim();
    if (str === '' || str === 'null') return null;
    return str;
  }

  private parseTipo(
    value: unknown,
  ): 'mensal' | 'quinzenal_1' | 'quinzenal_2' {
    if (value === 'quinzenal_1') return 'quinzenal_1';
    if (value === 'quinzenal_2') return 'quinzenal_2';
    return 'mensal';
  }

  private emptyExtracao(): ExtracaoEstruturada {
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
      tipo: 'mensal',
    };
  }

  private getMockResult(variante: 'A' | 'B'): ExtracaoEstruturada {
    this.logger.warn(`Using mock Mini ${variante} result`);

    const dias: DiaExtracao[] = [];
    for (let day = 1; day <= 31; day++) {
      const isWeekend = day % 7 === 0 || day % 7 === 1;
      dias.push({
        dia: day,
        diaSemana: null,
        entradaManha: isWeekend ? null : '07:00',
        saidaManha: isWeekend ? null : '12:00',
        entradaTarde: isWeekend ? null : '13:00',
        saidaTarde: isWeekend ? null : '18:00',
        entradaExtra: null,
        saidaExtra: null,
        observacao: null,
      });
    }

    return {
      cabecalho: {
        nome: 'Mock Funcionario',
        empresa: 'Mock Empresa',
        cnpj: null,
        cargo: 'Operador',
        mes: '03/2026',
        horarioContratual: {
          segSex: '07:00 as 16:00',
          sabado: '07:00 as 11:00',
          intervalo: '11:00 as 12:00',
        },
      },
      dias,
      confianca: 0.92,
      tipo: 'mensal',
    };
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
