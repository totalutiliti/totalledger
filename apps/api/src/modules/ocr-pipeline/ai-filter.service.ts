import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';

export interface AiFilterInput {
  empresa: string;
  funcionario: string;
  horarioContratual: string;
  dia: number;
  diaSemana: string;
  campo: string;
  valorOCR: string;
  confianca: number;
  faixaEsperada: string;
}

export interface AiFilterResult {
  valorOriginal: string;
  valorCorrigido: string;
  confianca: number;
  justificativa: string;
}

export interface AiCallLog {
  input: AiFilterInput;
  output: AiFilterResult | null;
  tokensIn: number;
  tokensOut: number;
  latencyMs: number;
  success: boolean;
  error?: string;
}

@Injectable()
export class AiFilterService {
  private readonly logger = new Logger(AiFilterService.name);
  private client: OpenAI | null = null;
  private readonly model: string;

  constructor(private readonly configService: ConfigService) {
    const endpoint = this.configService.get<string>('AZURE_OPENAI_ENDPOINT');
    const key = this.configService.get<string>('AZURE_OPENAI_KEY');
    const apiVersion = this.configService.get<string>(
      'AZURE_OPENAI_API_VERSION',
      '2024-10-01-preview',
    );
    this.model = this.configService.get<string>(
      'AZURE_OPENAI_DEPLOYMENT',
      'gpt-4o-mini',
    );

    if (endpoint && key) {
      this.client = new OpenAI({
        apiKey: key,
        baseURL: `${endpoint}/openai/deployments/${this.model}`,
        defaultQuery: { 'api-version': apiVersion },
        defaultHeaders: { 'api-key': key },
      });
    } else {
      this.logger.warn('Azure OpenAI not configured — using mock mode');
    }
  }

  async filterField(input: AiFilterInput): Promise<AiFilterResult> {
    const startTime = Date.now();

    if (!this.client) {
      return this.getMockResult(input);
    }

    try {
      const prompt = this.buildPrompt(input);

      const completion = await this.client.chat.completions.create({
        model: this.model,
        messages: [
          {
            role: 'system',
            content:
              'Você é um especialista em leitura de cartões de ponto brasileiros. Responda APENAS em JSON válido.',
          },
          { role: 'user', content: prompt },
        ],
        max_completion_tokens: 200,
      });

      const latencyMs = Date.now() - startTime;
      const content = completion.choices[0]?.message?.content ?? '';
      const tokensIn = completion.usage?.prompt_tokens ?? 0;
      const tokensOut = completion.usage?.completion_tokens ?? 0;

      const result = this.parseResponse(content, input.valorOCR);

      this.logger.log('AI filter completed', {
        campo: input.campo,
        dia: input.dia,
        valorOCR: input.valorOCR,
        valorCorrigido: result.valorCorrigido,
        confianca: result.confianca,
        tokensIn,
        tokensOut,
        latencyMs,
      });

      return result;
    } catch (error: unknown) {
      const latencyMs = Date.now() - startTime;
      const message =
        error instanceof Error ? error.message : 'Unknown error';

      this.logger.error(
        'AI filter failed, using OCR value as fallback',
        undefined,
        {
          campo: input.campo,
          dia: input.dia,
          error: message,
          latencyMs,
        },
      );

      // Fallback: return original OCR value
      return {
        valorOriginal: input.valorOCR,
        valorCorrigido: input.valorOCR,
        confianca: input.confianca,
        justificativa: `Fallback: AI indisponível (${message})`,
      };
    }
  }

  private buildPrompt(input: AiFilterInput): string {
    return `CONTEXTO:
- Empresa: ${input.empresa}
- Funcionário: ${input.funcionario}
- Horário contratual: ${input.horarioContratual}
- Dia: ${input.dia} (${input.diaSemana})

O OCR extraiu o seguinte valor para o campo "${input.campo}": "${input.valorOCR}"
Nível de confiança do OCR: ${input.confianca}

O campo é um horário no formato HH:MM (24h).
Horários típicos para este campo: ${input.faixaEsperada}

TAREFA:
1. Analise se o valor extraído é plausível para este campo.
2. Se plausível, confirme o valor.
3. Se ambíguo ou implausível, sugira a correção mais provável.
4. Indique seu nível de confiança (0.0 a 1.0).

RESPONDA APENAS em JSON:
{
  "valorOriginal": "...",
  "valorCorrigido": "...",
  "confianca": 0.0,
  "justificativa": "..."
}`;
  }

  private parseResponse(
    content: string,
    fallbackValue: string,
  ): AiFilterResult {
    try {
      // Try to extract JSON from the response
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('No JSON found in response');
      }

      const parsed = JSON.parse(jsonMatch[0]) as Record<string, unknown>;

      return {
        valorOriginal: String(parsed.valorOriginal ?? fallbackValue),
        valorCorrigido: String(parsed.valorCorrigido ?? fallbackValue),
        confianca:
          typeof parsed.confianca === 'number' ? parsed.confianca : 0.5,
        justificativa: String(
          parsed.justificativa ?? 'Sem justificativa',
        ),
      };
    } catch {
      return {
        valorOriginal: fallbackValue,
        valorCorrigido: fallbackValue,
        confianca: 0.5,
        justificativa: 'Falha ao interpretar resposta da IA',
      };
    }
  }

  private getMockResult(input: AiFilterInput): AiFilterResult {
    this.logger.warn('Using mock AI filter result');
    return {
      valorOriginal: input.valorOCR,
      valorCorrigido: input.valorOCR,
      confianca: 0.75,
      justificativa: 'Mock: valor mantido (modo desenvolvimento)',
    };
  }
}
