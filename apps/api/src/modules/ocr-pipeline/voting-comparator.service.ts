import { Injectable, Logger } from '@nestjs/common';
import {
  ExtracaoEstruturada,
  ComparacaoResult,
  DiaComparado,
  CampoDivergente,
  EstatisticasVotacao,
  VotoCampo,
  CabecalhoExtracao,
  TIME_FIELDS,
} from './ocr-pipeline.types';

/**
 * Compara os 3 resultados de extracao (Mini A, Mini B, Mini C) campo a campo
 * e decide o valor final por votacao majoritaria.
 *
 * Regras de confianca:
 * - 3/3 concordam: 1.0 (unanime)
 * - A e B concordam (ambos visao): 0.90
 * - A ou B concorda com C (fonte independente): 0.85
 * - 3 valores diferentes: 0.0 (divergente, requer fallback 5.2)
 */
@Injectable()
export class VotingComparatorService {
  private readonly logger = new Logger(VotingComparatorService.name);

  comparar(
    miniA: ExtracaoEstruturada,
    miniB: ExtracaoEstruturada,
    miniC: ExtracaoEstruturada,
  ): ComparacaoResult {
    const resultadoPorDia: DiaComparado[] = [];
    const camposDivergentes: CampoDivergente[] = [];

    let concordancia3de3 = 0;
    let concordancia2de3 = 0;
    let divergenciaTotal = 0;

    const diasMerged = this.mergeDias(miniA.dias, miniB.dias, miniC.dias);

    for (const diaMerged of diasMerged) {
      const diaNum = diaMerged.numero;
      const diaSemana = diaMerged.diaSemana;

      const diaA = miniA.dias.find((d) => d.dia === diaNum);
      const diaB = miniB.dias.find((d) => d.dia === diaNum);
      const diaC = miniC.dias.find((d) => d.dia === diaNum);

      const confiancas: Record<string, number> = {};
      const fontes: Record<string, string> = {};
      const valores: Record<string, string | null> = {};

      for (const campo of TIME_FIELDS) {
        const valorA = diaA?.[campo as keyof typeof diaA] as string | null ?? null;
        const valorB = diaB?.[campo as keyof typeof diaB] as string | null ?? null;
        const valorC = diaC?.[campo as keyof typeof diaC] as string | null ?? null;

        const voto = this.votarCampo(valorA, valorB, valorC);

        valores[campo] = voto.valorFinal;
        confiancas[campo] = voto.confianca;
        fontes[campo] = voto.fonte;

        if (voto.divergente) {
          divergenciaTotal++;
          camposDivergentes.push({
            dia: diaNum,
            campo,
            valorA,
            valorB,
            valorC,
            motivo: voto.motivo ?? `A=${valorA}, B=${valorB}, C=${valorC}`,
          });
        } else if (voto.fonte === 'unanime') {
          concordancia3de3++;
        } else {
          concordancia2de3++;
        }
      }

      resultadoPorDia.push({
        dia: diaNum,
        diaSemana,
        entradaManha: valores.entradaManha ?? null,
        saidaManha: valores.saidaManha ?? null,
        entradaTarde: valores.entradaTarde ?? null,
        saidaTarde: valores.saidaTarde ?? null,
        entradaExtra: valores.entradaExtra ?? null,
        saidaExtra: valores.saidaExtra ?? null,
        confiancas,
        fontes,
      });
    }

    const totalCampos = resultadoPorDia.length * TIME_FIELDS.length;

    const estatisticas: EstatisticasVotacao = {
      totalCampos,
      concordancia3de3,
      concordancia2de3,
      divergenciaTotal,
    };

    const confiancaGeral = this.calcularConfiancaGeral(resultadoPorDia);

    this.logger.log('Voting comparison completed', {
      dias: resultadoPorDia.length,
      totalCampos,
      concordancia3de3,
      concordancia2de3,
      divergenciaTotal,
      confiancaGeral: confiancaGeral.toFixed(3),
    });

    return {
      cabecalho: this.votarCabecalho(
        miniA.cabecalho,
        miniB.cabecalho,
        miniC.cabecalho,
      ),
      dias: resultadoPorDia,
      camposDivergentes,
      precisaFallback: camposDivergentes.length > 0,
      confiancaGeral,
      estatisticas,
    };
  }

