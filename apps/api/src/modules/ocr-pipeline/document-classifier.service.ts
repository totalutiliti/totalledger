import { Injectable, Logger } from '@nestjs/common';
import { OcrRawResult, OcrPage, OcrTable } from './document-intelligence.service';

/**
 * Page types recognized by the classifier.
 * Maps 1:1 with the Prisma PageType enum.
 */
export type PageTypeEnum =
  | 'CARTAO_PONTO_MENSAL'
  | 'CARTAO_PONTO_QUINZENAL'
  | 'ESPELHO_PONTO'
  | 'PAGINA_ASSINATURA'
  | 'PAGINA_SEM_TABELA'
  | 'PAGINA_FINANCEIRA'
  | 'DOCUMENTO_DESCONHECIDO';

export interface PageClassificationResult {
  pageNumber: number;
  pageType: PageTypeEnum;
  subFormat: string | null;
  confidence: number;
  shouldProcess: boolean;
  classifierData: Record<string, unknown>;
}

/** Sub-formats for processable pages */
type SubFormat =
  | 'standard_mensal'
  | 'quinzenal'
  | 'com_dia_semana'
  | 'manuscrito'
  | null;

/** Thresholds */
const MIN_TIME_MATCHES = 3;
const MANUSCRITO_AVG_CONFIDENCE = 0.70;
// Financial keywords kept for reference — not currently used since GPT handles classification
// const FINANCIAL_KEYWORDS = ['horas', 'extras', 'r$', 'salário', 'líquido', 'bruto', 'desconto', 'fgts', 'inss'];
const SIGNATURE_KEYWORDS = ['assinatura', 'responsável', 'empregador', 'empregado', 'concordo', 'declaro'];

@Injectable()
export class DocumentClassifierService {
  private readonly logger = new Logger(DocumentClassifierService.name);

  /**
   * Classify all pages in an OCR result.
   * Returns classification for each page with shouldProcess flag.
   */
  classifyAllPages(ocrResult: OcrRawResult): PageClassificationResult[] {
    return ocrResult.pages.map((page) => {
      // Pick the table with the most cells for this page (most meaningful).
      // DI may return multiple tables (e.g. summary table + time card table)
      // and .find() would only grab the first — which may be empty.
      const tablesForPage = ocrResult.tables.filter(
        (t) => t.pageNumber === page.pageNumber,
      );
      const table =
        tablesForPage.length > 0
          ? tablesForPage.reduce((best, t) =>
              t.cells.length > best.cells.length ? t : best,
            )
          : undefined;
      return this.classifyPage(page, table);
    });
  }

