import { Injectable, Logger } from '@nestjs/common';
import { MiniVisionExtractorService } from './mini-vision-extractor.service';
import { DiReadExtractorService } from './di-read-extractor.service';
import { MiniTextTranslatorService } from './mini-text-translator.service';
import { VotingComparatorService } from './voting-comparator.service';
import { FallbackArbitratorService } from './fallback-arbitrator.service';
import { Gpt52DirectExtractorService } from './gpt52-direct-extractor.service';
import { ConsistencyValidatorService } from './consistency-validator.service';
import { OutlierDetectorService, OutlierFlag } from './outlier-detector.service';
import { ScoredBatida } from './confidence-scorer.service';
import { ResolvedOcrConfig } from './tenant-ocr-config.service';
import {
  ExtracaoEstruturada,
  ComparacaoResult,
  DiaComparado,
  CampoDivergente,
  ProcessamentoV2Result,
  V2OcrFeedbackData,
  DiReadResult,
  TIME_FIELDS,
} from './ocr-pipeline.types';

/**
 * Orquestrador Pipeline v2 — Duas estrategias:
 *
 * **Pipeline v3 (DI Clean + GPT-5.2 direto)** — PREFERIDO:
 * 1. Tabela limpa extraida do DI Layout (ja disponivel)
 * 2. GPT-5.2 recebe tabela + imagem → cruza fontes → extracao final
 * 3. Consistencia CLT + Outliers
 *
 * **Pipeline v2 (fallback)** — Multi-Extrator com Votacao:
 * 1. Mini A (visao) + Mini B (visao) + DI Read → Mini C (texto)
 * 2. Votacao campo a campo (3 fontes)
 * 3. Consistencia CLT + Outliers
 * 4. Fallback GPT-5.2 para divergencias
 */
@Injectable()
export class PipelineV2OrchestratorService {
  private readonly logger = new Logger(PipelineV2OrchestratorService.name);

  constructor(
    private readonly miniVision: MiniVisionExtractorService,
    private readonly diRead: DiReadExtractorService,
    private readonly miniTranslator: MiniTextTranslatorService,
    private readonly votingComparator: VotingComparatorService,
    private readonly fallbackArbitrator: FallbackArbitratorService,
    private readonly gpt52Direct: Gpt52DirectExtractorService,
    private readonly consistencyValidator: ConsistencyValidatorService,
    private readonly outlierDetector: OutlierDetectorService,
  ) {}

  // ══════════════════════════════════════════════════
  // Pipeline v3: DI Clean Table + GPT-5.2 Direto
  // ══════════════════════════════════════════════════

