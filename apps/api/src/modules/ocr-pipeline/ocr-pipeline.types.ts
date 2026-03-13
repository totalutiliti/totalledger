/**
 * Tipos centralizados do pipeline OCR otimizado.
 *
 * Fluxo: GPT-5 Mini (primario) → Consistencia → Outliers
 *        → [Fallback GPT-5.2 condicional] → Orquestrador → Revisao
 */

import { ScoredBatida } from './confidence-scorer.service';
import { ConsistencyIssue } from './consistency-validator.service';
import { PageClassificationResult } from './document-classifier.service';

// ──────────────────────────────────────────────
// Constantes compartilhadas
// ──────────────────────────────────────────────

export const TIME_FIELDS = [
  'entradaManha',
  'saidaManha',
  'entradaTarde',
  'saidaTarde',
  'entradaExtra',
  'saidaExtra',
] as const;

export type TimeField = (typeof TIME_FIELDS)[number];

// ──────────────────────────────────────────────
// Header extraido (compartilhado Mini e 5.2)
// ──────────────────────────────────────────────

export interface ExtractedHeader {
  nomeExtraido: string | null;
  empresaExtraida: string | null;
  mesExtraido: string | null;
  cargoExtraido: string | null;
  cnpjExtraido: string | null;
  horarioContratual: string | null;
}

// ──────────────────────────────────────────────
// GPT-5 Mini — resultado de extracao
// ──────────────────────────────────────────────

export interface MiniFieldResult {
  valor: string | null;
  confidence: number;
}

export interface MiniDiaResult {
  dia: number;
  diaSemana: string | null;
  entradaManha: MiniFieldResult;
  saidaManha: MiniFieldResult;
  entradaTarde: MiniFieldResult;
  saidaTarde: MiniFieldResult;
  entradaExtra: MiniFieldResult;
  saidaExtra: MiniFieldResult;
}

export interface MiniExtractionResult {
  header: ExtractedHeader;
  dias: MiniDiaResult[];
  miniFailed: boolean;
  tokensIn: number;
  tokensOut: number;
  latencyMs: number;
}

// ──────────────────────────────────────────────
// GPT-5.2 Vision — resultado de fallback
// ──────────────────────────────────────────────

export interface Gpt52FieldResult {
  valor: string | null;
  concordaMini: boolean;
  confidence: number;
  divergencia: string | null;
}

export interface Gpt52DiaResult {
  dia: number;
  entradaManha: Gpt52FieldResult;
  saidaManha: Gpt52FieldResult;
  entradaTarde: Gpt52FieldResult;
  saidaTarde: Gpt52FieldResult;
  entradaExtra: Gpt52FieldResult;
  saidaExtra: Gpt52FieldResult;
}

export interface Gpt52FallbackResult {
  dias: Gpt52DiaResult[];
  gpt52Failed: boolean;
  tokensIn: number;
  tokensOut: number;
  latencyMs: number;
}

// ──────────────────────────────────────────────
// Decision Source — fontes possiveis
// ──────────────────────────────────────────────

export type DecisionSource = 'MINI' | 'GPT52' | 'SANITIZER';

// ──────────────────────────────────────────────
// Pre-orchestrated — batida antes da decisao final
// ──────────────────────────────────────────────

export interface PreOrchestratedBatida extends ScoredBatida {
  /** Resultado do Mini para este dia */
  miniResult: MiniDiaResult;
  /** Se Mini falhou */
  miniFailed: boolean;
  /** Issues de consistencia detectadas */
  consistencyIssues: ConsistencyIssue[];
  /** Resultado do GPT-5.2 (se fallback foi acionado) */
  gpt52Result?: Gpt52DiaResult;
  /** Se GPT-5.2 falhou (quando chamado) */
  gpt52Failed?: boolean;
}

// ──────────────────────────────────────────────
// Field Decision — decisao por campo
// ──────────────────────────────────────────────

export interface FieldDecision {
  campo: string;
  valorFinal: string | null;
  fonteEscolhida: DecisionSource;
  confiancaLeitura: number;
  criticidadeNegocio: number;
  confiancaFinal: number;
  justificativa: string;
  needsReview: boolean;
  reviewReason: string | null;
}

