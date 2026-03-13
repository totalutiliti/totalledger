import { Injectable, Logger } from '@nestjs/common';
import { OcrRawResult, OcrTable, OcrTableCell } from './document-intelligence.service';

/**
 * Resultado da extracao de tabela limpa do DI Layout.
 */
export interface DiCleanTableResult {
  /** Numero da pagina */
  pageNumber: number;
  /** Nomes das colunas detectadas */
  colunas: string[];
  /** Dados limpos: array de objetos {coluna: valor} */
  dados: Record<string, string | null>[];
  /** Dimensao da tabela (ex: "32x8") */
  dimensao: string;
  /** Texto formatado pronto para enviar ao modelo */
  textoFormatado: string;
}

/**
 * Extrai tabelas limpas do resultado do Azure DI Layout.
 *
 * Converte a saida bruta do DI (com cells, boundingRegions, etc.)
 * em uma tabela estruturada simples com colunas nomeadas e dados.
 * Similar ao script Python azure_di_saida_limpa.py.
 */
@Injectable()
export class DiCleanTableExtractorService {
  private readonly logger = new Logger(DiCleanTableExtractorService.name);

  /**
   * Extrai tabela limpa para uma pagina especifica.
   * Seleciona a tabela com mais celulas se houver multiplas.
   */
  extrairPagina(
    ocrResult: OcrRawResult,
    pageNumber: number,
  ): DiCleanTableResult | null {
    // Filtrar tabelas desta pagina
    const tablesForPage = ocrResult.tables.filter(
      (t) => t.pageNumber === pageNumber,
    );

    if (tablesForPage.length === 0) {
      this.logger.debug(
        `[DiCleanTable] Pagina ${pageNumber}: nenhuma tabela encontrada`,
      );
      return null;
    }

    // Selecionar tabela com mais celulas (ignora tabelas resumo)
    const table = tablesForPage.reduce((best, t) =>
      t.cells.length > best.cells.length ? t : best,
    );

    return this.processTable(table, pageNumber);
  }

  /**
   * Extrai tabelas limpas de todas as paginas.
   */
  extrairTodas(
    ocrResult: OcrRawResult,
  ): Map<number, DiCleanTableResult> {
    const result = new Map<number, DiCleanTableResult>();

    const pageNumbers = new Set(ocrResult.pages.map((p) => p.pageNumber));

    for (const pageNumber of pageNumbers) {
      const cleanTable = this.extrairPagina(ocrResult, pageNumber);
      if (cleanTable) {
        result.set(pageNumber, cleanTable);
      }
    }

    return result;
  }

  /**
   * Processa uma tabela do DI e retorna dados limpos.
   */
  private processTable(
    table: OcrTable,
    pageNumber: number,
  ): DiCleanTableResult {
    const { rowCount, columnCount, cells } = table;

    // Montar grid
    const grid: (string | null)[][] = Array.from(
      { length: rowCount },
      () => Array.from({ length: columnCount }, () => null),
    );

    for (const cell of cells) {
      const content = cell.content?.trim() || null;
      grid[cell.rowIndex][cell.columnIndex] = content;

      // Expandir columnSpan
      const colSpan = cell.columnSpan ?? 1;
      for (let c = 1; c < colSpan; c++) {
        const targetCol = cell.columnIndex + c;
        if (targetCol < columnCount) {
          grid[cell.rowIndex][targetCol] = content;
        }
      }
    }

    // Detectar header rows
    const headerRows = new Set<number>();
    for (const cell of cells) {
      if (cell.isHeader) {
        headerRows.add(cell.rowIndex);
      }
    }

    const maxHeaderRow = headerRows.size > 0 ? Math.max(...headerRows) : 0;

    // Construir nomes de colunas
    const colNames = this.buildColumnNames(grid, cells, columnCount, maxHeaderRow);

    // Extrair dados (linhas apos headers)
    const dados: Record<string, string | null>[] = [];
    for (let r = maxHeaderRow + 1; r < rowCount; r++) {
      const rowData: Record<string, string | null> = {};
      let allEmpty = true;

      for (let c = 0; c < columnCount; c++) {
        const val = grid[r][c];
        rowData[colNames[c]] = val;
        if (val) allEmpty = false;
      }

      if (!allEmpty) {
        dados.push(rowData);
      }
    }

    // Formatar como texto legivel para o modelo
    const textoFormatado = this.formatarTexto(colNames, dados);

    this.logger.debug(
      `[DiCleanTable] Pagina ${pageNumber}: ${dados.length} linhas, ${colNames.length} colunas`,
    );

    return {
      pageNumber,
      colunas: colNames,
      dados,
      dimensao: `${rowCount}x${columnCount}`,
      textoFormatado,
    };
  }

  /**
   * Constroi nomes de colunas compostos (suporta multi-level headers).
   */
  private buildColumnNames(
    grid: (string | null)[][],
    cells: OcrTableCell[],
    columnCount: number,
    maxHeaderRow: number,
  ): string[] {
    if (maxHeaderRow === 0) {
      // Header simples (1 linha)
      const names: string[] = [];
      const seen: Record<string, number> = {};

      for (let c = 0; c < columnCount; c++) {
        const base = grid[0][c] ?? `col_${c}`;
        if (base in seen) {
          seen[base]++;
          names.push(`${base}_${seen[base]}`);
        } else {
          seen[base] = 0;
          names.push(base);
        }
      }

      return names;
    }

    // Multi-level: propagar spans do row 0
    const groupNames: (string | null)[] = Array(columnCount).fill(null);
    for (const cell of cells) {
      if (cell.rowIndex === 0) {
        const colSpan = cell.columnSpan ?? 1;
        const name = cell.content?.trim() || '';
        for (let cc = cell.columnIndex; cc < cell.columnIndex + colSpan && cc < columnCount; cc++) {
          groupNames[cc] = name;
        }
      }
    }

    // Combinar grupo + subheader
    const colNames: string[] = [];
    for (let c = 0; c < columnCount; c++) {
      const group = groupNames[c] || '';
      const sub = grid[maxHeaderRow][c]?.trim() || '';

      if (group && sub) {
        colNames.push(`${group}_${sub}`);
      } else if (group) {
        colNames.push(group);
      } else if (sub) {
        colNames.push(sub);
      } else {
        colNames.push(`col_${c}`);
      }
    }

    return colNames;
  }

  /**
   * Formata a tabela como texto legivel para enviar ao GPT-5.2.
   * Formato: linhas com "Dia | Semana | Entrada | Saida | ..."
   */
  private formatarTexto(
    colunas: string[],
    dados: Record<string, string | null>[],
  ): string {
    const linhas: string[] = [];

    // Header
    linhas.push(colunas.join(' | '));
    linhas.push(colunas.map(() => '---').join(' | '));

    // Dados
    for (const row of dados) {
      const valores = colunas.map((col) => row[col] ?? '-');
      linhas.push(valores.join(' | '));
    }

    return linhas.join('\n');
  }
}
