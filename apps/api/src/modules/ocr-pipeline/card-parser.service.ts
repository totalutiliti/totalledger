import { Injectable, Logger } from '@nestjs/common';
import { TipoCartao } from '@prisma/client';
import { OcrRawResult, OcrTable, OcrTableCell, OcrLine } from './document-intelligence.service';

export interface ParsedCard {
  header: ParsedHeader;
  batidas: ParsedBatida[];
  tipoCartao: TipoCartao;
}

export interface ParsedHeader {
  nomeExtraido: string | null;
  cargoExtraido: string | null;
  mesExtraido: string | null;
  empresaExtraida: string | null;
  cnpjExtraido: string | null;
  horarioContratual: string | null;
}

export interface ParsedBatida {
  dia: number;
  diaSemana: string | null;
  entradaManha: string | null;
  saidaManha: string | null;
  entradaTarde: string | null;
  saidaTarde: string | null;
  entradaExtra: string | null;
  saidaExtra: string | null;
  confidences: Record<string, number>;
  isManuscrito: boolean;
}

@Injectable()
export class CardParserService {
  private readonly logger = new Logger(CardParserService.name);

  parse(ocrResult: OcrRawResult, pageNumber = 1): ParsedCard {
    const page = ocrResult.pages.find((p) => p.pageNumber === pageNumber);
    const table = ocrResult.tables.find((t) => t.pageNumber === pageNumber);

    const header = this.extractHeader(page?.lines ?? []);
    const batidas = table ? this.extractBatidas(table) : [];
    const tipoCartao = this.detectTipoCartao(batidas);

    this.logger.log('Card parsed', {
      pageNumber,
      headerFields: Object.values(header).filter(Boolean).length,
      batidasCount: batidas.length,
      tipoCartao,
    });

    return { header, batidas, tipoCartao };
  }

  private extractHeader(lines: OcrLine[]): ParsedHeader {
    const header: ParsedHeader = {
      nomeExtraido: null,
      cargoExtraido: null,
      mesExtraido: null,
      empresaExtraida: null,
      cnpjExtraido: null,
      horarioContratual: null,
    };

    for (const line of lines) {
      const content = line.content.trim();

      // Try to extract empresa
      const empresaMatch = content.match(/empresa[:\s]*(.+)/i);
      if (empresaMatch) {
        header.empresaExtraida = empresaMatch[1].trim();
        continue;
      }

      // CNPJ
      const cnpjMatch = content.match(/cnpj[:\s]*(\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2})/i);
      if (cnpjMatch) {
        header.cnpjExtraido = cnpjMatch[1].replace(/[.\/-]/g, '');
        continue;
      }

      // Funcionário/Nome
      const funcMatch = content.match(/funcion[áa]rio[:\s]*(.+)/i) ?? content.match(/nome[:\s]*(.+)/i);
      if (funcMatch) {
        header.nomeExtraido = funcMatch[1].trim();
        continue;
      }

      // Cargo
      const cargoMatch = content.match(/cargo[:\s]*(.+)/i);
      if (cargoMatch) {
        header.cargoExtraido = cargoMatch[1].trim();
        continue;
      }

      // Mês
      const mesMatch = content.match(/m[eê]s[:\s]*(\d{1,2}\/?\d{4})/i);
      if (mesMatch) {
        header.mesExtraido = mesMatch[1].trim();
        continue;
      }

      // Horário contratual
      const horarioMatch = content.match(/hor[áa]rio[:\s]*(.+)/i);
      if (horarioMatch) {
        header.horarioContratual = horarioMatch[1].trim();
        continue;
      }
    }

