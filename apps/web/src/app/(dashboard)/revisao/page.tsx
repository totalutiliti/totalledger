'use client';

import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useAuth } from '@/hooks/use-auth';
import { api } from '@/lib/api';
import type { CartaoPontoRevisao, Empresa, Upload } from '@/lib/types';
import Link from 'next/link';
import { Eye, RefreshCw, FileText } from 'lucide-react';

const statusConfig: Record<string, { label: string; color: string }> = {
  PENDENTE: { label: 'Pendente', color: 'bg-yellow-100 text-yellow-700' },
  EM_REVISAO: { label: 'Em Revisão', color: 'bg-blue-100 text-blue-700' },
  APROVADO: { label: 'Aprovado', color: 'bg-green-100 text-green-700' },
  REJEITADO: { label: 'Rejeitado', color: 'bg-red-100 text-red-700' },
};

function confidenceBadge(confianca: number) {
  if (confianca >= 0.9) return 'bg-green-100 text-green-700';
  if (confianca >= 0.8) return 'bg-yellow-100 text-yellow-700';
  return 'bg-red-100 text-red-700';
}

function priorityBadge(prioridade: number | null) {
  if (prioridade === null) return { label: '-', color: 'bg-gray-100 text-gray-500' };
  if (prioridade >= 50) return { label: 'Alta', color: 'bg-red-100 text-red-700' };
  if (prioridade >= 20) return { label: 'Média', color: 'bg-amber-100 text-amber-700' };
  return { label: 'Baixa', color: 'bg-green-100 text-green-700' };
}

