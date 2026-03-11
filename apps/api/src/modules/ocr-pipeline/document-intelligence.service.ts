import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  DocumentAnalysisClient,
  AzureKeyCredential,
} from '@azure/ai-form-recognizer';

export interface OcrRawResult {
  pages: OcrPage[];
  tables: OcrTable[];
  rawResponse: unknown;
}

export interface OcrPage {
  pageNumber: number;
  width: number;
  height: number;
  lines: OcrLine[];
}

export interface OcrLine {
  content: string;
  confidence: number;
  boundingBox: number[];
}

export interface OcrTable {
  pageNumber: number;
  rowCount: number;
  columnCount: number;
  cells: OcrTableCell[];
}

export interface OcrTableCell {
  rowIndex: number;
  columnIndex: number;
  content: string;
  confidence: number;
  isHeader: boolean;
}

@Injectable()
export class DocumentIntelligenceService {
  private readonly logger = new Logger(DocumentIntelligenceService.name);
  private client: DocumentAnalysisClient | null = null;

  constructor(private readonly configService: ConfigService) {
    const endpoint = this.configService.get<string>('AZURE_DOC_INTEL_ENDPOINT');
    const key = this.configService.get<string>('AZURE_DOC_INTEL_KEY');

    if (endpoint && key) {
      this.client = new DocumentAnalysisClient(
        endpoint,
        new AzureKeyCredential(key),
      );
    } else {
      this.logger.warn('Azure Document Intelligence not configured — using mock mode');
    }
  }

  async analyzeDocument(pdfBuffer: Buffer): Promise<OcrRawResult> {
    const startTime = Date.now();

    if (!this.client) {
      this.logger.warn('Document Intelligence not configured, returning mock data');
      return this.getMockResult();
    }

    try {
      const poller = await this.client.beginAnalyzeDocument(
        'prebuilt-layout',
        pdfBuffer,
        {},
      );

      const result = await poller.pollUntilDone();
      const latencyMs = Date.now() - startTime;

      this.logger.log('Document analyzed successfully', {
        pages: result.pages?.length ?? 0,
        tables: result.tables?.length ?? 0,
        latencyMs,
      });

      // Map to our internal format
      const pages: OcrPage[] = (result.pages ?? []).map((page) => ({
        pageNumber: page.pageNumber,
        width: page.width ?? 0,
        height: page.height ?? 0,
        lines: (page.lines ?? []).map((line) => ({
          content: line.content,
          confidence: 0.9, // Layout API doesn't always provide per-line confidence
          boundingBox: line.polygon?.flatMap((p) => [p.x, p.y]) ?? [],
        })),
      }));

      const tables: OcrTable[] = (result.tables ?? []).map((table) => ({
        pageNumber: table.boundingRegions?.[0]?.pageNumber ?? 1,
        rowCount: table.rowCount,
        columnCount: table.columnCount,
        cells: (table.cells ?? []).map((cell) => ({
          rowIndex: cell.rowIndex,
          columnIndex: cell.columnIndex,
          content: cell.content,
          confidence: (cell as unknown as Record<string, unknown>)['confidence'] as number ?? 0.9,
          isHeader: cell.kind === 'columnHeader' || cell.kind === 'rowHeader',
        })),
      }));

      return {
        pages,
        tables,
        rawResponse: result,
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`Document Intelligence failed: ${message}`);
      throw error;
    }
  }