  /**
   * Processa uma pagina usando o pipeline v3 (DI Clean + GPT-5.2 direto).
   *
   * Fluxo:
   * 1. GPT-5.2 recebe tabela limpa do DI + imagem → extracao completa
   * 2. Consistencia CLT
   * 3. Deteccao de outliers
   * 4. Resultado final (sem votacao, sem fallback)
   */
  async processarPaginaDirect(
    imagemBase64: string,
    diCleanTable: string,
    pageNumber: number,
    _configTenant: ResolvedOcrConfig,
    tipoCartao: 'mensal' | 'quinzenal' = 'mensal',
    pageContext?: 'frente' | 'verso',
  ): Promise<ProcessamentoV2Result> {
    this.logger.log(
      `[Pipeline v3] Pagina ${pageNumber}: DI Clean + GPT-5.2 direto`,
    );

    // ═══════════════════════════════════════════════
    // PASSO 1: GPT-5.2 Direto (tabela limpa + imagem)
    // ═══════════════════════════════════════════════

    const extracao = await this.gpt52Direct.extrair(
      imagemBase64,
      diCleanTable,
      tipoCartao,
      pageContext,
    );

    // ═══════════════════════════════════════════════
    // PASSO 2: Converter para ScoredBatidas
    // ═══════════════════════════════════════════════

    const batidas = this.converterExtracaoParaScoredBatidas(extracao);

    // ═══════════════════════════════════════════════
    // PASSO 3: Consistencia CLT
    // ═══════════════════════════════════════════════

    const consistencia = this.consistencyValidator.validate(batidas);

    // ═══════════════════════════════════════════════
    // PASSO 4: Deteccao de outliers
    // ═══════════════════════════════════════════════

    this.outlierDetector.detect(consistencia);

    // ═══════════════════════════════════════════════
    // PASSO 5: Gerar feedback (sem votacao — fonte unica 5.2)
    // ═══════════════════════════════════════════════

    const feedback = this.gerarOcrFeedbackDirect(extracao);

    // Calcular confianca geral
    const allConf = batidas.flatMap((b) =>
      Object.values(b.confianca).filter((v) => v > 0),
    );
    const confiancaGeral =
      allConf.length > 0
        ? allConf.reduce((a, b) => a + b, 0) / allConf.length
        : extracao.confianca;

    this.logger.log(`[Pipeline v3] Pagina ${pageNumber} concluida`, {
      dias: extracao.dias.length,
      confianca52: extracao.confianca,
      confiancaGeral: confiancaGeral.toFixed(3),
    });

    return {
      cabecalho: extracao.cabecalho,
      batidas: consistencia,
      feedback,
      confiancaGeral,
      usou5_2: true,
      estatisticas: {
        totalCampos: extracao.dias.length * 6,
        concordancia3de3: extracao.dias.length * 6, // Fonte unica = "concordancia" total
        concordancia2de3: 0,
        divergenciaTotal: 0,
      },
    };
  }

  /**
   * Processa um cartao quinzenal usando pipeline v3 (2 paginas → merge).
   */
  async processarCartaoQuinzenalDirect(
    paginaFrente: { imagemBase64: string; diCleanTable: string },
    paginaVerso: { imagemBase64: string; diCleanTable: string },
    pageNumberFrente: number,
    pageNumberVerso: number,
    configTenant: ResolvedOcrConfig,
  ): Promise<ProcessamentoV2Result> {
    // Processar as duas paginas em paralelo (com contexto frente/verso)
    const [resultFrente, resultVerso] = await Promise.allSettled([
      this.processarPaginaDirect(
        paginaFrente.imagemBase64,
        paginaFrente.diCleanTable,
        pageNumberFrente,
        configTenant,
        'quinzenal',
        'frente',
      ),
      this.processarPaginaDirect(
        paginaVerso.imagemBase64,
        paginaVerso.diCleanTable,
        pageNumberVerso,
        configTenant,
        'quinzenal',
        'verso',
      ),
    ]);

    if (resultFrente.status === 'rejected') {
      throw new Error(
        `Frente (pag ${pageNumberFrente}) falhou: ${resultFrente.reason}`,
      );
    }

    const frente = resultFrente.value;

    if (resultVerso.status === 'rejected') {
      this.logger.warn(
        `[Pipeline v3] Verso (pag ${pageNumberVerso}) falhou, usando apenas frente`,
      );
      return frente;
    }

    const verso = resultVerso.value;

    // Rede de seguranca: corrigir dias do verso se GPT-5.2 nao renumerou
    this.corrigirDiasVerso(verso);

    // Validar merge
    const { temDuplicados } = this.validarMerge(frente, verso);

    // Merge: concatena dias das duas paginas
    const diasCompletos = [...frente.batidas, ...verso.batidas];
    const cabecalho = frente.cabecalho;
    let confiancaGeral = Math.min(
      frente.confiancaGeral,
      verso.confiancaGeral,
    );

    // Penalizar confianca severamente quando ha dias duplicados (merge corrompido)
    if (temDuplicados) {
      confiancaGeral = Math.max(0, confiancaGeral - 0.20);
    }

    // Roda consistencia e outliers no mes COMPLETO
    const consistencia = this.consistencyValidator.validate(diasCompletos);
    this.outlierDetector.detect(consistencia);

    const batidasFinais = consistencia.map((b) => ({
      ...b,
      needsReview:
        b.needsReview ||
        b.consistencyIssues.some(
          (i: { severity: string }) => i.severity === 'error',
        ),
    }));

    return {
      cabecalho,
      batidas: batidasFinais,
      feedback: [...frente.feedback, ...verso.feedback],
      confiancaGeral,
      usou5_2: true,
      estatisticas: {
        totalCampos:
          frente.estatisticas.totalCampos + verso.estatisticas.totalCampos,
        concordancia3de3:
          frente.estatisticas.concordancia3de3 +
          verso.estatisticas.concordancia3de3,
        concordancia2de3: 0,
        divergenciaTotal: 0,
      },
    };
  }