export default function RevisaoPage() {
  const { accessToken } = useAuth();
  const searchParams = useSearchParams();

  const [items, setItems] = useState<CartaoPontoRevisao[]>([]);
  const [empresas, setEmpresas] = useState<Empresa[]>([]);
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Filters — initialize from URL params if present
  const [filterEmpresaId, setFilterEmpresaId] = useState(searchParams.get('empresaId') ?? '');
  const [filterUploadId, setFilterUploadId] = useState(searchParams.get('uploadId') ?? '');

  const fetchEmpresas = useCallback(async () => {
    if (!accessToken) return;
    try {
      const response = await api.get<Empresa[]>('/api/v1/empresas', accessToken);
      setEmpresas(response.data);
    } catch {
      // silently fail
    }
  }, [accessToken]);

  const fetchUploads = useCallback(async () => {
    if (!accessToken) return;
    try {
      const params = new URLSearchParams({ sort: 'createdAt:desc', status: 'PROCESSADO' });
      if (filterEmpresaId) params.set('empresaId', filterEmpresaId);

      const response = await api.get<Upload[]>(
        `/api/v1/uploads?${params.toString()}`,
        accessToken,
      );
      setUploads(response.data);
    } catch {
      // silently fail
    }
  }, [accessToken, filterEmpresaId]);

  const fetchPendentes = useCallback(async () => {
    if (!accessToken) return;
    try {
      const params = new URLSearchParams();
      if (filterEmpresaId) params.set('empresaId', filterEmpresaId);
      if (filterUploadId) params.set('uploadId', filterUploadId);

      const query = params.toString();
      const url = `/api/v1/revisao/pendentes${query ? `?${query}` : ''}`;

      const response = await api.get<CartaoPontoRevisao[]>(url, accessToken);
      setItems(response.data);
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao carregar revisões');
    } finally {
      setLoading(false);
    }
  }, [accessToken, filterEmpresaId, filterUploadId]);

  useEffect(() => {
    void fetchEmpresas();
  }, [fetchEmpresas]);

  useEffect(() => {
    void fetchUploads();
  }, [fetchUploads]);

  useEffect(() => {
    void fetchPendentes();
  }, [fetchPendentes]);

  // When empresa filter changes, reset upload filter if the upload doesn't belong to that empresa
  useEffect(() => {
    if (filterEmpresaId && filterUploadId) {
      const uploadBelongs = uploads.some(
        (u) => u.id === filterUploadId && u.empresaId === filterEmpresaId,
      );
      if (!uploadBelongs) {
        setFilterUploadId('');
      }
    }
  }, [filterEmpresaId, filterUploadId, uploads]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <p className="text-gray-500">Carregando...</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <select
          value={filterEmpresaId}
          onChange={(e) => setFilterEmpresaId(e.target.value)}
          className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
        >
          <option value="">Todas as empresas</option>
          {empresas.map((emp) => (
            <option key={emp.id} value={emp.id}>
              {emp.razaoSocial}
            </option>
          ))}
        </select>

        <select
          value={filterUploadId}
          onChange={(e) => setFilterUploadId(e.target.value)}
          className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
        >
          <option value="">Todos os arquivos</option>
          {uploads.map((u) => (
            <option key={u.id} value={u.id}>
              {u.nomeArquivo} ({u.mesReferencia})
            </option>
          ))}
        </select>

        {(filterEmpresaId || filterUploadId) && (
          <button
            onClick={() => {
              setFilterEmpresaId('');
              setFilterUploadId('');
            }}
            className="text-sm text-gray-500 hover:text-gray-700 underline"
          >
            Limpar filtros
          </button>
        )}
      </div>

      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-500">
          {items.length} cartão(ões) pendente(s) de revisão
        </p>
        <button
          onClick={() => void fetchPendentes()}
          className="flex items-center gap-2 rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
        >
          <RefreshCw size={16} />
          Atualizar
        </button>
      </div>

      {error && (
        <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</div>
      )}

      <div className="rounded-xl bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 text-left">
                <th className="px-6 py-3 font-medium text-gray-500">
                  Funcionário
                </th>
                <th className="px-6 py-3 font-medium text-gray-500">Empresa</th>
                <th className="px-6 py-3 font-medium text-gray-500">Arquivo</th>
                <th className="px-6 py-3 font-medium text-gray-500">Mês</th>
                <th className="px-6 py-3 font-medium text-gray-500">
                  Tipo Cartão
                </th>
                <th className="px-6 py-3 font-medium text-gray-500">
                  Confiança
                </th>
                <th className="px-6 py-3 font-medium text-gray-500">Prioridade</th>
                <th className="px-6 py-3 font-medium text-gray-500">Status</th>
                <th className="px-6 py-3 font-medium text-gray-500">Ações</th>
              </tr>
            </thead>
            <tbody>
              {items.length === 0 ? (
                <tr>
                  <td
                    colSpan={9}
                    className="px-6 py-8 text-center text-gray-500"
                  >
                    Nenhum cartão pendente de revisão.
                  </td>
                </tr>
              ) : (
                items.map((item) => {
                  const confianca = item.confiancaGeral ?? 0;
                  const status = statusConfig[item.statusRevisao] ?? {
                    label: item.statusRevisao,
                    color: 'bg-gray-100 text-gray-700',
                  };
                  return (
                    <tr
                      key={item.id}
                      className="border-b border-gray-100 hover:bg-gray-50"
                    >
                      <td className="px-6 py-4 font-medium text-gray-900">
                        {item.nomeExtraido ?? 'Não identificado'}
                      </td>
                      <td className="px-6 py-4">
                        {item.upload?.empresa?.razaoSocial ?? item.empresaExtraida ?? '-'}
                      </td>
                      <td className="px-6 py-4">
                        {item.upload ? (
                          <Link
                            href="/processamento"
                            className="flex items-center gap-1 text-gray-600 hover:text-blue-600"
                            title={`Página ${item.paginaPdf} do PDF`}
                          >
                            <FileText size={14} className="text-gray-400" />
                            <span className="max-w-[150px] truncate">
                              {item.upload.nomeArquivo}
                            </span>
                            <span className="text-xs text-gray-400">
                              (p.{item.paginaPdf})
                            </span>
                          </Link>
                        ) : (
                          '-'
                        )}
                      </td>
                      <td className="px-6 py-4">
                        {item.upload?.mesReferencia ?? item.mesExtraido ?? '-'}
                      </td>
                      <td className="px-6 py-4">{item.tipoCartao}</td>
                      <td className="px-6 py-4">
                        <span
                          className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${confidenceBadge(confianca)}`}
                        >
                          {(confianca * 100).toFixed(0)}%
                        </span>
                      </td>
                      <td className="px-6 py-4">
                        {(() => {
                          const prio = priorityBadge(item.prioridadeRevisao);
                          return (
                            <span
                              className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${prio.color}`}
                              title={item.prioridadeMotivos?.join(', ') ?? ''}
                            >
                              {prio.label}
                            </span>
                          );
                        })()}
                      </td>
                      <td className="px-6 py-4">
                        <span
                          className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${status.color}`}
                        >
                          {status.label}
                        </span>
                      </td>
                      <td className="px-6 py-4">
                        <Link
                          href={`/revisao/${item.id}`}
                          className="flex items-center gap-1 text-blue-600 hover:text-blue-800"
                        >
                          <Eye size={16} />
                          Revisar
                        </Link>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
