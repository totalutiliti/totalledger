'use client';

import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/hooks/use-auth';
import { api } from '@/lib/api';
import type { Empresa } from '@/lib/types';
import { Download, FileSpreadsheet, FileText } from 'lucide-react';

export default function ExportacaoPage() {
  const { accessToken } = useAuth();
  const [empresas, setEmpresas] = useState<Empresa[]>([]);
  const [empresaId, setEmpresaId] = useState('');
  const [mesReferencia, setMesReferencia] = useState('');
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const fetchEmpresas = useCallback(async () => {
    if (!accessToken) return;
    try {
      const response = await api.get<Empresa[]>('/api/v1/empresas', accessToken);
      setEmpresas(response.data);
    } catch {
      // silently fail
    }
  }, [accessToken]);

  useEffect(() => {
    void fetchEmpresas();
  }, [fetchEmpresas]);

  const handleExport = async (format: 'csv' | 'xlsx') => {
    if (!accessToken || !empresaId || !mesReferencia) return;
    setExporting(true);
    setError('');
    setSuccess('');

    try {
      const blob = await api.downloadBlob(
        `/api/v1/export/${format}`,
        { empresaId, mesReferencia },
        accessToken,
      );

      // Trigger download
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `cartoes_ponto_${mesReferencia}.${format}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      setSuccess(`Arquivo ${format.toUpperCase()} exportado com sucesso!`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao exportar');
    } finally {
      setExporting(false);
    }
  };

  const canExport = empresaId && mesReferencia && !exporting;

  return (
    <div className="space-y-6">
      <div className="rounded-xl bg-white p-6 shadow-sm">
        <h2 className="mb-4 text-lg font-semibold text-gray-900">
          Exportar Cartões de Ponto
        </h2>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label
              htmlFor="exportEmpresa"
              className="mb-1 block text-sm font-medium text-gray-700"
            >
              Empresa
            </label>
            <select
              id="exportEmpresa"
              value={empresaId}
              onChange={(e) => setEmpresaId(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            >
              <option value="">Selecione uma empresa</option>
              {empresas.map((emp) => (
                <option key={emp.id} value={emp.id}>
                  {emp.razaoSocial}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label
              htmlFor="exportMes"
              className="mb-1 block text-sm font-medium text-gray-700"
            >
              Mês de Referência
            </label>
            <input
              id="exportMes"
              type="month"
              value={mesReferencia}
              onChange={(e) => setMesReferencia(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>
        </div>

        {error && (
          <div className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">
            {error}
          </div>
        )}

        {success && (
          <div className="mt-4 rounded-lg bg-green-50 p-3 text-sm text-green-700">
            {success}
          </div>
        )}

        <div className="mt-6 flex gap-3">
          <button
            onClick={() => void handleExport('csv')}
            disabled={!canExport}
            className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <FileText size={18} />
            Exportar CSV
          </button>

          <button
            onClick={() => void handleExport('xlsx')}
            disabled={!canExport}
            className="flex items-center gap-2 rounded-lg bg-green-600 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-green-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <FileSpreadsheet size={18} />
            Exportar XLSX
          </button>
        </div>
      </div>

      {/* Info */}
      <div className="rounded-xl bg-blue-50 p-6">
        <div className="flex items-start gap-3">
          <Download size={20} className="mt-0.5 text-blue-600" />
          <div>
            <h3 className="text-sm font-medium text-blue-900">
              Informações sobre a exportação
            </h3>
            <ul className="mt-2 space-y-1 text-sm text-blue-700">
              <li>
                Apenas cartões de ponto com status <strong>Aprovado</strong> ou{' '}
                <strong>Corrigido</strong> serão exportados.
              </li>
              <li>
                O arquivo CSV é compatível com a maioria dos sistemas de folha
                de pagamento.
              </li>
              <li>
                O arquivo XLSX inclui formatação e pode ser aberto no Excel.
              </li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