    return header;
  }

  private extractBatidas(table: OcrTable): ParsedBatida[] {
    const batidas: ParsedBatida[] = [];

    // Detect multi-row headers and find where data starts
    const { columnMap, dataStartRow } = this.detectHeadersAndMap(table);

    this.logger.log('Column mapping result', {
      columnMap,
      dataStartRow,
      tableRowCount: table.rowCount,
      tableColumnCount: table.columnCount,
      totalCells: table.cells.length,
    });

    // Log all header cells for debugging
    const headerCells = table.cells.filter((c) => c.rowIndex < dataStartRow);
    this.logger.debug('Header cells', {
      headers: headerCells.map((c) => ({
        row: c.rowIndex,
        col: c.columnIndex,
        span: c.columnSpan,
        rowSpan: c.rowSpan,
        content: c.content,
      })),
    });

    // Process data rows (skip header rows)
    for (let rowIdx = dataStartRow; rowIdx < table.rowCount; rowIdx++) {
      const rowCells = table.cells.filter((c) => c.rowIndex === rowIdx);
      if (rowCells.length === 0) continue;

      const diaCell = rowCells.find((c) => c.columnIndex === columnMap.dia);
      const diaContent = diaCell?.content?.trim() ?? '';

      // Try to parse the day number — OCR may return artifacts like "#02", "?", "en" etc.
      const diaDigits = diaContent.replace(/[^0-9]/g, '');
      let dia = parseInt(diaDigits, 10);

      // If the day column only has a single digit (e.g. "3"), infer from row position
      // This handles cases where OCR only captured the last digit
      if (isNaN(dia) || dia < 1 || dia > 31) {
        // Try to infer sequential day from previous batidas
        const lastDia = batidas.length > 0 ? batidas[batidas.length - 1].dia : 0;
        const inferredDia = lastDia + 1;
        if (inferredDia >= 1 && inferredDia <= 31) {
          // Only infer if the row has some time data
          const hasTimeData = rowCells.some(
            (c) => c.columnIndex !== columnMap.dia && /\d{1,2}[.:]\d{2}/.test(c.content),
          );
          if (hasTimeData) {
            dia = inferredDia;
          } else {
            continue;
          }
        } else {
          continue;
        }
      }

      // Skip duplicate days
      if (batidas.some((b) => b.dia === dia)) continue;

      const getCell = (colKey: string) => {
        const colIdx = columnMap[colKey];
        if (colIdx === undefined) return null;
        const cell = rowCells.find((c) => c.columnIndex === colIdx);
        return cell ?? null;
      };

      const getCellContent = (colKey: string): string | null => {
        const cell = getCell(colKey);
        const content = cell?.content?.trim() ?? '';
        return content || null;
      };

      const getCellConfidence = (colKey: string): number => {
        const cell = getCell(colKey);
        return cell?.confidence ?? 0;
      };

      const entradaManha = this.normalizeTime(getCellContent('entradaManha'));
      const saidaManha = this.normalizeTime(getCellContent('saidaManha'));
      const entradaTarde = this.normalizeTime(getCellContent('entradaTarde'));
      const saidaTarde = this.normalizeTime(getCellContent('saidaTarde'));
      const entradaExtra = this.normalizeTime(getCellContent('entradaExtra'));
      const saidaExtra = this.normalizeTime(getCellContent('saidaExtra'));

      // Debug: log first 5 days and any day with missing data
      const hasMissing = (!entradaManha || !saidaManha || !entradaTarde || !saidaTarde) &&
        rowCells.some((c) => c.columnIndex !== columnMap.dia && c.content.trim().length > 0);
      if (dia <= 5 || hasMissing) {
        this.logger.debug(`Row debug dia=${dia}`, {
          allCells: rowCells.map((c) => ({
            col: c.columnIndex,
            content: c.content,
            confidence: c.confidence,
          })),
          mapped: {
            entradaManha: { raw: getCellContent('entradaManha'), normalized: entradaManha, col: columnMap.entradaManha },
            saidaManha: { raw: getCellContent('saidaManha'), normalized: saidaManha, col: columnMap.saidaManha },
            entradaTarde: { raw: getCellContent('entradaTarde'), normalized: entradaTarde, col: columnMap.entradaTarde },
            saidaTarde: { raw: getCellContent('saidaTarde'), normalized: saidaTarde, col: columnMap.saidaTarde },
          },
        });
      }

      // Detect if manuscrito based on confidence (all 6 fields)
      const avgConfidence = [
        getCellConfidence('entradaManha'),
        getCellConfidence('saidaManha'),
        getCellConfidence('entradaTarde'),
        getCellConfidence('saidaTarde'),
        getCellConfidence('entradaExtra'),
        getCellConfidence('saidaExtra'),
      ].filter((c) => c > 0);

      const avg =
        avgConfidence.length > 0
          ? avgConfidence.reduce((sum, c) => sum + c, 0) / avgConfidence.length
          : 0;
      const isManuscrito = avg < 0.75;

      batidas.push({
        dia,
        diaSemana: getCellContent('diaSemana'),
        entradaManha,
        saidaManha,
        entradaTarde,
        saidaTarde,
        entradaExtra,
        saidaExtra,
        confidences: {
          entradaManha: getCellConfidence('entradaManha'),
          saidaManha: getCellConfidence('saidaManha'),
          entradaTarde: getCellConfidence('entradaTarde'),
          saidaTarde: getCellConfidence('saidaTarde'),
          entradaExtra: getCellConfidence('entradaExtra'),
          saidaExtra: getCellConfidence('saidaExtra'),
        },
        isManuscrito,
      });
    }

    return batidas;
  }

  /**
   * Detect single or multi-row headers and build the column mapping.
   *
   * Supports two common layouts:
   *
   * Layout A (single header row):
   *   Row 0: Dia | Sem | Entrada | Saída | Entrada | Saída | ...
   *   Data starts at row 1.
   *
   * Layout B (two header rows — MANHÃ/TARDE/EXTRA):
   *   Row 0: <something> | MANHÃ      | TARDE        | EXTRA        | ...
   *   Row 1:              | Entrada | Saída | Entrada | Saída | Entrada | Saída
   *   Data starts at row 2 (or later if empty filler rows follow).
   */
  private detectHeadersAndMap(table: OcrTable): {
    columnMap: Record<string, number>;
    dataStartRow: number;
  } {
    const row0 = table.cells
      .filter((c) => c.rowIndex === 0)
      .sort((a, b) => a.columnIndex - b.columnIndex);
    const row1 = table.cells
      .filter((c) => c.rowIndex === 1)
      .sort((a, b) => a.columnIndex - b.columnIndex);

    // Check if row 0 uses the "MANHÃ / TARDE / EXTRA" category layout
    const row0Contents = row0.map((c) => c.content.toLowerCase().trim());
    const hasMultiRowCategories =
      row0Contents.some((c) => c.includes('manh')) ||
      row0Contents.some((c) => c.includes('tard'));
    // Only detect multi-row via columnSpan if the spanning cells are category headers
    // (not simple labels like "Dias" which can span day+weekday columns)
    const hasCategorySpans = row0.some((c) => {
      if ((c.columnSpan ?? 1) <= 1) return false;
      const content = c.content.toLowerCase().trim();
      return content.includes('manh') || content.includes('tard') || content.includes('extra');
    });
    const isMultiRowHeader = hasMultiRowCategories || (hasCategorySpans && row1.length > 0);

    if (isMultiRowHeader) {
      const columnMap = this.mapColumnsFromMultiRow(row0, row1);

      // Find first row with actual day data (skip empty filler rows after headers)
      let dataStartRow = 2;
      while (dataStartRow < table.rowCount) {
        const rowCells = table.cells.filter((c) => c.rowIndex === dataStartRow);
        const hasContent = rowCells.some((c) => c.content.trim().length > 0);
        if (hasContent) break;
        dataStartRow++;
      }

      this.logger.debug('Multi-row header detected', {
        columnMap,
        dataStartRow,
      });

      return { columnMap, dataStartRow };
    }

    // Single-row header (Layout A)
    const columnMap = this.mapColumnsSingleRow(row0);
    return { columnMap, dataStartRow: 1 };
  }

  /**
   * Map columns from a multi-row header layout.
   * Row 0 has category headers (MANHÃ col 1-2, TARDE col 3-4, EXTRA col 5-6)
   * using columnSpan to indicate how many sub-columns each category covers.
   * Row 1 has "Entrada" / "Saída" sub-headers.
   * Column 0 is typically the day number.
   */
  private mapColumnsFromMultiRow(
    row0: OcrTableCell[],
    row1: OcrTableCell[],
  ): Record<string, number> {
    const map: Record<string, number> = {};

    // Column 0 is always the day (even if labeled "Normal" or has no label)
    map.dia = 0;

    // Build category ranges from row 0, using columnSpan to determine extent
    // Each category cell covers [columnIndex, columnIndex + columnSpan - 1]
    interface CategoryRange {
      category: 'manha' | 'tarde' | 'extra';
      startCol: number;
      endCol: number; // inclusive
    }
    const categoryRanges: CategoryRange[] = [];

    const sortedRow0 = [...row0].sort((a, b) => a.columnIndex - b.columnIndex);
    for (const cell of sortedRow0) {
      const c = cell.content.toLowerCase().trim();
      const span = cell.columnSpan ?? 1;

      let category: 'manha' | 'tarde' | 'extra' | null = null;
      if (c.includes('manh')) {
        category = 'manha';
      } else if (c.includes('tard')) {
        category = 'tarde';
      } else if (c === 'extra' || (c.includes('extra') && !c.includes('h.'))) {
        category = 'extra';
      }

      if (category) {
        categoryRanges.push({
          category,
          startCol: cell.columnIndex,
          endCol: cell.columnIndex + span - 1,
        });
      }
    }

    this.logger.debug('Category ranges from row0', { categoryRanges });

    // Map sub-header "Entrada"/"Saída" from row 1, matched to category by column range
    for (const cell of row1) {
      const c = cell.content.toLowerCase().trim();
      const col = cell.columnIndex;
      const isEntrada = c.includes('entrada');
      const isSaida = c.includes('sa');

      if (!isEntrada && !isSaida) continue;

      // Find which category range this column belongs to
      const range = categoryRanges.find((r) => col >= r.startCol && col <= r.endCol);
      if (!range) continue;

      if (range.category === 'manha') {
        if (isEntrada) map.entradaManha = col;
        else if (isSaida) map.saidaManha = col;
      } else if (range.category === 'tarde') {
        if (isEntrada) map.entradaTarde = col;
        else if (isSaida) map.saidaTarde = col;
      } else if (range.category === 'extra') {
        if (isEntrada) map.entradaExtra = col;
        else if (isSaida) map.saidaExtra = col;
      }
    }

    // Fallback: if sub-headers didn't map, use positional within each category range
    for (const range of categoryRanges) {
      const prefix =
        range.category === 'manha' ? 'Manha' :
        range.category === 'tarde' ? 'Tarde' : 'Extra';

      const entradaKey = `entrada${prefix}`;
      const saidaKey = `saida${prefix}`;

      if (map[entradaKey] === undefined) {
        map[entradaKey] = range.startCol;
        if (range.endCol > range.startCol) {
          map[saidaKey] = range.startCol + 1;
        }
      }
    }

    this.logger.debug('Final column map (multi-row)', { map });

    return map;
  }

  /**
   * Map columns from a single header row (the original logic, improved).
   */
  private mapColumnsSingleRow(
    headerCells: OcrTableCell[],
  ): Record<string, number> {
    const map: Record<string, number> = {};

    // Sort by column index to process left-to-right
    const sorted = [...headerCells].sort((a, b) => a.columnIndex - b.columnIndex);

    for (const cell of sorted) {
      const content = cell.content.toLowerCase().trim();
      const span = cell.columnSpan ?? 1;

      if (content.includes('dia') && !content.includes('sem')) {
        map.dia = cell.columnIndex;
        // If "Dias" spans 2 columns, the second column is diaSemana
        if (span >= 2) {
          map.diaSemana = cell.columnIndex + 1;
        }
      } else if (content.includes('sem') || content.includes('d.s')) {
        map.diaSemana = cell.columnIndex;
      } else if (map.entradaManha === undefined && content.includes('entrada')) {
        map.entradaManha = cell.columnIndex;
      } else if (
        map.entradaManha !== undefined &&
        map.saidaManha === undefined &&
        (content.includes('sa') || content.includes('saída') || content.includes('saida'))
      ) {
        map.saidaManha = cell.columnIndex;
      } else if (map.saidaManha !== undefined && map.entradaTarde === undefined && content.includes('entrada')) {
        map.entradaTarde = cell.columnIndex;
      } else if (
        map.entradaTarde !== undefined &&
        map.saidaTarde === undefined &&
        (content.includes('sa') || content.includes('saída') || content.includes('saida'))
      ) {
        map.saidaTarde = cell.columnIndex;
      } else if (content.includes('extra')) {
        if (map.entradaExtra === undefined) {
          map.entradaExtra = cell.columnIndex;
        }
      }
    }

    // Fallback: if no specific mapping, assume positional order
    if (map.dia === undefined && sorted.length >= 6) {
      map.dia = 0;
      map.diaSemana = 1;
      map.entradaManha = 2;
      map.saidaManha = 3;
      map.entradaTarde = 4;
      map.saidaTarde = 5;
      if (sorted.length >= 8) {
        map.entradaExtra = 6;
        map.saidaExtra = 7;
      }
    }

    return map;
  }

  private normalizeTime(value: string | null): string | null {
    if (!value) return null;

    // Strip OCR artifacts (¥, #, =, $, ₦, §, -, leading/trailing non-digits)
    let cleaned = value.replace(/\s/g, '');
    cleaned = cleaned.replace(/[¥#=$₦§@!~^`'"]/g, '');
    cleaned = cleaned.replace(/[.,;]/g, ':');

    // Remove leading/trailing non-digit characters (except ":")
    cleaned = cleaned.replace(/^[^0-9]+/, '').replace(/[^0-9]+$/, '');

    // Match HH:MM or H:MM
    const matchColon = cleaned.match(/^(\d{1,2}):(\d{2})$/);
    if (matchColon) {
      const hours = parseInt(matchColon[1], 10);
      const minutes = parseInt(matchColon[2], 10);
      if (hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59) {
        return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
      }
    }

    // Match HHMM (4-5 digits without separator, e.g., "0700", "1102", "80658")
    const digits = cleaned.replace(/[^0-9]/g, '');
    if (digits.length === 4) {
      const hours = parseInt(digits.substring(0, 2), 10);
      const minutes = parseInt(digits.substring(2, 4), 10);
      if (hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59) {
        return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
      }
    }

    // 5 digits — could be leading artifact digit + HHMM (e.g. "80658" → "06:58")
    if (digits.length === 5) {
      // Try last 4 digits first
      const last4h = parseInt(digits.substring(1, 3), 10);
      const last4m = parseInt(digits.substring(3, 5), 10);
      if (last4h >= 0 && last4h <= 23 && last4m >= 0 && last4m <= 59) {
        return `${String(last4h).padStart(2, '0')}:${String(last4m).padStart(2, '0')}`;
      }
      // Try first 4 digits
      const first4h = parseInt(digits.substring(0, 2), 10);
      const first4m = parseInt(digits.substring(2, 4), 10);
      if (first4h >= 0 && first4h <= 23 && first4m >= 0 && first4m <= 59) {
        return `${String(first4h).padStart(2, '0')}:${String(first4m).padStart(2, '0')}`;
      }
    }

    // 3 digits — could be H:MM (e.g. "700" → "07:00")
    if (digits.length === 3) {
      const hours = parseInt(digits.substring(0, 1), 10);
      const minutes = parseInt(digits.substring(1, 3), 10);
      if (hours >= 0 && hours <= 9 && minutes >= 0 && minutes <= 59) {
        return `0${hours}:${String(minutes).padStart(2, '0')}`;
      }
    }

    return null; // Can't parse — return null, let TimeSanitizer handle correction
  }

  private detectTipoCartao(batidas: ParsedBatida[]): TipoCartao {
    if (batidas.length === 0) return TipoCartao.DESCONHECIDO;

    const manuscritoCount = batidas.filter((b) => b.isManuscrito).length;
    const ratio = manuscritoCount / batidas.length;

    if (ratio > 0.8) return TipoCartao.MANUSCRITO;
    if (ratio > 0.2) return TipoCartao.HIBRIDO;
    return TipoCartao.ELETRONICO;
  }
}