  private votarCampo(
    valorA: string | null,
    valorB: string | null,
    valorC: string | null,
  ): VotoCampo {
    const normA = this.normalizar(valorA);
    const normB = this.normalizar(valorB);
    const normC = this.normalizar(valorC);

    // Caso 1: 3/3 concordam (incluindo todos null)
    if (normA === normB && normB === normC) {
      return {
        valorFinal: valorA,
        confianca: 1.0,
        fonte: 'unanime',
        divergente: false,
      };
    }

    // Caso 2: 2/3 concordam
    // A e B (ambos com visao) concordam
    if (normA === normB) {
      return {
        valorFinal: valorA,
        confianca: 0.9,
        fonte: 'maioria_AB',
        divergente: false,
      };
    }

    // A concorda com C (fonte independente: visao + DI Read)
    if (normA === normC) {
      return {
        valorFinal: valorA,
        confianca: 0.85,
        fonte: 'maioria_AC',
        divergente: false,
      };
    }

    // B concorda com C
    if (normB === normC) {
      return {
        valorFinal: valorB,
        confianca: 0.85,
        fonte: 'maioria_BC',
        divergente: false,
      };
    }

    // Caso 3: 3 valores diferentes — divergencia total
    return {
      valorFinal: null,
      confianca: 0.0,
      fonte: 'divergente',
      divergente: true,
      motivo: `A=${valorA}, B=${valorB}, C=${valorC}`,
    };
  }

  private normalizar(horario: string | null): string | null {
    if (!horario) return null;
    const clean = horario.replace(/\s/g, '').replace('.', ':');
    const match = clean.match(/^(\d{1,2}):?(\d{2})$/);
    if (!match) return horario;
    return `${match[1].padStart(2, '0')}:${match[2]}`;
  }

  private votarCabecalho(
    a: CabecalhoExtracao,
    b: CabecalhoExtracao,
    c: CabecalhoExtracao,
  ): CabecalhoExtracao {
    return {
      nome: this.votarString(a.nome, b.nome, c.nome),
      empresa: this.votarString(a.empresa, b.empresa, c.empresa),
      cnpj: this.votarString(a.cnpj, b.cnpj, c.cnpj),
      cargo: this.votarString(a.cargo, b.cargo, c.cargo),
      mes: this.votarString(a.mes, b.mes, c.mes),
      horarioContratual: a.horarioContratual ?? b.horarioContratual ?? c.horarioContratual,
    };
  }

  private votarString(
    a: string | null,
    b: string | null,
    c: string | null,
  ): string | null {
    const normA = a?.trim().toLowerCase() ?? null;
    const normB = b?.trim().toLowerCase() ?? null;
    const normC = c?.trim().toLowerCase() ?? null;

    if (normA === normB && normA !== null) return a;
    if (normA === normC && normA !== null) return a;
    if (normB === normC && normB !== null) return b;
    return a ?? b ?? c;
  }

  private mergeDias(
    diasA: { dia: number; diaSemana: string | null }[],
    diasB: { dia: number; diaSemana: string | null }[],
    diasC: { dia: number; diaSemana: string | null }[],
  ): Array<{ numero: number; diaSemana: string | null }> {
    const diaSet = new Set<number>();
    const diaSemanaMap = new Map<number, string | null>();

    for (const fonte of [diasA, diasB, diasC]) {
      for (const d of fonte) {
        diaSet.add(d.dia);
        if (d.diaSemana && !diaSemanaMap.has(d.dia)) {
          diaSemanaMap.set(d.dia, d.diaSemana);
        }
      }
    }

    return [...diaSet]
      .sort((a, b) => a - b)
      .map((numero) => ({
        numero,
        diaSemana: diaSemanaMap.get(numero) ?? null,
      }));
  }

  private calcularConfiancaGeral(dias: DiaComparado[]): number {
    const allConf = dias.flatMap((d) =>
      Object.values(d.confiancas).filter((v) => v > 0),
    );
    if (allConf.length === 0) return 0;
    return allConf.reduce((sum, v) => sum + v, 0) / allConf.length;
  }
}