  /**
   * Converte ExtracaoEstruturada (saida do 5.2) para ScoredBatida[].
   */
  private converterExtracaoParaScoredBatidas(
    extracao: ExtracaoEstruturada,
  ): ScoredBatida[] {
    return extracao.dias.map((dia) => {
      const temHorario =
        dia.entradaManha || dia.saidaManha || dia.entradaTarde || dia.saidaTarde;

      // Confianca por campo: usa a confianca geral do 5.2
      const confianca: Record<string, number> = {};
      for (const campo of TIME_FIELDS) {
        const valor = dia[campo as keyof typeof dia] as string | null;
        confianca[campo] = valor ? extracao.confianca : 0;
      }

      return {
        dia: dia.dia,
        diaSemana: dia.diaSemana,
        entradaManha: dia.entradaManha,
        saidaManha: dia.saidaManha,
        entradaTarde: dia.entradaTarde,
        saidaTarde: dia.saidaTarde,
        entradaExtra: dia.entradaExtra,
        saidaExtra: dia.saidaExtra,
        confianca,
        isManuscrito: false,
        isInconsistente: false,
        isFaltaDia: !temHorario,
        needsReview: extracao.confianca < 0.8,
      };
    });
  }

  /**
   * Gera OcrFeedback para pipeline v3 (fonte unica GPT-5.2).
   */
  private gerarOcrFeedbackDirect(
    extracao: ExtracaoEstruturada,
  ): V2OcrFeedbackData[] {
    const feedback: V2OcrFeedbackData[] = [];

    for (const dia of extracao.dias) {
      for (const campo of TIME_FIELDS) {
        const valor = dia[campo as keyof typeof dia] as string | null;
        if (!valor) continue;

        feedback.push({
          dia: dia.dia,
          campo,
          valorMiniA: null,
          valorMiniB: null,
          valorMiniC: null,
          fonteDecisao: 'gpt52_direct',
          usouFallback: false,
          valorFinal: valor,
        });
      }
    }

    return feedback;
  }

  // ══════════════════════════════════════════════════
  // Pipeline v2 (legado): Multi-Extrator com Votacao
  // ══════════════════════════════════════════════════