// ──────────────────────────────────────────────
// Orchestrated Batida — resultado final
// ──────────────────────────────────────────────

export interface OrchestratedBatida {
  dia: number;
  diaSemana: string | null;
  entradaManha: string | null;
  saidaManha: string | null;
  entradaTarde: string | null;
  saidaTarde: string | null;
  entradaExtra: string | null;
  saidaExtra: string | null;
  confianca: Record<string, number>;
  isManuscrito: boolean;
  isInconsistente: boolean;
  isFaltaDia: boolean;
  needsReview: boolean;
  reviewReasons: string[];
  miniFailed: boolean;
  miniResult: MiniDiaResult;
  gpt52Failed?: boolean;
  gpt52Result?: Gpt52DiaResult;
  consistencyIssues: ConsistencyIssue[];
  decisions: Record<string, FieldDecision>;
}

// ──────────────────────────────────────────────
// Fallback trigger — avaliacao de necessidade
// ──────────────────────────────────────────────

export interface FallbackTriggerResult {
  /** Se o fallback GPT-5.2 deve ser acionado */
  trigger: boolean;
  /** Dias que precisam de verificacao */
  problematicDays: number[];
  /** Motivos do trigger */
  reasons: string[];
}

// ──────────────────────────────────────────────
// BullMQ Job Data — jobs por pagina
// ──────────────────────────────────────────────

export interface PageJobData {
  uploadId: string;
  tenantId: string;
  pageNumber: number;
  /** PNG da pagina codificado em base64 */
  pageImageBase64: string;
  /** Texto estruturado do DI para contexto auxiliar */
  diTextContent: string | null;
  /** Dados de classificacao da pagina */
  classificationData: PageClassificationResult;
  /** Dados de bounding box das celulas da tabela para crop */
  tableCellBounds: CellBoundingData[] | null;
}

export interface CellBoundingData {
  rowIndex: number;
  columnIndex: number;
  boundingBox: number[];
  content: string;
}

export interface ConsolidationJobData {
  uploadId: string;
  tenantId: string;
  totalPages: number;
  type: 'consolidate';
}

export interface UploadJobData {
  uploadId: string;
  tenantId: string;
}

// ──────────────────────────────────────────────
// Page Processing Result
// ──────────────────────────────────────────────

export interface PageProcessingResult {
  pageNumber: number;
  success: boolean;
  skipReason?: string;
  cartaoPontoId?: string;
  usedFallback?: boolean;
  fallbackDays?: number[];
}

// ──────────────────────────────────────────────
// Crop Region — para image cropper
// ──────────────────────────────────────────────

export interface CropRegion {
  /** Coordenada X em pixels na imagem (escala 2x) */
  x: number;
  /** Coordenada Y em pixels na imagem (escala 2x) */
  y: number;
  /** Largura da regiao em pixels */
  width: number;
  /** Altura da regiao em pixels */
  height: number;
  /** Label identificador (ex: "dia-15") */
  label: string;
}

// ══════════════════════════════════════════════════
// Pipeline v2 — Multi-Extrator com Votacao
// ══════════════════════════════════════════════════

/**
 * Saida estruturada compartilhada por Mini A, Mini B e Mini C.
 * Formato canonico para extracao de cartao de ponto.
 */
export interface ExtracaoEstruturada {
  cabecalho: CabecalhoExtracao;
  dias: DiaExtracao[];
  confianca: number;
  tipo: 'mensal' | 'quinzenal_1' | 'quinzenal_2';
  /** Token usage from GPT-5.2 (populated in pipeline v3) */
  tokensIn?: number;
  tokensOut?: number;
  latencyMs?: number;
}

export interface CabecalhoExtracao {
  nome: string | null;
  empresa: string | null;
  cnpj: string | null;
  cargo: string | null;
  mes: string | null;
  horarioContratual: HorarioContratualExtracao | null;
}

export interface HorarioContratualExtracao {
  segSex: string | null;
  sabado: string | null;
  intervalo: string | null;
}

export interface DiaExtracao {
  dia: number;
  diaSemana: string | null;
  entradaManha: string | null;
  saidaManha: string | null;
  entradaTarde: string | null;
  saidaTarde: string | null;
  entradaExtra: string | null;
  saidaExtra: string | null;
  observacao: string | null;
}

