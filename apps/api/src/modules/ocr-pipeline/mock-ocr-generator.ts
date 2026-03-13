import { createHash } from 'crypto';
import type { OcrRawResult, OcrPage, OcrLine, OcrTable, OcrTableCell } from './document-intelligence.service';

// ─── Seeded PRNG (Linear Congruential Generator) ───────────────────────────

class SeededRandom {
  private state: number;

  constructor(seed: number) {
    this.state = seed;
  }

  /** Returns a float in [0, 1) */
  next(): number {
    // LCG parameters (Numerical Recipes)
    this.state = (this.state * 1664525 + 1013904223) >>> 0;
    return this.state / 0x100000000;
  }

  /** Integer in [min, max] inclusive */
  nextInt(min: number, max: number): number {
    return Math.floor(this.next() * (max - min + 1)) + min;
  }

  /** Float in [min, max) */
  nextFloat(min: number, max: number): number {
    return this.next() * (max - min) + min;
  }

  /** Pick random element from array */
  pick<T>(arr: readonly T[]): T {
    return arr[Math.floor(this.next() * arr.length)];
  }
}

// ─── Data Pools ─────────────────────────────────────────────────────────────

const BRAZILIAN_NAMES: readonly string[] = [
  'Maria Aparecida Silva',
  'Carlos Eduardo Oliveira',
  'Ana Paula Ferreira',
  'José Roberto Santos',
  'Francisca das Chagas Lima',
  'Antônio Marcos Souza',
  'Luciana de Almeida Costa',
  'Pedro Henrique Rodrigues',
  'Juliana Cristina Pereira',
  'Marcos Vinícius Alves',
  'Sandra Regina Nascimento',
  'Fernando da Silva Barbosa',
  'Patrícia Gomes de Araújo',
  'Ricardo Almeida Monteiro',
  'Sandro Ramos',
  'Cláudia Ribeiro Carvalho',
  'Roberto Carlos Martins',
  'Rosângela de Souza Dias',
  'Wellington Oliveira Neto',
  'Adriana Lima Teixeira',
] as const;

const CARGOS: readonly string[] = [
  'Pedreiro',
  'Servente',
  'Eletricista',
  'Encanador',
  'Auxiliar Administrativo',
  'Motorista',
  'Carpinteiro',
  'Pintor',
  'Almoxarife',
  'Mestre de Obras',
  'Engenheiro Civil',
  'Técnico de Segurança',
  'Operador de Máquinas',
  'Soldador',
] as const;

const HORARIOS_CONTRATUAIS: readonly string[] = [
  '07:00-16:00 Int. 11:00-12:00',
  '08:00-17:00 Int. 12:00-13:00',
  '06:00-15:00 Int. 10:00-11:00',
  '07:30-16:30 Int. 11:30-12:30',
  '08:00-17:48 Int. 12:00-13:00',
] as const;

// ─── Confidence Profiles ────────────────────────────────────────────────────

type ConfidenceProfile = 'high' | 'medium' | 'low';

function getConfidenceRange(profile: ConfidenceProfile): { min: number; max: number } {
  switch (profile) {
    case 'high':
      return { min: 0.88, max: 0.99 };
    case 'medium':
      return { min: 0.75, max: 0.87 };
    case 'low':
      return { min: 0.45, max: 0.74 };
  }
}

function pickConfidenceProfile(rng: SeededRandom): ConfidenceProfile {
  const roll = rng.next();
  if (roll < 0.60) return 'high';
  if (roll < 0.85) return 'medium';
  return 'low';
}

// ─── Time Helpers ───────────────────────────────────────────────────────────

function parseHorarioContratual(horario: string): {
  entradaManha: number;
  saidaManha: number;
  entradaTarde: number;
  saidaTarde: number;
} {
  // Format: "07:00-16:00 Int. 11:00-12:00"
  const mainMatch = horario.match(/(\d{2}):(\d{2})-(\d{2}):(\d{2})/);
  const intMatch = horario.match(/Int\.\s*(\d{2}):(\d{2})-(\d{2}):(\d{2})/);

  const inicio = mainMatch ? parseInt(mainMatch[1], 10) * 60 + parseInt(mainMatch[2], 10) : 420;
  const fim = mainMatch ? parseInt(mainMatch[3], 10) * 60 + parseInt(mainMatch[4], 10) : 960;
  const intInicio = intMatch ? parseInt(intMatch[1], 10) * 60 + parseInt(intMatch[2], 10) : 660;
  const intFim = intMatch ? parseInt(intMatch[3], 10) * 60 + parseInt(intMatch[4], 10) : 720;

  return {
    entradaManha: inicio,
    saidaManha: intInicio,
    entradaTarde: intFim,
    saidaTarde: fim,
  };
}