  /**
   * Processa uma pagina individual do pipeline v2 (legado).
   */
  async processarPagina(
    imagemBase64: string,
    pdfBuffer: Buffer,
    pageNumber: number,
    configTenant: ResolvedOcrConfig,
    diReadPreComputado?: DiReadResult,
  ): Promise<ProcessamentoV2Result> {
    // ═══════════════════════════════════════════════
    // PASSO 1: Extracao paralela (3 fontes simultaneas)
    // ═══════════════════════════════════════════════

    const diReadPromise = diReadPreComputado
      ? Promise.resolve(diReadPreComputado)
      : this.diRead.extrair(pdfBuffer, pageNumber);

    const [resultMiniA, resultMiniB, resultDiRead] =
      await Promise.allSettled([
        this.miniVision.extrair(imagemBase64, 'A', configTenant),
        this.miniVision.extrair(imagemBase64, 'B', configTenant),
        diReadPromise,
      ]);

    // Se Mini A e Mini B falharam, nao ha como votar
    if (
      resultMiniA.status === 'rejected' &&
      resultMiniB.status === 'rejected'
    ) {
      this.logger.error(
        `[Pipeline v2] Pagina ${pageNumber}: Mini A e B falharam`,
      );
      throw new Error(
        'Mini A e Mini B falharam — fallback completo necessario',
      );
    }

    // ═══════════════════════════════════════════════
    // PASSO 1.5: Traduzir saida do DI Read via Mini C
    // ═══════════════════════════════════════════════

    let resultMiniC: ExtracaoEstruturada | null = null;

    if (resultDiRead.status === 'fulfilled') {
      try {
        resultMiniC = await this.miniTranslator.traduzir(
          resultDiRead.value,
          configTenant,
        );
      } catch (err: unknown) {
        const message =
          err instanceof Error ? err.message : 'Unknown error';
        this.logger.warn(
          `[Pipeline v2] Mini C (tradutor DI Read) falhou: ${message}`,
        );
      }
    }

    // ═══════════════════════════════════════════════
    // PASSO 2: Votacao campo a campo
    // ═══════════════════════════════════════════════

    const miniA =
      resultMiniA.status === 'fulfilled' ? resultMiniA.value : null;
    const miniB =
      resultMiniB.status === 'fulfilled' ? resultMiniB.value : null;
    const miniC = resultMiniC;

    const fontesDisponiveis = [miniA, miniB, miniC].filter(Boolean);
    if (fontesDisponiveis.length < 2) {
      this.logger.warn(
        `[Pipeline v2] Pagina ${pageNumber}: apenas ${fontesDisponiveis.length} fonte(s) — insuficiente para votacao`,
      );
      throw new Error(
        `Apenas ${fontesDisponiveis.length} fonte(s) disponivel(is) — minimo 2 para votacao`,
      );
    }

    const comparacao = this.votingComparator.comparar(
      miniA ?? this.criarExtracaoVazia(),
      miniB ?? this.criarExtracaoVazia(),
      miniC ?? this.criarExtracaoVazia(),
    );

    // ═══════════════════════════════════════════════
    // PASSO 3: Consistencia CLT (existente)
    // ═══════════════════════════════════════════════

    const batidas = this.converterParaScoredBatidas(comparacao);
    const consistencia = this.consistencyValidator.validate(batidas);

    // ═══════════════════════════════════════════════
    // PASSO 4: Deteccao de outliers (existente)
    // ═══════════════════════════════════════════════

    const outlierResult = this.outlierDetector.detect(consistencia);

    // ═══════════════════════════════════════════════
    // PASSO 5: Decidir se precisa do 5.2
    // ═══════════════════════════════════════════════

    const consistenciaPenalidade = consistencia.reduce((max, b) => {
      const maxPenalty = b.consistencyIssues?.reduce(
        (m: number, issue: { penalty: number }) =>
          Math.max(m, issue.penalty),
        0,
      ) ?? 0;
      return Math.max(max, maxPenalty);
    }, 0);

    const precisaFallback =
      comparacao.precisaFallback ||
      consistenciaPenalidade >= 0.25 ||
      outlierResult.batidaFlags.some((flags: OutlierFlag[]) =>
        flags.some((f) => {
          const confValues = Object.values(
            batidas.find((b) => b.dia === f.dia)?.confianca ?? {},
          ).filter((v) => v > 0);
          const avgConf =
            confValues.length > 0
              ? confValues.reduce((a, b) => a + b, 0) / confValues.length
              : 0;
          return avgConf < 0.8;
        }),
      );

    let usou5_2 = false;

    if (precisaFallback) {
      usou5_2 = true;

      // Juntar divergencias da votacao + campos com problemas de consistencia
      const todosCamposDuvidosos = this.juntarDivergencias(
        comparacao.camposDivergentes,
        consistencia,
        outlierResult.batidaFlags,
      );

      if (todosCamposDuvidosos.length > 0) {
        const resolucoes = await this.fallbackArbitrator.arbitrar(
          imagemBase64,
          todosCamposDuvidosos,
        );

        if (!resolucoes.gpt52Failed) {
          this.aplicarResolucoes(comparacao, resolucoes.resolucoes);
        }
      }
    }

    // ═══════════════════════════════════════════════
    // PASSO 6: Gerar resultado final
    // ═══════════════════════════════════════════════

    const batidasFinais = this.converterParaScoredBatidas(comparacao);
    const feedback = this.gerarOcrFeedback(
      miniA,
      miniB,
      miniC,
      comparacao,
      usou5_2,
    );

    this.logger.log(
      `[Pipeline v2] Pagina ${pageNumber} concluida`, {
        votacao: `${comparacao.estatisticas.concordancia3de3 + comparacao.estatisticas.concordancia2de3}/${comparacao.estatisticas.totalCampos} concordam`,
        divergencias: comparacao.estatisticas.divergenciaTotal,
        usou5_2,
        confiancaGeral: comparacao.confiancaGeral.toFixed(3),
      },
    );

    return {
      cabecalho: comparacao.cabecalho,
      batidas: batidasFinais,
      feedback,
      confiancaGeral: comparacao.confiancaGeral,
      usou5_2,
      estatisticas: comparacao.estatisticas,
    };
  }