/**
 * Resultado do DI Read (texto OCR cru).
 */
export interface DiReadResult {
  textoCompleto: string;
  linhas: DiReadLine[];
}

export interface DiReadLine {
  texto: string;
  boundingBox: number[];
  confianca: number | null;
}

/**
 * Resultado da comparacao campo a campo (votacao).
 */
export interface ComparacaoResult {
  cabecalho: CabecalhoExtracao;
  dias: DiaComparado[];
  camposDivergentes: CampoDivergente[];
  precisaFallback: boolean;
  confiancaGeral: number;
  estatisticas: EstatisticasVotacao;
}

export interface DiaComparado {
  dia: number;
  diaSemana: string | null;
  entradaManha: string | null;
  saidaManha: string | null;
  entradaTarde: string | null;
  saidaTarde: string | null;
  entradaExtra: string | null;
  saidaExtra: string | null;
  confiancas: Record<string, number>;
  fontes: Record<string, string>;
}

export interface CampoDivergente {
  dia: number;
  campo: string;
  valorA: string | null;
  valorB: string | null;
  valorC: string | null;
  motivo: string;
}

export interface EstatisticasVotacao {
  totalCampos: number;
  concordancia3de3: number;
  concordancia2de3: number;
  divergenciaTotal: number;
}

export type VotoFonte =
  | 'unanime'
  | 'maioria_AB'
  | 'maioria_AC'
  | 'maioria_BC'
  | 'divergente';

export interface VotoCampo {
  valorFinal: string | null;
  confianca: number;
  fonte: VotoFonte;
  divergente: boolean;
  motivo?: string;
}

/**
 * Resultado do arbitro GPT-5.2.
 */
export interface ArbitroResult {
  resolucoes: ResolucaoArbitro[];
  gpt52Failed: boolean;
  tokensIn: number;
  tokensOut: number;
  latencyMs: number;
}

export interface ResolucaoArbitro {
  dia: number;
  campo: string;
  valorCorreto: string | null;
  confianca: number;
}

/**
 * Cartao agrupado (mensal ou quinzenal frente+verso).
 */
export interface CartaoAgrupado {
  id: string;
  paginas: PageClassificationResult[];
  tipo: 'mensal' | 'quinzenal';
  funcionario: string | null;
  paginaFrente: number;
  paginaVerso: number | null;
}

/**
 * Resultado do processamento v2 de uma pagina/cartao.
 */
export interface ProcessamentoV2Result {
  cabecalho: CabecalhoExtracao;
  batidas: ScoredBatida[];
  feedback: V2OcrFeedbackData[];
  confiancaGeral: number;
  usou5_2: boolean;
  estatisticas: EstatisticasVotacao;
  /** GPT-5.2 token usage (pipeline v3) */
  gpt52TokensIn?: number;
  gpt52TokensOut?: number;
  gpt52Chamadas?: number;
}

export interface V2OcrFeedbackData {
  dia: number;
  campo: string;
  valorMiniA: string | null;
  valorMiniB: string | null;
  valorMiniC: string | null;
  fonteDecisao: string;
  usouFallback: boolean;
  valorFinal: string | null;
}

/**
 * Subtipos de pagina quinzenal para classificador v2.
 */
export type PageSubType =
  | 'QUINZENAL_FRENTE'
  | 'QUINZENAL_VERSO';

/**
 * Dados do job BullMQ para processamento de cartao agrupado (v2).
 */
export interface CartaoJobData {
  uploadId: string;
  tenantId: string;
  cartaoId: string;
  tipo: 'mensal' | 'quinzenal';
  paginas: Array<{
    pageNumber: number;
    pageImageBase64: string;
    diTextContent: string | null;
    classificationData: PageClassificationResult;
    tableCellBounds: CellBoundingData[] | null;
  }>;
  /** PDF buffer base64 para DI Read (compartilhado) */
  pdfBufferBase64: string;
  /** Resultados do DI Read pre-computados por pagina */
  diReadResults: Record<number, DiReadResult>;
  /** Tabela limpa extraida do DI Layout (texto formatado) por pagina */
  diCleanTables?: Record<number, string>;
}
