import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  DocumentAnalysisClient,
  AzureKeyCredential,
} from '@azure/ai-form-recognizer';
import { DiReadResult, DiReadLine } from './ocr-pipeline.types';

/**
 * Extrai texto OCR cru usando Azure DI com modelo prebuilt-read.
 *
 * prebuilt-read custa $1.50/1K paginas vs $10/1K do prebuilt-layout.
 * Retorna texto com posicao na pagina, SEM estrutura de tabela.
 */
@Injectable()
export class DiReadExtractorService {
  private readonly logger = new Logger(DiReadExtractorService.name);
  private client: DocumentAnalysisClient | null = null;

  constructor(private readonly configService: ConfigService) {
    const endpoint = this.configService.get<string>('AZURE_DOC_INTEL_ENDPOINT');
    const key = this.configService.get<string>('AZURE_DOC_INTEL_KEY');

    if (endpoint && key) {
      this.client = new DocumentAnalysisClient(
        endpoint,
        new AzureKeyCredential(key),
      );
      this.logger.log('DI Read Extractor initialized');
    } else {
      this.logger.warn(
        'Azure Document Intelligence not configured — DI Read using mock mode',
      );
    }
  }

  /**
   * Extrai texto OCR de uma pagina especifica usando prebuilt-read.
   */
  async extrair(pdfBuffer: Buffer, pageNumber: number): Promise<DiReadResult> {
    if (!this.client) {
      return this.getMockResult(pageNumber);
    }

    try {
      const poller = await this.client.beginAnalyzeDocument(
        'prebuilt-read',
        pdfBuffer,
        { pages: `${pageNumber}` },
      );
      const result = await poller.pollUntilDone();

      const page = result.pages?.[0];
      const linhas: DiReadLine[] =
        page?.lines?.map((l) => ({
          texto: l.content,
          boundingBox: l.polygon?.flatMap((p) => [p.x, p.y]) ?? [],
          confianca:
            (l as unknown as Record<string, unknown>)['confidence'] as
              | number
              | null ?? null,
        })) ?? [];

      this.logger.log('DI Read extraction completed', {
        pageNumber,
        linhas: linhas.length,
        textLength: result.content?.length ?? 0,
      });

      return {
        textoCompleto: result.content ?? '',
        linhas,
      };
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`DI Read failed for page ${pageNumber}: ${message}`);
      throw error;
    }
  }

  /**
   * Extrai texto OCR de TODAS as paginas do PDF de uma vez.
   * Mais eficiente que chamar por pagina individual.
   */
  async extrairTodas(pdfBuffer: Buffer): Promise<Map<number, DiReadResult>> {
    if (!this.client) {
      return this.getMockResultAll(pdfBuffer);
    }

    try {
      const poller = await this.client.beginAnalyzeDocument(
        'prebuilt-read',
        pdfBuffer,
      );
      const result = await poller.pollUntilDone();

      const resultMap = new Map<number, DiReadResult>();

      for (const page of result.pages ?? []) {
        const linhas: DiReadLine[] =
          page.lines?.map((l) => ({
            texto: l.content,
            boundingBox: l.polygon?.flatMap((p) => [p.x, p.y]) ?? [],
            confianca:
              (l as unknown as Record<string, unknown>)['confidence'] as
                | number
                | null ?? null,
          })) ?? [];

        // Extract page-specific text from full content using line offsets
        const pageText = linhas.map((l) => l.texto).join('\n');

        resultMap.set(page.pageNumber, {
          textoCompleto: pageText,
          linhas,
        });
      }

      this.logger.log('DI Read batch extraction completed', {
        totalPages: resultMap.size,
      });

      return resultMap;
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`DI Read batch extraction failed: ${message}`);
      throw error;
    }
  }

  private getMockResult(pageNumber: number): DiReadResult {
    this.logger.warn(`Using mock DI Read result for page ${pageNumber}`);
    const dias: string[] = [];
    for (let d = 1; d <= 31; d++) {
      const isWeekend = d % 7 === 0 || d % 7 === 1;
      if (isWeekend) {
        dias.push(`${d}  Dom/Sab`);
      } else {
        dias.push(`${d}  Seg  07:00  12:00  13:00  18:00`);
      }
    }
    return {
      textoCompleto: [
        'CARTAO DE PONTO',
        'Nome: Mock Funcionario',
        'Empresa: Mock Empresa',
        'Mes: 03/2026',
        'Cargo: Operador',
        'Horario: 07:00 as 16:00',
        '',
        'Dia  Sem  Entrada  Saida  Entrada  Saida',
        ...dias,
      ].join('\n'),
      linhas: [],
    };
  }

  private async getMockResultAll(
    pdfBuffer: Buffer,
  ): Promise<Map<number, DiReadResult>> {
    let pageCount = 1;
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const pdfParse = require('pdf-parse') as (
        buf: Buffer,
      ) => Promise<{ numpages: number }>;
      const parsed = await pdfParse(pdfBuffer);
      pageCount = parsed.numpages;
    } catch {
      // ignore
    }

    const result = new Map<number, DiReadResult>();
    for (let i = 1; i <= pageCount; i++) {
      result.set(i, this.getMockResult(i));
    }
    return result;
  }
}