function minutesToTime(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function getDayOfWeek(year: number, month: number, day: number): number {
  return new Date(year, month - 1, day).getDay();
}

function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

// ─── Mock Generator ─────────────────────────────────────────────────────────

function generatePageLines(
  rng: SeededRandom,
  profile: ConfidenceProfile,
  empresa: string,
  cnpj: string,
  nome: string,
  cargo: string,
  mes: string,
  horario: string,
): OcrLine[] {
  const confRange = getConfidenceRange(profile);
  const lineConf = () => rng.nextFloat(Math.max(confRange.min, 0.90), 0.99);

  return [
    { content: 'CARTÃO DE PONTO', confidence: lineConf(), boundingBox: [] },
    { content: `Empresa: ${empresa}`, confidence: lineConf(), boundingBox: [] },
    { content: `CNPJ: ${cnpj}`, confidence: rng.nextFloat(confRange.min, confRange.max), boundingBox: [] },
    { content: `Funcionário: ${nome}`, confidence: rng.nextFloat(confRange.min, confRange.max), boundingBox: [] },
    { content: `Cargo: ${cargo}`, confidence: lineConf(), boundingBox: [] },
    { content: `Mês: ${mes}`, confidence: lineConf(), boundingBox: [] },
    { content: `Horário: ${horario}`, confidence: lineConf(), boundingBox: [] },
  ];
}

function generatePageTable(
  rng: SeededRandom,
  pageNumber: number,
  profile: ConfidenceProfile,
  horario: string,
  mesReferencia: { year: number; month: number },
): OcrTable {
  const confRange = getConfidenceRange(profile);
  const schedule = parseHorarioContratual(horario);
  const totalDays = daysInMonth(mesReferencia.year, mesReferencia.month);

  // Decide how many days will have missing fields (1-2 per page)
  const missingDayCount = rng.nextInt(1, 2);
  const missingDays = new Set<number>();
  while (missingDays.size < missingDayCount) {
    // Pick a weekday to have missing data
    const candidate = rng.nextInt(1, totalDays);
    const dow = getDayOfWeek(mesReferencia.year, mesReferencia.month, candidate);
    if (dow !== 0 && dow !== 6) {
      missingDays.add(candidate);
    }
  }

  const cells: OcrTableCell[] = [];

  // Multi-row header (Layout B — matches real PDF structure)
  // Row 0: category headers with columnSpan
  // Col 0: blank / "Normal" (day number), rowSpan=2
  // Col 1: "MANHÃ" columnSpan=2 (covers Entrada + Saída)
  // Col 3: "TARDE" columnSpan=2
  // Col 5: "EXTRA" columnSpan=2
  // Col 7: "Obs." rowSpan=2
  cells.push(
    { rowIndex: 0, columnIndex: 0, columnSpan: 1, rowSpan: 2, content: 'Dia', confidence: 0.99, isHeader: true, boundingBox: [] },
    { rowIndex: 0, columnIndex: 1, columnSpan: 2, rowSpan: 1, content: 'MANHÃ', confidence: 0.99, isHeader: true, boundingBox: [] },
    { rowIndex: 0, columnIndex: 3, columnSpan: 2, rowSpan: 1, content: 'TARDE', confidence: 0.99, isHeader: true, boundingBox: [] },
    { rowIndex: 0, columnIndex: 5, columnSpan: 2, rowSpan: 1, content: 'EXTRA', confidence: 0.99, isHeader: true, boundingBox: [] },
    { rowIndex: 0, columnIndex: 7, columnSpan: 1, rowSpan: 2, content: 'Obs.', confidence: 0.99, isHeader: true, boundingBox: [] },
  );
  // Row 1: sub-headers
  cells.push(
    { rowIndex: 1, columnIndex: 1, columnSpan: 1, rowSpan: 1, content: 'Entrada', confidence: 0.99, isHeader: true, boundingBox: [] },
    { rowIndex: 1, columnIndex: 2, columnSpan: 1, rowSpan: 1, content: 'Saída', confidence: 0.99, isHeader: true, boundingBox: [] },
    { rowIndex: 1, columnIndex: 3, columnSpan: 1, rowSpan: 1, content: 'Entrada', confidence: 0.99, isHeader: true, boundingBox: [] },
    { rowIndex: 1, columnIndex: 4, columnSpan: 1, rowSpan: 1, content: 'Saída', confidence: 0.99, isHeader: true, boundingBox: [] },
    { rowIndex: 1, columnIndex: 5, columnSpan: 1, rowSpan: 1, content: 'Entrada', confidence: 0.99, isHeader: true, boundingBox: [] },
    { rowIndex: 1, columnIndex: 6, columnSpan: 1, rowSpan: 1, content: 'Saída', confidence: 0.99, isHeader: true, boundingBox: [] },
  );

  // Data rows (row 0 = first header, row 1 = sub-header, data starts at row 2)
  for (let day = 1; day <= totalDays; day++) {
    const rowIdx = day + 1; // +1 because row 0 = header, row 1 = sub-header
    const dow = getDayOfWeek(mesReferencia.year, mesReferencia.month, day);
    const isWeekend = dow === 0 || dow === 6;
    const isMissing = missingDays.has(day);

    // Day number (col 0)
    cells.push({
      rowIndex: rowIdx,
      columnIndex: 0,
      columnSpan: 1,
      rowSpan: 1,
      content: String(day).padStart(2, '0'),
      confidence: rng.nextFloat(0.95, 0.99),
      isHeader: false,
      boundingBox: [],
    });

    if (isWeekend || isMissing) {
      // Empty time cells for weekends/missing days (cols 1-6)
      for (let col = 1; col <= 6; col++) {
        cells.push({
          rowIndex: rowIdx,
          columnIndex: col,
          columnSpan: 1,
          rowSpan: 1,
          content: '',
          confidence: 0,
          isHeader: false,
          boundingBox: [],
        });
      }
    } else {
      // Generate realistic times with jitter
      const jitter = () => rng.nextInt(-15, 15);
      const entradaManha = schedule.entradaManha + jitter();
      const saidaManha = schedule.saidaManha + jitter();
      const entradaTarde = schedule.entradaTarde + jitter();
      const saidaTarde = schedule.saidaTarde + jitter();

      // cols 1-4: manhã entrada, manhã saída, tarde entrada, tarde saída
      const times = [entradaManha, saidaManha, entradaTarde, saidaTarde];
      times.forEach((t, i) => {
        cells.push({
          rowIndex: rowIdx,
          columnIndex: i + 1,
          columnSpan: 1,
          rowSpan: 1,
          content: minutesToTime(t),
          confidence: rng.nextFloat(confRange.min, confRange.max),
          isHeader: false,
          boundingBox: [],
        });
      });

      // cols 5-6: extra entrada, extra saída (usually empty)
      for (let col = 5; col <= 6; col++) {
        cells.push({
          rowIndex: rowIdx,
          columnIndex: col,
          columnSpan: 1,
          rowSpan: 1,
          content: '',
          confidence: 0,
          isHeader: false,
          boundingBox: [],
        });
      }
    }

    // Obs column (col 7, usually empty)
    cells.push({
      rowIndex: rowIdx,
      columnIndex: 7,
      columnSpan: 1,
      rowSpan: 1,
      content: '',
      confidence: 0.99,
      isHeader: false,
      boundingBox: [],
    });
  }

  return {
    pageNumber,
    rowCount: totalDays + 2, // +2 for the two header rows
    columnCount: 8,
    cells,
  };
}

export function generateMockOcrResult(
  pageCount: number,
  seed: number,
  mesReferencia?: { year: number; month: number },
): OcrRawResult {
  if (pageCount === 0) {
    return { pages: [], tables: [], rawResponse: { mock: true } };
  }

  const rng = new SeededRandom(seed);
  const mes = mesReferencia ?? { year: 2026, month: 3 };
  const mesFormatted = `${String(mes.month).padStart(2, '0')}/${mes.year}`;

  // Pick a single empresa for the whole document (realistic: 1 PDF = 1 empresa)
  const empresa = 'Construlaje Materiais de Construção Ltda';
  const cnpj = '46.260.666/0001-80';

  const pages: OcrPage[] = [];
  const tables: OcrTable[] = [];

  // Track used names to avoid duplicates within same document
  const usedNames = new Set<string>();

  for (let i = 0; i < pageCount; i++) {
    const pageNumber = i + 1;
    const profile = pickConfidenceProfile(rng);

    // Pick a unique name for this page
    let nome: string;
    let attempts = 0;
    do {
      nome = rng.pick(BRAZILIAN_NAMES);
      attempts++;
    } while (usedNames.has(nome) && attempts < 50);
    usedNames.add(nome);

    const cargo = rng.pick(CARGOS);
    const horario = rng.pick(HORARIOS_CONTRATUAIS);

    const lines = generatePageLines(
      rng,
      profile,
      empresa,
      cnpj,
      nome,
      cargo,
      mesFormatted,
      horario,
    );

    pages.push({
      pageNumber,
      width: 612,
      height: 792,
      lines,
    });

    tables.push(
      generatePageTable(rng, pageNumber, profile, horario, mes),
    );
  }

  return {
    pages,
    tables,
    rawResponse: { mock: true, pageCount, seed },
  };
}

export function hashBuffer(buffer: Buffer): number {
  const hash = createHash('md5').update(buffer).digest('hex');
  return parseInt(hash.substring(0, 8), 16);
}