  /**
   * Processa um cartao quinzenal (2 paginas → merge em 31 dias).
   */
  async processarCartaoQuinzenal(
    paginaFrente: {
      imagemBase64: string;
      diRead?: DiReadResult;
    },
    paginaVerso: {
      imagemBase64: string;
      diRead?: DiReadResult;
    },
    pdfBuffer: Buffer,
    pageNumberFrente: number,
    pageNumberVerso: number,
    configTenant: ResolvedOcrConfig,
  ): Promise<ProcessamentoV2Result> {
    // Processar as duas paginas em paralelo
    const [resultFrente, resultVerso] = await Promise.allSettled([
      this.processarPagina(
        paginaFrente.imagemBase64,
        pdfBuffer,
        pageNumberFrente,
        configTenant,
        paginaFrente.diRead,
      ),
      this.processarPagina(
        paginaVerso.imagemBase64,
        pdfBuffer,
        pageNumberVerso,
        configTenant,
        paginaVerso.diRead,
      ),
    ]);

    if (resultFrente.status === 'rejected') {
      throw new Error(
        `Frente (pag ${pageNumberFrente}) falhou: ${resultFrente.reason}`,
      );
    }

    const frente = resultFrente.value;

    // Se verso falhou, retorna so a frente (incompleto)
    if (resultVerso.status === 'rejected') {
      this.logger.warn(
        `[Pipeline v2] Verso (pag ${pageNumberVerso}) falhou, usando apenas frente`,
      );
      return frente;
    }

    const verso = resultVerso.value;

    // Rede de seguranca: corrigir dias do verso se extrator nao renumerou
    this.corrigirDiasVerso(verso);

    // Validar merge
    const { temDuplicados } = this.validarMerge(frente, verso);

    // Merge: concatena dias das duas paginas
    const diasCompletos = [...frente.batidas, ...verso.batidas];

    // Cabecalho vem da frente (verso nao tem)
    const cabecalho = frente.cabecalho;

    // Confianca geral e a menor das duas paginas
    let confiancaGeral = Math.min(
      frente.confiancaGeral,
      verso.confiancaGeral,
    );

    // Penalizar confianca severamente quando ha dias duplicados (merge corrompido)
    if (temDuplicados) {
      confiancaGeral = Math.max(0, confiancaGeral - 0.20);
    }

    // Roda consistencia e outliers no mes COMPLETO (31 dias)
    const consistencia = this.consistencyValidator.validate(diasCompletos);
    this.outlierDetector.detect(consistencia);

    // Se a re-validacao detectou problemas, atualizar flags
    const batidasFinais = consistencia.map((b) => ({
      ...b,
      needsReview:
        b.needsReview ||
        b.consistencyIssues.some(
          (i: { severity: string }) => i.severity === 'error',
        ),
    }));

    return {
      cabecalho,
      batidas: batidasFinais,
      feedback: [...frente.feedback, ...verso.feedback],
      confiancaGeral,
      usou5_2: frente.usou5_2 || verso.usou5_2,
      estatisticas: {
        totalCampos:
          frente.estatisticas.totalCampos + verso.estatisticas.totalCampos,
        concordancia3de3:
          frente.estatisticas.concordancia3de3 +
          verso.estatisticas.concordancia3de3,
        concordancia2de3:
          frente.estatisticas.concordancia2de3 +
          verso.estatisticas.concordancia2de3,
        divergenciaTotal:
          frente.estatisticas.divergenciaTotal +
          verso.estatisticas.divergenciaTotal,
      },
    };
  }

