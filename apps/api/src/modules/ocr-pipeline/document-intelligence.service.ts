import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  DocumentAnalysisClient,
  AzureKeyCredential,
} from '@azure/ai-form-recognizer';
import { generateMockOcrResult, hashBuffer } from './mock-ocr-generator';

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
  columnSpan: number;
  rowSpan: number;
  content: string;
  confidence: number;
  isHeader: boolean;
  /** Polygon coordinates from Azure DI boundingRegions (flattened [x1,y1,x2,y2,...]) */
  boundingBox: number[];
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
      return this.getMockResult(pdfBuffer);
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
          columnSpan: cell.columnSpan ?? 1,
          rowSpan: cell.rowSpan ?? 1,
          content: cell.content,
          confidence: (cell as unknown as Record<string, unknown>)['confidence'] as number ?? 0.9,
          isHeader: cell.kind === 'columnHeader' || cell.kind === 'rowHeader',
          boundingBox: cell.boundingRegions?.[0]?.polygon?.flatMap((p) => [p.x, p.y]) ?? [],
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

  private async getMockResult(pdfBuffer: Buffer): Promise<OcrRawResult> {
    let pageCount = 1;

    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const pdfParse = require('pdf-parse') as (buf: Buffer) => Promise<{ numpages: number }>;
      const parsed = await pdfParse(pdfBuffer);
      pageCount = parsed.numpages;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.warn(`pdf-parse failed, defaulting to 1 page: ${message}`);
    }

    const seed = hashBuffer(pdfBuffer);

    this.logger.log('Mock OCR: generating realistic data', {
      pageCount,
      seed,
    });

    return generateMockOcrResult(pageCount, seed);
  }
}
