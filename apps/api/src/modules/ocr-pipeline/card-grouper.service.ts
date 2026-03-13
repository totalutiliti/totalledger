import { Injectable, Logger } from '@nestjs/common';
import { v4 as uuid } from 'uuid';
import { PageClassificationResult } from './document-classifier.service';
import { CartaoAgrupado } from './ocr-pipeline.types';

/**
 * Agrupa paginas classificadas em cartoes (mensal ou quinzenal frente+verso).
 *
 * Logica puramente deterministica, sem chamada de API.
 * Roda apos a classificacao de todas as paginas e antes do enfileiramento dos jobs.
 *
 * Regra principal de pareamento quinzenal:
 * - Se pagina atual e QUINZENAL e tem nome de funcionario,
 *   e a proxima e QUINZENAL sem nome → sao frente + verso do mesmo cartao.
 * - Fallback: usa subType FRENTE/VERSO do classifier.
 */
@Injectable()
export class CardGrouperService {
  private readonly logger = new Logger(CardGrouperService.name);

  agrupar(paginasClassificadas: PageClassificationResult[]): CartaoAgrupado[] {
    const cartoes: CartaoAgrupado[] = [];
    let i = 0;

    while (i < paginasClassificadas.length) {
      const pagina = paginasClassificadas[i];

      // Pular paginas que nao sao cartao de ponto
      if (!pagina.shouldProcess) {
        i++;
        continue;
      }

      // Cartao mensal completo — 1 pagina
      if (pagina.pageType === 'CARTAO_PONTO_MENSAL') {
        cartoes.push({
          id: uuid(),
          paginas: [pagina],
          tipo: 'mensal',
          funcionario: this.extrairFuncionario(pagina),
          paginaFrente: pagina.pageNumber,
          paginaVerso: null,
        });
        i++;
        continue;
      }

      // Cartao quinzenal — tentar parear frente + verso
      if (pagina.pageType === 'CARTAO_PONTO_QUINZENAL') {
        const proxima = paginasClassificadas[i + 1];
        const funcionarioAtual = this.extrairFuncionario(pagina);
        const funcionarioProxima = proxima
          ? this.extrairFuncionario(proxima)
          : null;
        const subType = pagina.classifierData?.quinzenalSubType as
          | string
          | undefined;
        const proximaSubType = proxima?.classifierData?.quinzenalSubType as
          | string
          | undefined;

        this.logger.debug(
          `Pagina ${pagina.pageNumber}: quinzenal subType=${subType ?? 'undefined'}, funcionario=${funcionarioAtual ?? 'null'}, proxima=${proxima?.pageNumber ?? 'nenhuma'} tipo=${proxima?.pageType ?? '-'} subType=${proximaSubType ?? 'undefined'} funcionario=${funcionarioProxima ?? 'null'}`,
        );

        // Verificar se a proxima pagina e a segunda metade do mesmo cartao
        const proximaEQuinzenal =
          proxima?.pageType === 'CARTAO_PONTO_QUINZENAL' &&
          proxima.shouldProcess;

        if (proximaEQuinzenal) {
          const devemParear = this.devemParear(
            pagina,
            funcionarioAtual,
            subType,
            proxima,
            funcionarioProxima,
            proximaSubType,
          );

          if (devemParear) {
            this.logger.log(
              `Pagina ${pagina.pageNumber} + ${proxima.pageNumber}: pareadas como frente+verso`,
              {
                funcionario: funcionarioAtual,
                subTypeFrente: subType,
                subTypeVerso: proximaSubType,
              },
            );
            cartoes.push({
              id: uuid(),
              paginas: [pagina, proxima],
              tipo: 'quinzenal',
              funcionario: funcionarioAtual ?? funcionarioProxima,
              paginaFrente: pagina.pageNumber,
              paginaVerso: proxima.pageNumber,
            });
            i += 2;
            continue;
          }

          this.logger.warn(
            `Pagina ${pagina.pageNumber}: quinzenal NAO pareada com ${proxima.pageNumber} — cartoes separados`,
            {
              funcionarioAtual,
              funcionarioProxima,
              subType,
              proximaSubType,
            },
          );
        }

        // Quinzenal sem par — cartao incompleto (so frente ou so verso)
        cartoes.push({
          id: uuid(),
          paginas: [pagina],
          tipo: 'quinzenal',
          funcionario: funcionarioAtual,
          paginaFrente: pagina.pageNumber,
          paginaVerso: null,
        });
        this.logger.warn(
          `Pagina ${pagina.pageNumber}: quinzenal sem verso pareado. Proxima: ${proxima?.pageType ?? 'inexistente'}`,
        );
        i++;
        continue;
      }

      // Tipo nao processavel que passou o filtro — skip
      i++;
    }

    this.logger.log('Card grouping completed', {
      totalPaginas: paginasClassificadas.length,
      cartoesAgrupados: cartoes.length,
      mensais: cartoes.filter((c) => c.tipo === 'mensal').length,
      quinzenais: cartoes.filter((c) => c.tipo === 'quinzenal').length,
      quinzenaisPareados: cartoes.filter(
        (c) => c.tipo === 'quinzenal' && c.paginaVerso !== null,
      ).length,
    });

    return cartoes;
  }

  /**
   * Decide se duas paginas quinzenais consecutivas devem ser pareadas.
   *
   * Regras (em ordem de prioridade):
   * 1. Se ambas tem nome de funcionario DIFERENTE → NAO parear (cartoes distintos)
   * 2. Se a atual tem nome e a proxima NAO tem → PAREAR (frente + verso sem cabecalho)
   * 3. Se a proxima e explicitamente VERSO → PAREAR
   * 4. Se a proxima e explicitamente FRENTE → NAO parear (dois cartoes de frente)
   * 5. Se nenhuma tem nome e nenhuma tem subtype explicito → PAREAR (assume consecutivas)
   */
  private devemParear(
    _atual: PageClassificationResult,
    funcionarioAtual: string | null,
    subTypeAtual: string | undefined,
    _proxima: PageClassificationResult,
    funcionarioProxima: string | null,
    subTypeProxima: string | undefined,
  ): boolean {
    // Regra 1: Ambas tem nome mas DIFERENTE → cartoes distintos
    if (
      funcionarioAtual &&
      funcionarioProxima &&
      funcionarioAtual.toLowerCase() !== funcionarioProxima.toLowerCase()
    ) {
      return false;
    }

    // Regra 2: Atual tem nome, proxima NAO tem → frente + verso (verso nao repete cabecalho)
    if (funcionarioAtual && !funcionarioProxima) {
      return true;
    }

    // Regra 3: Proxima e explicitamente VERSO → parear
    if (subTypeProxima === 'QUINZENAL_VERSO') {
      return true;
    }

    // Regra 4: Proxima e explicitamente FRENTE → nao parear (dois cartoes diferentes)
    if (subTypeProxima === 'QUINZENAL_FRENTE') {
      return false;
    }

    // Regra 5: Atual e FRENTE (explicita ou default) e proxima sem subtipo → parear
    if (
      subTypeAtual === 'QUINZENAL_FRENTE' ||
      subTypeAtual === undefined
    ) {
      return true;
    }

    // Regra 6: Atual e VERSO — nao faz sentido parear verso + algo
    if (subTypeAtual === 'QUINZENAL_VERSO') {
      return false;
    }

    // Default: parear (consecutivas quinzenais normalmente sao par)
    return true;
  }

  private extrairFuncionario(
    pagina: PageClassificationResult,
  ): string | null {
    return (pagina.classifierData?.funcionarioDetectado as string) ?? null;
  }
}
