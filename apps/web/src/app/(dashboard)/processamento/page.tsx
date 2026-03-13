'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/hooks/use-auth';
import { api } from '@/lib/api';
import type { Empresa, Upload } from '@/lib/types';
import { FileText, RefreshCw, Eye } from 'lucide-react';
import Link from 'next/link';

const statusConfig: Record<string, { label: string; color: string }> = {
  AGUARDANDO: { label: 'Aguardando', color: 'bg-gray-100 text-gray-700' },
  PROCESSANDO: { label: 'Processando', color: 'bg-blue-100 text-blue-700' },
  PROCESSADO: { label: 'Processado', color: 'bg-green-100 text-green-700' },
  PROCESSADO_PARCIAL: { label: 'Parcial', color: 'bg-amber-100 text-amber-700' },
  ERRO: { label: 'Erro', color: 'bg-red-100 text-red-700' },
  VALIDADO: { label: 'Validado', color: 'bg-emerald-100 text-emerald-700' },
  EXPORTADO: { label: 'Exportado', color: 'bg-purple-100 text-purple-700' },
};

export default function ProcessamentoPage() {
  const { accessToken } = useAuth();
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [empresas, setEmpresas] = useState<Empresa[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [expandedErrorId, setExpandedErrorId] = useState<string | null>(null);

  // Filters
  const [filterEmpresaId, setFilterEmpresaId] = useState('');
  const [filterStatus, setFilterStatus] = useState('');

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
      const params = new URLSearchParams({ sort: 'createdAt:desc' });
      if (filterEmpresaId) params.set('empresaId', filterEmpresaId);
      if (filterStatus) params.set('status', filterStatus);

      const response = await api.get<Upload[]>(
        `/api/v1/uploads?${params.toString()}`,
        accessToken,
      );
      setUploads(response.data);
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao carregar uploads');
    } finally {
      setLoading(false);
    }
  }, [accessToken, filterEmpresaId, filterStatus]);

  useEffect(() => {
    void fetchEmpresas();
  }, [fetchEmpresas]);

  useEffect(() => {
    void fetchUploads();
  }, [fetchUploads]);

  // Auto-refresh if there are PROCESSANDO items
  useEffect(() => {
    const hasProcessing = uploads.some((u) => u.status === 'PROCESSANDO');
    if (!hasProcessing) return;

    const interval = setInterval(() => {
      void fetchUploads();
    }, 10000);

    return () => clearInterval(interval);
  }, [uploads, fetchUploads]);

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
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value)}
          className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
        >
          <option value="">Todos os status</option>
          {Object.entries(statusConfig).map(([key, cfg]) => (
            <option key={key} value={key}>
              {cfg.label}
            </option>
          ))}
        </select>

        {(filterEmpresaId || filterStatus) && (
          <button
            onClick={() => {
              setFilterEmpresaId('');
              setFilterStatus('');
            }}
            className="text-sm text-gray-500 hover:text-gray-700 underline"
          >
            Limpar filtros
          </button>
        )}
      </div>

      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-500">
          {uploads.length} upload(s) encontrado(s)
        </p>
        <button
          onClick={() => void fetchUploads()}
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
                <th className="px-6 py-3 font-medium text-gray-500">Arquivo</th>
                <th className="px-6 py-3 font-medium text-gray-500">Empresa</th>
                <th className="px-6 py-3 font-medium text-gray-500">Mês</th>
                <th className="px-6 py-3 font-medium text-gray-500">Status</th>
                <th className="px-6 py-3 font-medium text-gray-500">Progresso</th>
                <th className="px-6 py-3 font-medium text-gray-500">Data</th>
                <th className="px-6 py-3 font-medium text-gray-500">Ações</th>
              </tr>
            </thead>
            <tbody>
              {uploads.length === 0 ? (
                <tr>
                  <td
                    colSpan={7}
                    className="px-6 py-8 text-center text-gray-500"
                  >
                    Nenhum upload encontrado.
                  </td>
                </tr>
              ) : (
                uploads.map((upload) => {
                  const status = statusConfig[upload.status] ?? {
                    label: upload.status,
                    color: 'bg-gray-100 text-gray-700',
                  };
                  const progress =
                    upload.totalPaginas != null && upload.totalPaginas > 0
                      ? `${upload.paginasProcessadas ?? 0}/${upload.totalPaginas}`
                      : '-';
                  const hasZeroProcessed =
                    upload.status === 'PROCESSADO' &&
                    (upload.paginasProcessadas === 0 || upload.paginasProcessadas == null) &&
                    upload.totalPaginas != null &&
                    upload.totalPaginas > 0;

                  return (
                    <React.Fragment key={upload.id}>
                    <tr
                      className="border-b border-gray-100 hover:bg-gray-50"
                    >
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-2">
                          <FileText size={16} className="text-gray-400" />
                          <span className="max-w-[200px] truncate">
                            {upload.nomeArquivo}
                          </span>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        {upload.empresa?.razaoSocial ?? '-'}
                      </td>
                      <td className="px-6 py-4">{upload.mesReferencia}</td>
                      <td className="px-6 py-4">
                        <span
                          className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${status.color}`}
                        >
                          {status.label}
                        </span>
                      </td>
                      <td className="px-6 py-4">
                        <span className={hasZeroProcessed ? 'text-amber-600 font-medium' : 'text-gray-500'}>
                          {progress}
                        </span>
                        {hasZeroProcessed && upload.erroMensagem && (
                          <span
                            title={upload.erroMensagem}
                            className="ml-1 cursor-help text-xs text-amber-500"
                          >
                            ⚠
                          </span>
                        )}
                      </td>
                      <td className="px-6 py-4 text-gray-500">
                        {new Date(upload.createdAt).toLocaleDateString('pt-BR')}{' '}
                        {new Date(upload.createdAt).toLocaleTimeString('pt-BR')}
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-3">
                          {(upload.status === 'PROCESSADO' || upload.status === 'PROCESSADO_PARCIAL' || upload.status === 'VALIDADO') && (
                            <Link
                              href={`/revisao?uploadId=${upload.id}`}
                              className="flex items-center gap-1 text-blue-600 hover:text-blue-800"
                            >
                              <Eye size={16} />
                              Revisar
                            </Link>
                          )}
                          {upload.status === 'ERRO' && upload.erroMensagem && (
                            <button
                              onClick={() => setExpandedErrorId(expandedErrorId === upload.id ? null : upload.id)}
                              className="text-xs text-red-500 underline decoration-dotted hover:text-red-700"
                            >
                              Ver erro
                            </button>
                          )}
                          {hasZeroProcessed && upload.erroMensagem && (
                            <button
                              onClick={() => setExpandedErrorId(expandedErrorId === upload.id ? null : upload.id)}
                              className="text-xs text-amber-600 underline decoration-dotted hover:text-amber-800"
                            >
                              Nenhuma página processada
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                    {expandedErrorId === upload.id && upload.erroMensagem && (
                      <tr className="bg-gray-50">
                        <td colSpan={7} className="px-6 py-3">
                          <div className={`rounded-lg p-3 text-sm ${
                            upload.status === 'ERRO'
                              ? 'bg-red-50 text-red-700 border border-red-200'
                              : 'bg-amber-50 text-amber-700 border border-amber-200'
                          }`}>
                            <p className="font-medium mb-1">
                              {upload.status === 'ERRO' ? 'Erro no processamento:' : 'Detalhes:'}
                            </p>
                            <p>{upload.erroMensagem}</p>
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
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