  /**
   * Classify a single page based on DI heuristics.
   *
   * Decision tree:
   * 1. No table → PAGINA_SEM_TABELA (skip)
   * 2. Table exists but few time patterns → check signature/financial
   * 3. Table with time patterns → CARTAO_PONTO (process)
   *    - Detect quinzenal vs mensal
   *    - Detect manuscrito
   *    - Detect dia_semana sub-format
   */
  classifyPage(page: OcrPage, table?: OcrTable): PageClassificationResult {
    const pageNumber = page.pageNumber;
    const allText = page.lines.map((l) => l.content).join(' ').toLowerCase();
    const lineContents = page.lines.map((l) => l.content.toLowerCase());

    // Collect classification evidence
    const evidence: Record<string, unknown> = {};

    // === 1. No table at all ===
    if (!table || table.cells.length === 0) {
      const isSignature = this.hasSignatureIndicators(lineContents);
      if (isSignature) {
        return this.result(pageNumber, 'PAGINA_ASSINATURA', null, 0.85, false, {
          reason: 'no_table_signature_keywords',
        });
      }

      return this.result(pageNumber, 'PAGINA_SEM_TABELA', null, 0.90, false, {
        reason: 'no_table_found',
      });
    }

    // === 2. Count time-like patterns in table cells ===
    const timeRegex = /\d{1,2}[:.]\d{2}/;
    const tableCellContents = table.cells
      .filter((c) => !c.isHeader)
      .map((c) => c.content.trim());
    const timeMatches = tableCellContents.filter((c) => timeRegex.test(c)).length;
    evidence.timeMatches = timeMatches;

    // === 3. Table with data rows → always process ===
    // GPT Mini is the primary extractor and can determine if this is a valid
    // time card. We only skip pages that are clearly not time cards (pure
    // signature pages with tiny tables and zero time data).
    // Any page with a meaningful table should be processed — even if the DI
    // missed some time patterns, the Mini reads from the image directly.
    if (timeMatches === 0 && table.rowCount <= 3) {
      // Only skip VERY small tables with absolutely no time data
      const isSignature = this.hasSignatureIndicators(lineContents);
      if (isSignature) {
        return this.result(pageNumber, 'PAGINA_ASSINATURA', null, 0.85, false, {
          reason: 'tiny_table_no_times_signature_keywords',
          ...evidence,
        });
      }
    }

    // Tables with rowCount <= 5 and few times — still process but flag as low confidence
    if (timeMatches < MIN_TIME_MATCHES && table.rowCount <= 5) {
      const hasEmployeeHeader = this.hasEmployeeHeader(lineContents);
      if (hasEmployeeHeader && timeMatches === 0) {
        return this.result(pageNumber, 'ESPELHO_PONTO', null, 0.70, false, {
          reason: 'summary_table_with_header_no_times',
          ...evidence,
        });
      }
      // Has SOME table structure — let GPT Mini decide
      this.logger.warn(`[Classifier] Page ${pageNumber}: small table with few times, sending to GPT Mini`, {
        pageNumber,
        timeMatches,
        rowCount: table.rowCount,
      });
    }

    // === 4. This IS a time card — determine sub-type ===

    // Detect quinzenal
    const isQuinzenal = this.isQuinzenal(allText, table);
    evidence.isQuinzenal = isQuinzenal;

    // Detect manuscrito (low avg DI confidence)
    const avgConfidence = this.computeAvgCellConfidence(table);
    evidence.avgCellConfidence = avgConfidence;
    const isManuscrito = avgConfidence < MANUSCRITO_AVG_CONFIDENCE;

    // Detect dia_semana column
    const hasDiaSemana = this.hasDiaSemanaColumn(table);
    evidence.hasDiaSemana = hasDiaSemana;

    // Determine data rows count (excluding headers)
    const dataRowCount = this.countDataRows(table);
    evidence.dataRowCount = dataRowCount;

    // Classify
    let pageType: PageTypeEnum;
    let subFormat: SubFormat;
    let confidence: number;

    if (isQuinzenal) {
      pageType = 'CARTAO_PONTO_QUINZENAL';
      subFormat = 'quinzenal';
      confidence = 0.85;

      // Detectar subtipo: frente vs verso
      const quinzenalSubType = this.detectarSubtipoQuinzenal(allText, table);
      evidence.quinzenalSubType = quinzenalSubType;

      // Tentar extrair nome do funcionario do cabecalho (so frente tem)
      if (quinzenalSubType === 'QUINZENAL_FRENTE') {
        const funcionario = this.extrairFuncionarioDoTexto(lineContents);
        if (funcionario) {
          evidence.funcionarioDetectado = funcionario;
        }
      }
    } else {
      pageType = 'CARTAO_PONTO_MENSAL';
      if (isManuscrito) {
        subFormat = 'manuscrito';
        confidence = 0.75;
      } else if (hasDiaSemana) {
        subFormat = 'com_dia_semana';
        confidence = 0.90;
      } else {
        subFormat = 'standard_mensal';
        confidence = 0.90;
      }

      // Extrair funcionario do cabecalho para mensal tambem
      const funcionario = this.extrairFuncionarioDoTexto(lineContents);
      if (funcionario) {
        evidence.funcionarioDetectado = funcionario;
      }
    }

    return this.result(pageNumber, pageType, subFormat, confidence, true, evidence);
  }

  // =========================================
  // Helper methods
  // =========================================

  private isQuinzenal(allText: string, table: OcrTable): boolean {
    // Check for quinzenal keywords
    if (/2[ªa]\s*quinzena/i.test(allText) || /1[ªa]\s*quinzena/i.test(allText)) {
      return true;
    }

    // If data rows <= 16, likely quinzenal
    const dataRows = this.countDataRows(table);
    if (dataRows > 0 && dataRows <= 16) {
      return true;
    }

    return false;
  }

  private hasSignatureIndicators(lines: string[]): boolean {
    return lines.some((line) =>
      SIGNATURE_KEYWORDS.some((kw) => line.includes(kw)),
    );
  }

  private hasEmployeeHeader(lines: string[]): boolean {
    return lines.some(
      (line) =>
        /funcion[áa]rio/i.test(line) ||
        /nome[:\s]/i.test(line) ||
        /empresa[:\s]/i.test(line),
    );
  }

  // computeKeywordScore kept for future use when DI-based classification is re-enabled
  // private computeKeywordScore(text: string, keywords: string[]): number {
  //   return keywords.reduce(
  //     (score, kw) => score + (text.includes(kw) ? 1 : 0),
  //     0,
  //   );
  // }

  private computeAvgCellConfidence(table: OcrTable): number {
    const dataCells = table.cells.filter((c) => !c.isHeader && c.content.trim().length > 0);
    if (dataCells.length === 0) return 0;
    return dataCells.reduce((sum, c) => sum + c.confidence, 0) / dataCells.length;
  }