  // ──────────────────────────────────────────────
  // Helpers
  // ──────────────────────────────────────────────

  private converterParaScoredBatidas(
    comparacao: ComparacaoResult,
  ): ScoredBatida[] {
    return comparacao.dias.map((dia) => {
      const allConf = Object.values(dia.confiancas).filter((v) => v > 0);
      const avgConf =
        allConf.length > 0
          ? allConf.reduce((a, b) => a + b, 0) / allConf.length
          : 0;

      return {
        dia: dia.dia,
        diaSemana: dia.diaSemana,
        entradaManha: dia.entradaManha,
        saidaManha: dia.saidaManha,
        entradaTarde: dia.entradaTarde,
        saidaTarde: dia.saidaTarde,
        entradaExtra: dia.entradaExtra,
        saidaExtra: dia.saidaExtra,
        confianca: dia.confiancas,
        isManuscrito: avgConf > 0 && avgConf < 0.75,
        isInconsistente: false,
        isFaltaDia:
          !dia.entradaManha &&
          !dia.saidaManha &&
          !dia.entradaTarde &&
          !dia.saidaTarde,
        needsReview: avgConf > 0 && avgConf < 0.8,
      };
    });
  }

  private juntarDivergencias(
    camposVotacao: CampoDivergente[],
    consistencia: Array<{
      dia: number;
      consistencyIssues: Array<{
        campo?: string;
        severity: string;
        penalty: number;
      }>;
    }>,
    _outlierFlags: OutlierFlag[][],
  ): CampoDivergente[] {
    const result = [...camposVotacao];
    const existingKeys = new Set(
      camposVotacao.map((c) => `${c.dia}-${c.campo}`),
    );

    // Adicionar campos com erros de consistencia
    for (const batida of consistencia) {
      for (const issue of batida.consistencyIssues) {
        if (
          issue.severity === 'error' &&
          issue.campo &&
          !existingKeys.has(`${batida.dia}-${issue.campo}`)
        ) {
          result.push({
            dia: batida.dia,
            campo: issue.campo,
            valorA: null,
            valorB: null,
            valorC: null,
            motivo: `Consistencia: ${issue.severity}`,
          });
          existingKeys.add(`${batida.dia}-${issue.campo}`);
        }
      }
    }

    return result;
  }

  private aplicarResolucoes(
    comparacao: ComparacaoResult,
    resolucoes: Array<{
      dia: number;
      campo: string;
      valorCorreto: string | null;
      confianca: number;
    }>,
  ): void {
    for (const resolucao of resolucoes) {
      const dia = comparacao.dias.find((d) => d.dia === resolucao.dia);
      if (!dia) continue;

      const campo = resolucao.campo as keyof DiaComparado;
      if (campo in dia && typeof dia[campo] !== 'object') {
        (dia as unknown as Record<string, unknown>)[campo] = resolucao.valorCorreto;
        dia.confiancas[resolucao.campo] = resolucao.confianca;
        dia.fontes[resolucao.campo] = 'arbitro_5.2';
      }

      // Remover da lista de divergentes
      const idx = comparacao.camposDivergentes.findIndex(
        (c) => c.dia === resolucao.dia && c.campo === resolucao.campo,
      );
      if (idx >= 0) {
        comparacao.camposDivergentes.splice(idx, 1);
      }
    }

    // Recalcular se ainda precisa fallback
    comparacao.precisaFallback = comparacao.camposDivergentes.length > 0;
  }

