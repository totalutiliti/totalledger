'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useAuth } from '@/hooks/use-auth';
import { api } from '@/lib/api';
import type { CartaoPontoRevisao, Batida, OcrFeedbackItem, ConsistencyIssue, OutlierFlag } from '@/lib/types';
import { ArrowLeft, Check, X, Crosshair, Save, ChevronsDown, ArrowDownFromLine, ArrowUpFromLine } from 'lucide-react';
import Link from 'next/link';
import TimeInput from '@/components/ui/time-input';

function getOverallConfidence(confianca: Record<string, number> | null): number {
  if (!confianca) return 0;
  const values = Object.values(confianca).filter((v) => typeof v === 'number' && v > 0);
  if (values.length === 0) return 0;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

/** Cell-level confidence color (background only) */
function cellConfidenceBg(confianca: number): string {
  if (confianca === 0) return '';
  if (confianca >= 0.9) return 'bg-green-50';
  if (confianca >= 0.8) return 'bg-yellow-50';
  if (confianca >= 0.6) return 'bg-orange-50';
  return 'bg-red-50';
}

/** Cell-level confidence border color for inputs */
function cellConfidenceBorder(confianca: number): string {
  if (confianca === 0) return 'border-gray-300';
  if (confianca >= 0.9) return 'border-green-300';
  if (confianca >= 0.8) return 'border-yellow-300';
  if (confianca >= 0.6) return 'border-orange-300';
  return 'border-red-400';
}

function confidenceText(confianca: number): string {
  if (confianca >= 0.9) return 'text-green-700';
  if (confianca >= 0.8) return 'text-yellow-700';
  if (confianca >= 0.6) return 'text-orange-600';
  return 'text-red-700';
}

/** Build tooltip text for a field including DI vs GPT info + violations */
function buildTooltip(
  field: string,
  fieldConf: number,
  feedback: OcrFeedbackItem | undefined,
  consistencyIssues: ConsistencyIssue[] | null | undefined,
  outlierFlags: OutlierFlag[] | null | undefined,
): string {
  const parts: string[] = [];

  parts.push(`Confiança: ${(fieldConf * 100).toFixed(0)}%`);

  if (feedback) {
    if (feedback.valorDi !== null) parts.push(`DI: ${feedback.valorDi}`);
    if (feedback.valorGpt !== null) parts.push(`GPT: ${feedback.valorGpt}`);
    if (feedback.concordaDiGpt === false) parts.push('⚡ DI ≠ GPT');
    if (feedback.valorHumano !== null) parts.push(`Humano: ${feedback.valorHumano}`);
  }

  // Field-specific consistency issues
  const fieldIssues = (consistencyIssues ?? []).filter((i) =>
    i.affectedFields.includes(field),
  );
  for (const issue of fieldIssues) {
    parts.push(`${issue.severity === 'error' ? '🔴' : issue.severity === 'warning' ? '🟡' : 'ℹ️'} ${issue.message}`);
  }

  // Field-specific outlier flags
  const fieldOutliers = (outlierFlags ?? []).filter((f) => f.campo === field);
  for (const flag of fieldOutliers) {
    parts.push(`📊 ${flag.message}`);
  }

  return parts.join('\n');
}

const TIME_FIELDS = [
  'entradaManha',
  'saidaManha',
  'entradaTarde',
  'saidaTarde',
  'entradaExtra',
  'saidaExtra',
] as const;

type TimeField = typeof TIME_FIELDS[number];

/** Maps display field name to the backend corrected field name for PATCH calls */
const CORRECTED_FIELD_MAP: Record<TimeField, string> = {
  entradaManha: 'entradaManhaCorrigida',
  saidaManha: 'saidaManhaCorrigida',
  entradaTarde: 'entradaTardeCorrigida',
  saidaTarde: 'saidaTardeCorrigida',
  entradaExtra: 'entradaExtraCorrigida',
  saidaExtra: 'saidaExtraCorrigida',
};

interface BatidaEdit {
  id: string;
  dia: number;
  diaSemana: string;
  entradaManha: string;
  saidaManha: string;
  entradaTarde: string;
  saidaTarde: string;
  entradaExtra: string;
  saidaExtra: string;
  confianca: Record<string, number> | null;
  overallConfianca: number;
  isManuscrito: boolean;
  isInconsistente: boolean;
  isFaltaDia: boolean;
  gptFailed?: boolean;
  consistencyIssues?: ConsistencyIssue[] | null;
  outlierFlags?: OutlierFlag[] | null;
  ocrFeedback?: OcrFeedbackItem[];
}

export default function RevisaoDetailPage() {
  const params = useParams();
  const router = useRouter();
  const { accessToken } = useAuth();
  const id = params.id as string;

  const [cartao, setCartao] = useState<CartaoPontoRevisao | null>(null);
  const [batidas, setBatidas] = useState<BatidaEdit[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [pdfError, setPdfError] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  /** Snapshot of original values loaded from server — used to detect changes */
  const originalBatidasRef = useRef<Map<string, Record<TimeField, string>>>(new Map());
  /** Track last focused table cell so shift buttons work after focus moves to button */
  const lastFocusedCellRef = useRef<{ row: number; col: string }>({ row: 0, col: '0' });

  /** Sincroniza o PDF na página do cartão atual */
  const syncPdfToCurrentPage = useCallback(() => {
    const page = cartao?.paginaPdf;
    if (!iframeRef.current || !pdfUrl || page == null) return;

    // Force reload: briefly clear src then restore after browser processes the clear
    const target = `${pdfUrl}#page=${page}`;
    iframeRef.current.src = 'about:blank';
    setTimeout(() => {
      if (iframeRef.current) {
        iframeRef.current.src = target;
      }
    }, 50);
  }, [pdfUrl, cartao?.paginaPdf]);

  const fetchCartao = useCallback(async () => {
    if (!accessToken || !id) return;
    try {
      const response = await api.get<CartaoPontoRevisao>(
        `/api/v1/revisao/${id}`,
        accessToken,
      );
      const data = response.data;
      setCartao(data);

      // Build snapshot of original values and map batidas for editing
      const snapshot = new Map<string, Record<TimeField, string>>();
      const editBatidas = (data.batidas ?? []).map((b: Batida) => {
        // Use corrected value if exists, otherwise original OCR value
        const values: Record<TimeField, string> = {
          entradaManha: b.entradaManhaCorrigida ?? b.entradaManha ?? '',
          saidaManha: b.saidaManhaCorrigida ?? b.saidaManha ?? '',
          entradaTarde: b.entradaTardeCorrigida ?? b.entradaTarde ?? '',
          saidaTarde: b.saidaTardeCorrigida ?? b.saidaTarde ?? '',
          entradaExtra: b.entradaExtraCorrigida ?? b.entradaExtra ?? '',
          saidaExtra: b.saidaExtraCorrigida ?? b.saidaExtra ?? '',
        };
        snapshot.set(b.id, { ...values });

        return {
          id: b.id,
          dia: b.dia,
          diaSemana: b.diaSemana ?? '',
          ...values,
          confianca: b.confianca,
          overallConfianca: getOverallConfidence(b.confianca),
          isManuscrito: b.isManuscrito,
          isInconsistente: b.isInconsistente,
          isFaltaDia: b.isFaltaDia,
          gptFailed: b.gptFailed,
          consistencyIssues: b.consistencyIssues,
          outlierFlags: b.outlierFlags,
          ocrFeedback: b.ocrFeedback,
        };
      });

      originalBatidasRef.current = snapshot;
      setBatidas(editBatidas);
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao carregar cartão');
    } finally {
      setLoading(false);
    }
  }, [accessToken, id]);

  useEffect(() => {
    void fetchCartao();
  }, [fetchCartao]);

  // Fetch PDF blob after cartao is loaded
  useEffect(() => {
    if (!cartao?.upload?.id || !accessToken) return;

    const fetchPdf = async () => {
      try {
        const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000';
        const response = await fetch(
          `${apiUrl}/api/v1/uploads/${cartao.upload!.id}/pdf`,
          { headers: { Authorization: `Bearer ${accessToken}` } },
        );
        if (!response.ok) throw new Error('Falha ao carregar PDF');
        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        setPdfUrl(url);
      } catch {
        setPdfError(true);
      }
    };

    void fetchPdf();

    return () => {
      if (pdfUrl) URL.revokeObjectURL(pdfUrl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cartao?.upload?.id, accessToken]);

  const updateBatida = (
    batidaId: string,
    field: TimeField,
    value: string,
  ) => {
    setBatidas((prev) =>
      prev.map((b) => (b.id === batidaId ? { ...b, [field]: value } : b)),
    );
  };

  /** Count how many fields were changed by the reviewer */
  /**
   * Pula o foco para a segunda metade da tabela (dia 16+) ou para o fim.
   * Encontra o input atualmente focado e avanca ~15 linhas.
   */
  const handleSkipBlock = useCallback(() => {
    const table = document.querySelector('table');
    if (!table) return;

    const { row: currentRow, col: currentColStr } = lastFocusedCellRef.current;
    const currentCol = Number(currentColStr);

    // Pula metade das batidas (quinzena) ou para o final
    const halfRows = Math.ceil(batidas.length / 2);
    const targetRow = currentRow + halfRows;

    // Tentar focar na mesma coluna da linha alvo
    const target = table.querySelector<HTMLInputElement>(
      `input[data-row="${targetRow}"][data-col="${currentCol}"]`,
    );
    if (target) {
      target.focus();
      requestAnimationFrame(() => target.select());
      target.scrollIntoView({ block: 'center', behavior: 'smooth' });
    } else {
      // Se não existe a linha, foca no último input da tabela
      const allInputs = table.querySelectorAll<HTMLInputElement>('input[data-row]');
      const lastInput = allInputs[allInputs.length - 1];
      if (lastInput) {
        lastInput.focus();
        requestAnimationFrame(() => lastInput.select());
        lastInput.scrollIntoView({ block: 'center', behavior: 'smooth' });
      }
    }
  }, [batidas.length]);

  /** Metadata fields that move together with time data during shift */
  const META_FIELDS = [
    'confianca',
    'overallConfianca',
    'isManuscrito',
    'isInconsistente',
    'isFaltaDia',
    'gptFailed',
    'consistencyIssues',
    'outlierFlags',
    'ocrFeedback',
  ] as const;

  /** Clear all data fields of a row (time + metadata) */
  const clearRowData = (row: BatidaEdit): void => {
    for (const field of TIME_FIELDS) {
      row[field] = '';
    }
    row.confianca = null;
    row.overallConfianca = 0;
    row.isManuscrito = false;
    row.isInconsistente = false;
    row.isFaltaDia = false;
    row.gptFailed = undefined;
    row.consistencyIssues = null;
    row.outlierFlags = null;
    row.ocrFeedback = undefined;
  };

  /** Copy time + metadata from src row to dst row */
  const copyRowData = (dst: BatidaEdit, src: BatidaEdit): void => {
    for (const field of TIME_FIELDS) {
      dst[field] = src[field];
    }
    for (const meta of META_FIELDS) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (dst as Record<string, any>)[meta] = (src as Record<string, any>)[meta];
    }
  };

  /** Re-focus a cell after state update */
  const refocusCell = (row: number, col: string): void => {
    const table = document.querySelector('table');
    if (!table) return;
    requestAnimationFrame(() => {
      const target = table.querySelector<HTMLInputElement>(
        `input[data-row="${row}"][data-col="${col}"]`,
      );
      if (target) {
        target.focus();
        target.select();
      }
    });
  };

  /**
   * Desloca os dados uma linha para baixo a partir da posição do cursor.
   * A linha atual fica em branco; a última linha perde os dados.
   */
  const handleShiftDown = useCallback(() => {
    const { row: currentRow, col } = lastFocusedCellRef.current;

    setBatidas((prev) => {
      if (currentRow >= prev.length - 1) return prev;
      const updated = prev.map((b) => ({ ...b }));
      for (let i = updated.length - 1; i > currentRow; i--) {
        copyRowData(updated[i], updated[i - 1]);
      }
      clearRowData(updated[currentRow]);
      return updated;
    });

    refocusCell(currentRow, col);
  }, []);

  /**
   * Desloca os dados uma linha para cima a partir da posição do cursor.
   * A linha do cursor recebe os dados de cima; a primeira linha perde os dados.
   */
  const handleShiftUp = useCallback(() => {
    const { row: currentRow, col } = lastFocusedCellRef.current;
    if (currentRow <= 0) return;

    setBatidas((prev) => {
      const updated = prev.map((b) => ({ ...b }));
      // Shift from row 0 upward: each row gets the data from the next row
      for (let i = 0; i < currentRow; i++) {
        copyRowData(updated[i], updated[i + 1]);
      }
      clearRowData(updated[currentRow]);
      return updated;
    });

    refocusCell(currentRow, col);
  }, []);

  const countChanges = useCallback((): number => {
    let count = 0;
    for (const batida of batidas) {
      const original = originalBatidasRef.current.get(batida.id);
      if (!original) continue;
      for (const field of TIME_FIELDS) {
        if (batida[field] !== original[field]) count++;
      }
    }
    return count;
  }, [batidas]);

  /** Check if a specific field was changed */
  const isFieldChanged = (batidaId: string, field: TimeField): boolean => {
    const original = originalBatidasRef.current.get(batidaId);
    if (!original) return false;
    const currentBatida = batidas.find((b) => b.id === batidaId);
    if (!currentBatida) return false;
    return currentBatida[field] !== original[field];
  };

  /** Send all corrections to backend, then perform action */
  const handleAction = async (action: 'aprovar' | 'rejeitar') => {
    if (!accessToken || !id) return;
    setSaving(true);
    setError('');
    setSuccess('');

    try {
      // Before approving, save any corrections the reviewer made
      if (action === 'aprovar') {
        const patchPromises: Promise<unknown>[] = [];

        for (const batida of batidas) {
          const original = originalBatidasRef.current.get(batida.id);
          if (!original) continue;

          const changedFields: Record<string, string> = {};
          for (const field of TIME_FIELDS) {
            if (batida[field] !== original[field]) {
              changedFields[CORRECTED_FIELD_MAP[field]] = batida[field];
            }
          }

          if (Object.keys(changedFields).length > 0) {
            patchPromises.push(
              api.patch(
                `/api/v1/revisao/${id}/batidas/${batida.id}`,
                changedFields,
                accessToken,
              ),
            );
          }
        }

        // Send all corrections in parallel (each targets a different batidaId)
        if (patchPromises.length > 0) {
          await Promise.all(patchPromises);
        }

        await api.post(`/api/v1/revisao/${id}/aprovar`, {}, accessToken);
      } else {
        await api.post(
          `/api/v1/revisao/${id}/rejeitar`,
          { motivo: 'Rejeitado pelo revisor' },
          accessToken,
        );
      }

      const changeCount = countChanges();
      setSuccess(
        action === 'aprovar'
          ? `Cartão aprovado${changeCount > 0 ? ` (${changeCount} correções salvas)` : ''}! Carregando próximo...`
          : 'Cartão rejeitado. Carregando próximo...',
      );

      // Navigate to next pending cartão
      setTimeout(async () => {
        try {
          const response = await api.get<CartaoPontoRevisao[]>(
            '/api/v1/revisao/pendentes?limit=1',
            accessToken,
          );
          const pendentes = response.data;
          if (pendentes.length > 0) {
            router.push(`/revisao/${pendentes[0].id}`);
          } else {
            router.push('/revisao');
          }
        } catch {
          router.push('/revisao');
        }
      }, 800);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao salvar revisão');
    } finally {
      setSaving(false);
    }
  };

  /** Get OcrFeedback for a specific field of a batida */
  const getFeedback = (batida: BatidaEdit, field: string): OcrFeedbackItem | undefined => {
    return batida.ocrFeedback?.find((f) => f.campo === field);
  };

  /** Check if DI disagrees with GPT for a field */
  const hasDiGptDisagreement = (batida: BatidaEdit, field: string): boolean => {
    const feedback = getFeedback(batida, field);
    return feedback?.concordaDiGpt === false;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <p className="text-gray-500">Carregando cartão...</p>
      </div>
    );
  }

  if (!cartao) {
    return (
      <div className="rounded-lg bg-red-50 p-4 text-sm text-red-700">
        {error || 'Cartão não encontrado.'}
      </div>
    );
  }

  const confiancaGeral = cartao.confiancaGeral ?? 0;

  return (
    <div className="space-y-4">
      {/* Back link + info */}
      <div className="flex items-center gap-4">
        <Link
          href="/revisao"
          className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700"
        >
          <ArrowLeft size={16} />
          Voltar
        </Link>
        <div>
          <h2 className="text-lg font-semibold text-gray-900">
            {cartao.nomeExtraido ?? 'Não identificado'}
          </h2>
          <p className="text-sm text-gray-500">
            {cartao.upload?.empresa?.razaoSocial ?? cartao.empresaExtraida ?? '-'} &mdash;{' '}
            {cartao.upload?.mesReferencia ?? cartao.mesExtraido ?? '-'} &mdash;{' '}
            {cartao.tipoCartao}
            {cartao.horarioContratual && (
              <span className="ml-2 text-gray-400">
                (Horário: {cartao.horarioContratual})
              </span>
            )}
          </p>
        </div>
      </div>

      {error && (
        <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</div>
      )}
      {success && (
        <div className="rounded-lg bg-green-50 p-3 text-sm text-green-700">
          {success}
        </div>
      )}

      {/* Side-by-side layout */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        {/* Left: PDF Viewer */}
        <div className="flex h-[calc(100vh-220px)] flex-col rounded-xl bg-white shadow-sm">
          <div className="flex flex-shrink-0 items-center justify-between border-b border-gray-200 px-6 py-3">
            <h3 className="text-sm font-medium text-gray-700">
              Visualização do PDF — Página {cartao.paginaPdf}
            </h3>
            {pdfUrl && (
              <button
                onClick={syncPdfToCurrentPage}
                className="flex items-center gap-1.5 rounded-md bg-blue-50 px-3 py-1.5 text-xs font-medium text-blue-700 transition-colors hover:bg-blue-100"
                title="Sincronizar PDF na página do cartão atual"
              >
                <Crosshair size={14} />
                Sincronizar
              </button>
            )}
          </div>
          {pdfUrl ? (
            <iframe
              ref={iframeRef}
              src={`${pdfUrl}#page=${cartao.paginaPdf}`}
              className="min-h-0 flex-1 rounded-b-xl"
              title={`PDF - ${cartao.upload?.nomeArquivo ?? 'Cartão de Ponto'}`}
            />
          ) : (
            <div className="flex min-h-0 flex-1 items-center justify-center rounded-b-xl border-2 border-dashed border-gray-300 bg-gray-50">
              <div className="text-center text-gray-400">
                {pdfError ? (
                  <>
                    <p className="text-lg font-medium text-red-500">Erro ao carregar PDF</p>
                    <p className="mt-1 text-sm">
                      O arquivo pode ter sido removido do storage.
                    </p>
                    <p className="mt-1 text-xs">
                      Tente reprocessar o upload.
                    </p>
                  </>
                ) : cartao.upload?.id ? (
                  <>
                    <div className="mb-2 h-8 w-8 animate-spin rounded-full border-4 border-blue-200 border-t-blue-600 mx-auto" />
                    <p className="text-sm">Carregando PDF...</p>
                  </>
                ) : (
                  <>
                    <p className="text-lg font-medium">PDF não disponível</p>
                    <p className="mt-1 text-sm">
                      Não foi possível localizar o arquivo PDF
                    </p>
                  </>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Right: Editable batidas */}
        <div className="flex h-[calc(100vh-220px)] flex-col rounded-xl bg-white shadow-sm">
          {/* Header - fixed */}
          <div className="flex-shrink-0 border-b border-gray-200 px-6 py-3">
            <h3 className="text-sm font-medium text-gray-700">
              Batidas ({batidas.length}) &mdash; Confiança geral:{' '}
              <span className={confidenceText(confiancaGeral)}>
                {(confiancaGeral * 100).toFixed(0)}%
              </span>
            </h3>
          </div>

          {/* Table - scrollable, fills remaining space */}
          <div className="min-h-0 flex-1 overflow-y-auto">
            <table
              className="w-full text-xs"
              onFocusCapture={(e) => {
                const target = e.target as HTMLInputElement;
                if (target.dataset?.row != null) {
                  lastFocusedCellRef.current = {
                    row: Number(target.dataset.row),
                    col: target.dataset.col ?? '0',
                  };
                }
              }}
            >
              <thead className="sticky top-0 z-10 bg-white">
                <tr className="border-b border-gray-200 text-left">
                  <th className="px-2 py-2 font-medium text-gray-500">Dia</th>
                  <th className="px-2 py-2 font-medium text-gray-500">Sem.</th>
                  <th className="px-2 py-2 font-medium text-gray-500">
                    Ent. Manhã
                  </th>
                  <th className="px-2 py-2 font-medium text-gray-500">
                    Saída Manhã
                  </th>
                  <th className="px-2 py-2 font-medium text-gray-500">
                    Ent. Tarde
                  </th>
                  <th className="px-2 py-2 font-medium text-gray-500">
                    Saída Tarde
                  </th>
                  <th className="px-2 py-2 font-medium text-gray-500">
                    Ent. Extra
                  </th>
                  <th className="px-2 py-2 font-medium text-gray-500">
                    Saída Extra
                  </th>
                  <th className="px-2 py-2 font-medium text-gray-500">Conf.</th>
                </tr>
              </thead>
              <tbody>
                {batidas.map((batida, rowIndex) => (
                  <tr
                    key={batida.id}
                    className={`border-b border-gray-100 ${batida.isFaltaDia ? 'opacity-50' : ''}`}
                  >
                    <td className="px-2 py-1.5 font-medium">{batida.dia}</td>
                    <td className="px-2 py-1.5 text-gray-600">
                      {batida.diaSemana}
                      {batida.isManuscrito && (
                        <span className="ml-1 text-orange-500" title="Manuscrito">✎</span>
                      )}
                      {batida.isInconsistente && (
                        <span className="ml-1 text-red-500" title="Inconsistente">⚠</span>
                      )}
                      {batida.gptFailed && (
                        <span className="ml-1 text-gray-400" title="GPT Vision indisponível">🚫</span>
                      )}
                    </td>
                    {TIME_FIELDS.map((field, colIndex) => {
                      const fieldConf = batida.confianca?.[field] ?? 0;
                      const feedback = getFeedback(batida, field);
                      const disagreement = hasDiGptDisagreement(batida, field);
                      const changed = isFieldChanged(batida.id, field);
                      const tooltip = buildTooltip(
                        field,
                        fieldConf,
                        feedback,
                        batida.consistencyIssues,
                        batida.outlierFlags,
                      );

                      return (
                        <td
                          key={field}
                          className={`px-2 py-1.5 ${cellConfidenceBg(fieldConf)}`}
                        >
                          <div className="flex items-center gap-0.5">
                            <TimeInput
                              value={batida[field]}
                              onChange={(v) =>
                                updateBatida(batida.id, field, v)
                              }
                              title={tooltip}
                              data-row={rowIndex}
                              data-col={colIndex}
                              className={`w-14 rounded border px-1.5 py-1 text-xs focus:border-blue-500 focus:outline-none ${cellConfidenceBorder(fieldConf)} ${changed ? 'border-l-2 border-l-blue-500 bg-blue-50' : ''}`}
                            />
                            {disagreement && (
                              <span
                                className="text-amber-500 cursor-help"
                                title={`DI: ${feedback?.valorDi ?? '?'} ≠ GPT: ${feedback?.valorGpt ?? '?'}`}
                              >
                                ⚡
                              </span>
                            )}
                          </div>
                        </td>
                      );
                    })}
                    <td className="px-2 py-1.5 text-center">
                      <span
                        className={`text-xs font-medium ${confidenceText(batida.overallConfianca)}`}
                      >
                        {(batida.overallConfianca * 100).toFixed(0)}%
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Footer - fixed: Legend + Actions */}
          <div className="flex-shrink-0 border-t border-gray-200 px-6 py-3">
            <div className="flex flex-wrap gap-3 text-xs text-gray-500">
              <span className="flex items-center gap-1">
                <span className="inline-block h-3 w-3 rounded bg-green-200" />
                Alta (&gt;90%)
              </span>
              <span className="flex items-center gap-1">
                <span className="inline-block h-3 w-3 rounded bg-yellow-200" />
                Média (80-90%)
              </span>
              <span className="flex items-center gap-1">
                <span className="inline-block h-3 w-3 rounded bg-orange-200" />
                Baixa (60-80%)
              </span>
              <span className="flex items-center gap-1">
                <span className="inline-block h-3 w-3 rounded bg-red-200" />
                Crítica (&lt;60%)
              </span>
              <span className="flex items-center gap-1">
                <span className="text-orange-500">✎</span> Manuscrito
              </span>
              <span className="flex items-center gap-1">
                <span className="text-red-500">⚠</span> Inconsistente
              </span>
              <span className="flex items-center gap-1">
                <span className="text-amber-500">⚡</span> DI ≠ GPT
              </span>
              <span className="flex items-center gap-1">
                <span className="inline-block h-3 w-3 rounded border-l-2 border-l-blue-500 bg-blue-50" />
                Corrigido
              </span>
            </div>
            {countChanges() > 0 && (
              <div className="mt-2 flex items-center gap-1.5 text-xs font-medium text-blue-700">
                <Save size={12} />
                {countChanges()} correção(ões) será(ão) salva(s) ao aprovar
              </div>
            )}
            <div className="mt-3 flex gap-3">
              <button
                onClick={() => void handleAction('aprovar')}
                disabled={saving}
                className="flex items-center gap-2 rounded-lg bg-green-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-green-700 disabled:opacity-50"
              >
                <Check size={16} />
                Aprovar
              </button>
              <button
                onClick={() => void handleAction('rejeitar')}
                disabled={saving}
                className="flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-red-700 disabled:opacity-50"
              >
                <X size={16} />
                Rejeitar
              </button>
              <button
                onClick={handleSkipBlock}
                className="flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50"
                title="Pular para a segunda metade do cartão (atalho: avança ~15 dias)"
              >
                <ChevronsDown size={16} />
                Pular Quinzena
              </button>
              <button
                onClick={handleShiftUp}
                className="flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50"
                title="Deslocar dados uma linha para cima a partir da célula selecionada"
              >
                <ArrowUpFromLine size={16} />
                Deslocar ↑
              </button>
              <button
                onClick={handleShiftDown}
                className="flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50"
                title="Deslocar dados uma linha para baixo a partir da célula selecionada"
              >
                <ArrowDownFromLine size={16} />
                Deslocar ↓
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