  private hasDiaSemanaColumn(table: OcrTable): boolean {
    const headerCells = table.cells
      .filter((c) => c.rowIndex === 0)
      .map((c) => c.content.toLowerCase().trim());

    return headerCells.some(
      (h) =>
        h.includes('sem') ||
        h.includes('d.s') ||
        h.includes('dia da semana'),
    );
  }

  private countDataRows(table: OcrTable): number {
    // Find unique row indices that are not header rows
    const headerRows = new Set<number>();
    for (const cell of table.cells) {
      if (cell.isHeader) {
        headerRows.add(cell.rowIndex);
      }
    }

    // If no explicit header, assume row 0 (and maybe row 1) is header
    if (headerRows.size === 0) {
      headerRows.add(0);
    }

    const dataRowIndices = new Set(
      table.cells
        .filter((c) => !headerRows.has(c.rowIndex))
        .map((c) => c.rowIndex),
    );

    return dataRowIndices.size;
  }

  /**
   * Detecta se pagina quinzenal e FRENTE (dias 1-15 + cabecalho)
   * ou VERSO (dias 16-31 + tabela totais, sem cabecalho).
   */
  private detectarSubtipoQuinzenal(
    allText: string,
    table: OcrTable,
  ): 'QUINZENAL_FRENTE' | 'QUINZENAL_VERSO' {
    const temCabecalho = /funcion[áa]rio|cnpj|empresa|m[eê]s:/i.test(allText);
    const temTabelaTotais =
      /normais|extras|saldo a receber|total do desconto/i.test(allText);
    const temAssinatura =
      /recebi o saldo|assinatura do empregado/i.test(allText);
    const primeiroDia = this.extrairPrimeiroDia(table);

    // Frente: tem cabecalho com dados do funcionario e comeca nos primeiros dias
    if (temCabecalho && primeiroDia <= 5) {
      return 'QUINZENAL_FRENTE';
    }

    // Verso: sem cabecalho e tem indicadores de totais/assinatura
    if (!temCabecalho && (temTabelaTotais || temAssinatura)) {
      return 'QUINZENAL_VERSO';
    }

    // Verso: primeiro dia >= 14 (quinzenal verso tipicamente comeca em 14, 15 ou 16)
    if (primeiroDia >= 14) {
      return 'QUINZENAL_VERSO';
    }

    // Verso: sem cabecalho e forte indicador (frente sempre tem nome/empresa)
    if (!temCabecalho && primeiroDia >= 10) {
      return 'QUINZENAL_VERSO';
    }

    // Default: assume frente
    return 'QUINZENAL_FRENTE';
  }

  /**
   * Extrai o primeiro numero de dia encontrado na tabela.
   */
  private extrairPrimeiroDia(table: OcrTable): number {
    const dataCells = table.cells
      .filter((c) => !c.isHeader)
      .sort((a, b) => a.rowIndex - b.rowIndex || a.columnIndex - b.columnIndex);

    for (const cell of dataCells) {
      const match = cell.content.trim().match(/^(\d{1,2})$/);
      if (match) {
        const num = parseInt(match[1], 10);
        if (num >= 1 && num <= 31) {
          return num;
        }
      }
    }

    return 1;
  }

  /**
   * Tenta extrair o nome do funcionario a partir do texto OCR.
   */
  private extrairFuncionarioDoTexto(lines: string[]): string | null {
    for (const line of lines) {
      // Patterns: "Nome: João Silva", "Funcionário: João Silva"
      const match = line.match(
        /(?:nome|funcion[áa]rio)\s*[:]\s*(.+)/i,
      );
      if (match) {
        const nome = match[1].trim();
        if (nome.length > 2) return nome;
      }
    }
    return null;
  }

  private result(
    pageNumber: number,
    pageType: PageTypeEnum,
    subFormat: string | null,
    confidence: number,
    shouldProcess: boolean,
    classifierData: Record<string, unknown>,
  ): PageClassificationResult {
    this.logger.log(`[Classifier] Page ${pageNumber}: ${pageType}`, {
      pageNumber,
      pageType,
      subFormat,
      confidence,
      shouldProcess,
    });

    // Log extra detail for quinzenal sub-type debugging
    if (classifierData.quinzenalSubType) {
      this.logger.debug(`[Classifier] Page ${pageNumber} quinzenalSubType: ${classifierData.quinzenalSubType}`, {
        pageNumber,
        quinzenalSubType: classifierData.quinzenalSubType,
      });
    }

    return {
      pageNumber,
      pageType,
      subFormat,
      confidence,
      shouldProcess,
      classifierData,
    };
  }
}