  private gerarOcrFeedback(
    miniA: ExtracaoEstruturada | null,
    miniB: ExtracaoEstruturada | null,
    miniC: ExtracaoEstruturada | null,
    comparacao: ComparacaoResult,
    usouFallback: boolean,
  ): V2OcrFeedbackData[] {
    const feedback: V2OcrFeedbackData[] = [];

    for (const dia of comparacao.dias) {
      for (const campo of TIME_FIELDS) {
        const valorFinal = (dia as unknown as Record<string, unknown>)[campo] as
          | string
          | null;
        const valorA =
          (miniA?.dias.find((d) => d.dia === dia.dia) as
            | Record<string, unknown>
            | undefined)?.[campo] as string | null ?? null;
        const valorB =
          (miniB?.dias.find((d) => d.dia === dia.dia) as
            | Record<string, unknown>
            | undefined)?.[campo] as string | null ?? null;
        const valorC =
          (miniC?.dias.find((d) => d.dia === dia.dia) as
            | Record<string, unknown>
            | undefined)?.[campo] as string | null ?? null;

        // Skip if all null
        if (!valorFinal && !valorA && !valorB && !valorC) continue;

        feedback.push({
          dia: dia.dia,
          campo,
          valorMiniA: valorA,
          valorMiniB: valorB,
          valorMiniC: valorC,
          fonteDecisao: dia.fontes[campo] ?? 'unknown',
          usouFallback:
            usouFallback && dia.fontes[campo] === 'arbitro_5.2',
          valorFinal,
        });
      }
    }

    return feedback;
  }

  /**
   * Rede de seguranca: se o verso tem dias < 16, renumera para 16-31.
   * Isso acontece quando o GPT-5.2 extrai os dias literais da tabela DI
   * sem perceber que sao a segunda quinzena.
   */
  private corrigirDiasVerso(verso: ProcessamentoV2Result): void {
    const diasVerso = verso.batidas.map((b) => b.dia);
    const maxDia = Math.max(...diasVerso, 0);
    const minDia = Math.min(...diasVerso, 999);

    // Se todos os dias estao abaixo de 16, precisa renumerar
    if (maxDia <= 15 && diasVerso.length > 0) {
      const offset = 15; // dia 1 → 16, dia 2 → 17, ...
      this.logger.warn(
        `[Merge] Verso com dias ${minDia}-${maxDia}, renumerando +${offset} para segunda quinzena`,
      );
      for (const batida of verso.batidas) {
        batida.dia = batida.dia + offset;
      }
      return;
    }

    // Caso misto: alguns dias < 16, outros >= 16 (parcialmente errado)
    // Tenta detectar e corrigir pelo padrao mais provavel
    if (minDia < 16 && maxDia >= 16) {
      const diasBaixos = diasVerso.filter((d) => d < 16);
      const diasAltos = diasVerso.filter((d) => d >= 16);

      // Se maioria esta correta (>= 16), corrige apenas os baixos
      if (diasAltos.length >= diasBaixos.length) {
        this.logger.warn(
          `[Merge] Verso misto: ${diasBaixos.length} dias < 16, corrigindo +15`,
        );
        for (const batida of verso.batidas) {
          if (batida.dia < 16) {
            batida.dia = batida.dia + 15;
          }
        }
      }
    }
  }

  private validarMerge(
    frente: ProcessamentoV2Result,
    verso: ProcessamentoV2Result,
  ): { temDuplicados: boolean } {
    const diasFrente = frente.batidas.map((d) => d.dia);
    const diasVerso = verso.batidas.map((d) => d.dia);

    if (diasFrente.some((d) => d > 15)) {
      this.logger.warn(
        'Merge quinzenal: frente contem dias > 15 — possivel erro de classificacao',
      );
    }

    if (diasVerso.some((d) => d < 16)) {
      this.logger.warn(
        'Merge quinzenal: verso contem dias < 16 — possivel erro de classificacao',
      );
    }

    const todosDias = [...diasFrente, ...diasVerso];
    const duplicados = todosDias.filter(
      (d, i) => todosDias.indexOf(d) !== i,
    );
    if (duplicados.length > 0) {
      this.logger.error(
        `Merge quinzenal: dias duplicados: ${duplicados.join(', ')}`,
      );
    }

    return { temDuplicados: duplicados.length > 0 };
  }

  private criarExtracaoVazia(): ExtracaoEstruturada {
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
