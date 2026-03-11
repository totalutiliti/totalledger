'use client';

import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/hooks/use-auth';
import { api } from '@/lib/api';
import type { Upload } from '@/lib/types';
import { FileText, RefreshCw, Eye } from 'lucide-react';
import Link from 'next/link';

const statusConfig: Record<string, { label: string; color: string }> = {
  PENDENTE: { label: 'Pendente', color: 'bg-gray-100 text-gray-700' },
  PROCESSANDO: { label: 'Processando', color: 'bg-blue-100 text-blue-700' },
  CONCLUIDO: { label: 'Concluído', color: 'bg-green-100 text-green-700' },
  ERRO: { label: 'Erro', color: 'bg-red-100 text-red-700' },
  PARCIAL: { label: 'Parcial', color: 'bg-yellow-100 text-yellow-700' },
};

export default function ProcessamentoPage() {
  const { accessToken } = useAuth();
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const fetchUploads = useCallback(async () => {
    if (!accessToken) return;
    try {
      const response = await api.get<Upload[]>(
        '/api/v1/uploads?sort=createdAt:desc',
        accessToken,
      );
      setUploads(response.data);
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao carregar uploads');
    } finally {
      setLoading(false);
    }
  }, [accessToken]);

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
                    upload.totalPaginas && upload.paginasProcessadas
                      ? `${upload.paginasProcessadas}/${upload.totalPaginas}`
                      : '-';

                  return (
                    <tr
                      key={upload.id}
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
                      <td className="px-6 py-4 text-gray-500">{progress}</td>
                      <td className="px-6 py-4 text-gray-500">
                        {new Date(upload.createdAt).toLocaleDateString('pt-BR')}
                      </td>
                      <td className="px-6 py-4">
                        {upload.status === 'CONCLUIDO' && (
                          <Link
                            href={`/revisao?uploadId=${upload.id}`}
                            className="flex items-center gap-1 text-blue-600 hover:text-blue-800"
                          >
                            <Eye size={16} />
                            Ver
                          </Link>
                        )}
                        {upload.status === 'ERRO' && upload.erro && (
                          <span
                            title={upload.erro}
                            className="cursor-help text-xs text-red-500 underline decoration-dotted"
                          >
                            Ver erro
                          </span>
                        )}
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
