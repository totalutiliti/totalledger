'use client';

import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/hooks/use-auth';
import { api } from '@/lib/api';
import type { CartaoPontoRevisao } from '@/lib/types';
import Link from 'next/link';
import { Eye, RefreshCw } from 'lucide-react';

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

export default function RevisaoPage() {
  const { accessToken } = useAuth();
  const [items, setItems] = useState<CartaoPontoRevisao[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const fetchPendentes = useCallback(async () => {
    if (!accessToken) return;
    try {
      const response = await api.get<CartaoPontoRevisao[]>(
        '/api/v1/revisao/pendentes',
        accessToken,
      );
      setItems(response.data);
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao carregar revisões');
    } finally {
      setLoading(false);
    }
  }, [accessToken]);

  useEffect(() => {
    void fetchPendentes();
  }, [fetchPendentes]);

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
                <th className="px-6 py-3 font-medium text-gray-500">Mês</th>
                <th className="px-6 py-3 font-medium text-gray-500">
                  Tipo Cartão
                </th>
                <th className="px-6 py-3 font-medium text-gray-500">
                  Confiança
                </th>
                <th className="px-6 py-3 font-medium text-gray-500">Status</th>
                <th className="px-6 py-3 font-medium text-gray-500">Ações</th>
              </tr>
            </thead>
            <tbody>
              {items.length === 0 ? (
                <tr>
                  <td
                    colSpan={7}
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