  private getMockResult(): OcrRawResult {
    // Return a realistic mock for development without Azure
    return {
      pages: [
        {
          pageNumber: 1,
          width: 612,
          height: 792,
          lines: [
            { content: 'CARTÃO DE PONTO', confidence: 0.98, boundingBox: [] },
            { content: 'Empresa: Construlaje Materiais de Construção Ltda', confidence: 0.95, boundingBox: [] },
            { content: 'CNPJ: 46.260.666/0001-80', confidence: 0.92, boundingBox: [] },
            { content: 'Funcionário: João Pedro Santos', confidence: 0.94, boundingBox: [] },
            { content: 'Cargo: Pedreiro', confidence: 0.93, boundingBox: [] },
            { content: 'Mês: 12/2024', confidence: 0.96, boundingBox: [] },
            { content: 'Horário: 07:00-16:00 Int. 11:00-12:00', confidence: 0.91, boundingBox: [] },
          ],
        },
      ],
      tables: [
        {
          pageNumber: 1,
          rowCount: 32,
          columnCount: 7,
          cells: [
            { rowIndex: 0, columnIndex: 0, content: 'Dia', confidence: 0.99, isHeader: true },
            { rowIndex: 0, columnIndex: 1, content: 'Dia Sem.', confidence: 0.99, isHeader: true },
            { rowIndex: 0, columnIndex: 2, content: 'Entrada', confidence: 0.99, isHeader: true },
            { rowIndex: 0, columnIndex: 3, content: 'Saída', confidence: 0.99, isHeader: true },
            { rowIndex: 0, columnIndex: 4, content: 'Entrada', confidence: 0.99, isHeader: true },
            { rowIndex: 0, columnIndex: 5, content: 'Saída', confidence: 0.99, isHeader: true },
            { rowIndex: 0, columnIndex: 6, content: 'Obs.', confidence: 0.99, isHeader: true },
            // Day 1
            { rowIndex: 1, columnIndex: 0, content: '01', confidence: 0.98, isHeader: false },
            { rowIndex: 1, columnIndex: 1, content: 'Seg', confidence: 0.97, isHeader: false },
            { rowIndex: 1, columnIndex: 2, content: '07:02', confidence: 0.95, isHeader: false },
            { rowIndex: 1, columnIndex: 3, content: '11:05', confidence: 0.93, isHeader: false },
            { rowIndex: 1, columnIndex: 4, content: '12:00', confidence: 0.94, isHeader: false },
            { rowIndex: 1, columnIndex: 5, content: '16:03', confidence: 0.92, isHeader: false },
            { rowIndex: 1, columnIndex: 6, content: '', confidence: 0.99, isHeader: false },
            // Day 2
            { rowIndex: 2, columnIndex: 0, content: '02', confidence: 0.98, isHeader: false },
            { rowIndex: 2, columnIndex: 1, content: 'Ter', confidence: 0.97, isHeader: false },
            { rowIndex: 2, columnIndex: 2, content: '07:10', confidence: 0.70, isHeader: false }, // low confidence
            { rowIndex: 2, columnIndex: 3, content: '11:00', confidence: 0.94, isHeader: false },
            { rowIndex: 2, columnIndex: 4, content: '12:02', confidence: 0.93, isHeader: false },
            { rowIndex: 2, columnIndex: 5, content: '16:15', confidence: 0.88, isHeader: false },
            { rowIndex: 2, columnIndex: 6, content: '', confidence: 0.99, isHeader: false },
            // Day 3 - manuscrito example
            { rowIndex: 3, columnIndex: 0, content: '03', confidence: 0.97, isHeader: false },
            { rowIndex: 3, columnIndex: 1, content: 'Qua', confidence: 0.96, isHeader: false },
            { rowIndex: 3, columnIndex: 2, content: '7:05', confidence: 0.55, isHeader: false }, // very low - manuscrito
            { rowIndex: 3, columnIndex: 3, content: '11:30', confidence: 0.60, isHeader: false },
            { rowIndex: 3, columnIndex: 4, content: '12:30', confidence: 0.58, isHeader: false },
            { rowIndex: 3, columnIndex: 5, content: '16:00', confidence: 0.62, isHeader: false },
            { rowIndex: 3, columnIndex: 6, content: '', confidence: 0.99, isHeader: false },
          ],
        },
      ],
      rawResponse: { mock: true },
    };
  }
}
