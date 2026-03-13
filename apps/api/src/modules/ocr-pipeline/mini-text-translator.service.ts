import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import { RateLimiterService } from './rate-limiter.service';
import {
  ExtracaoEstruturada,
  DiaExtracao,
  CabecalhoExtracao,
  HorarioContratualExtracao,
  DiReadResult,
} from './ocr-pipeline.types';
import { ResolvedOcrConfig } from './tenant-ocr-config.service';

const MAX_RETRIES = 3;
const RETRY_BACKOFFS = [1000, 2000, 4000];
const REQUEST_TIMEOUT = 180000;

/**
 * Mini C — Tradutor de texto OCR cru para formato estruturado.
 *
 * Recebe o texto do DI Read (SEM imagem) e organiza nos campos padrao.
 * Significativamente mais barato que Mini A/B (sem tokens de visao).
 */
@Injectable()
export class MiniTextTranslatorService {
  private readonly logger = new Logger(MiniTextTranslatorService.name);
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
      this.logger.log('Mini Text Translator (C) initialized', {
        deployment: this.model,
      });
    } else {
      this.logger.warn(
        'Azure OpenAI not configured — Mini Text Translator using mock mode',
      );
    }
  }

  /**
   * Traduz texto OCR cru do DI Read para ExtracaoEstruturada.
   * NAO recebe imagem — opera apenas sobre texto.
   */
  async traduzir(
    diReadResult: DiReadResult,
    configTenant: ResolvedOcrConfig,
  ): Promise<ExtracaoEstruturada> {
    if (!this.client) {
      return this.getMockResult();
    }

    const prompt = this.buildPrompt(configTenant);

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
                content: `Organize o seguinte texto extraido por OCR de um cartao de ponto nos campos estruturados.\n\nTexto OCR:\n${diReadResult.textoCompleto}`,
              },
            ],
            max_completion_tokens: 16000,
          });

          const content = completion.choices[0]?.message?.content ?? '';
          const parsed = this.parseResponse(content);

          this.logger.log('Mini C translation completed', {
            attempt: attempt + 1,
            dias: parsed.dias.length,
            confianca: parsed.confianca,
          });

          return parsed;
        } catch (error: unknown) {
          const message =
            error instanceof Error ? error.message : 'Unknown error';
          this.logger.warn(
            `Mini C attempt ${attempt + 1}/${MAX_RETRIES} failed: ${message}`,
          );

          if (attempt < MAX_RETRIES - 1) {
            await this.sleep(RETRY_BACKOFFS[attempt]);
          }
        }
      }

      this.logger.error('Mini C translation failed after all retries');
      throw new Error(`Mini C translation failed after ${MAX_RETRIES} retries`);
    } finally {
      this.rateLimiter.release('mini');
    }
  }

  private buildPrompt(config: ResolvedOcrConfig): string {
    const horarioInfo = config.timeFieldRanges
      ? '\nUse os horarios contratuais do tenant como referencia para decidir o que e manha vs tarde.'
      : '';

    return `Voce e um especialista em organizar dados de cartoes de ponto brasileiros.
O texto abaixo foi extraido por OCR e pode conter erros de leitura.
Organize os dados nos campos estruturados.

INSTRUCOES:
1. O texto vem de OCR e pode ter erros — faca seu melhor esforco
2. Organize nos 6 campos: entradaManha, saidaManha, entradaTarde, saidaTarde, entradaExtra, saidaExtra
3. Se nao conseguir mapear um horario a um campo, retorne null
4. Identifique o cabecalho: nome, empresa, CNPJ, cargo, mes, horario contratual
5. Horarios no formato HH:MM${horarioInfo}

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
  "confianca": 0.80,
  "tipo": "mensal"
}

REGRAS:
- "tipo": "mensal" se dias 1-31, "quinzenal_1" se 1-15, "quinzenal_2" se 16-31
- "confianca": auto-avaliacao de quao bem conseguiu organizar (0.0 a 1.0)
- Responda APENAS em JSON valido`;
  }

  private parseResponse(content: string): ExtracaoEstruturada {
    try {
      this.logger.debug(`Raw Mini C response (first 500 chars): ${content.substring(0, 500)}`);

      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('No JSON found in Mini C response');
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
      this.logger.warn(`Failed to parse Mini C response: ${message}`);
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

  private getMockResult(): ExtracaoEstruturada {
    this.logger.warn('Using mock Mini C result');

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
        horarioContratual: null,
      },
      dias,
      confianca: 0.80,
      tipo: 'mensal',
    };
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
