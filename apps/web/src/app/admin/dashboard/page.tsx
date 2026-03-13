'use client';

import { useEffect, useState, useCallback } from 'react';
import { useAuthContext } from '@/lib/auth-context';
import { api } from '@/lib/api';
import type { GlobalDashboard, UsageMetrics, OcrAccuracy, CorrectionRecord } from '@/lib/types';
import {
  Building2,
  Users,
  Upload,
  CreditCard,
  DollarSign,
  FileText,
  Cpu,
  Zap,
  Eye,
  Filter,
  Target,
  PenTool,
  ExternalLink,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import type { ComponentType } from 'react';
import type { LucideProps } from 'lucide-react';

interface StatCard {
  label: string;
  value: number;
  icon: ComponentType<LucideProps>;
  color: string;
  bgColor: string;
}

const STATUS_COLORS: Record<string, string> = {
  PENDENTE: 'bg-yellow-400',
  PROCESSANDO: 'bg-blue-400',
  CONCLUIDO: 'bg-green-400',
  ERRO: 'bg-red-400',
  PARCIAL: 'bg-orange-400',
};

const STATUS_BG: Record<string, string> = {
  PENDENTE: 'bg-yellow-100 text-yellow-800',
  PROCESSANDO: 'bg-blue-100 text-blue-800',
  CONCLUIDO: 'bg-green-100 text-green-800',
  ERRO: 'bg-red-100 text-red-800',
  PARCIAL: 'bg-orange-100 text-orange-800',
};

function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString('pt-BR');
}

function formatUsd(n: number): string {
  return `$${n.toFixed(2)}`;
}

function formatPct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

const CAMPO_LABELS: Record<string, string> = {
  entradaManha: 'Ent. Manhã',
  saidaManha: 'Saída Manhã',
  entradaTarde: 'Ent. Tarde',
  saidaTarde: 'Saída Tarde',
  entradaExtra: 'Ent. Extra',
  saidaExtra: 'Saída Extra',
  entradaManhaCorrigida: 'Ent. Manhã',
  saidaManhaCorrigida: 'Saída Manhã',
  entradaTardeCorrigida: 'Ent. Tarde',
  saidaTardeCorrigida: 'Saída Tarde',
  entradaExtraCorrigida: 'Ent. Extra',
  saidaExtraCorrigida: 'Saída Extra',
};

export default function AdminDashboardPage() {
  const { accessToken } = useAuthContext();
  const [dashboard, setDashboard] = useState<GlobalDashboard | null>(null);
  const [usage, setUsage] = useState<UsageMetrics | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [usageLoading, setUsageLoading] = useState(true);
  const [filtroDataDe, setFiltroDataDe] = useState('');
  const [filtroDataAte, setFiltroDataAte] = useState('');
  const [accuracy, setAccuracy] = useState<OcrAccuracy | null>(null);
  const [accuracyLoading, setAccuracyLoading] = useState(true);
  const [corrections, setCorrections] = useState<CorrectionRecord[]>([]);
  const [correctionsPage, setCorrectionsPage] = useState(1);
  const [correctionsTotalPages, setCorrectionsTotalPages] = useState(1);
  const [correctionsLoading, setCorrectionsLoading] = useState(true);

  const fetchDashboard = useCallback(async () => {
    if (!accessToken) return;
    try {
      const response = await api.get<GlobalDashboard>(
        '/api/v1/dashboard/global',
        accessToken,
      );
      setDashboard(response.data);
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao carregar dashboard');
    } finally {
      setLoading(false);
    }
  }, [accessToken]);

  const fetchUsage = useCallback(async () => {
    if (!accessToken) return;
    setUsageLoading(true);
    try {
      const params = new URLSearchParams();
      if (filtroDataDe) params.set('de', filtroDataDe);
      if (filtroDataAte) params.set('ate', filtroDataAte);
      const qs = params.toString();
      const response = await api.get<UsageMetrics>(
        `/api/v1/dashboard/usage-metrics${qs ? `?${qs}` : ''}`,
        accessToken,
      );
      setUsage(response.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao carregar métricas de uso');
    } finally {
      setUsageLoading(false);
    }
  }, [accessToken, filtroDataDe, filtroDataAte]);

  const fetchAccuracy = useCallback(async () => {
    if (!accessToken) return;
    setAccuracyLoading(true);
    try {
      const params = new URLSearchParams();
      if (filtroDataDe) params.set('de', filtroDataDe);
      if (filtroDataAte) params.set('ate', filtroDataAte);
      const qs = params.toString();
      const response = await api.get<OcrAccuracy>(
        `/api/v1/dashboard/ocr-accuracy${qs ? `?${qs}` : ''}`,
        accessToken,
      );
      setAccuracy(response.data);
    } catch {
      // Silently fail — accuracy is non-critical
    } finally {
      setAccuracyLoading(false);
    }
  }, [accessToken, filtroDataDe, filtroDataAte]);

  const fetchCorrections = useCallback(async () => {
    if (!accessToken) return;
    setCorrectionsLoading(true);
    try {
      const params = new URLSearchParams();
      params.set('page', String(correctionsPage));
      params.set('limit', '10');
      if (filtroDataDe) params.set('de', filtroDataDe);
      if (filtroDataAte) params.set('ate', filtroDataAte);
      const response = await api.get<CorrectionRecord[]>(
        `/api/v1/dashboard/corrections?${params.toString()}`,
        accessToken,
      );
      setCorrections(response.data);
      const meta = (response as { meta?: { page: number; limit: number; total: number } }).meta;
      if (meta) {
        setCorrectionsTotalPages(Math.ceil(meta.total / meta.limit) || 1);
      }
    } catch {
      // Silently fail
    } finally {
      setCorrectionsLoading(false);
    }
  }, [accessToken, correctionsPage, filtroDataDe, filtroDataAte]);

  useEffect(() => {
    void fetchDashboard();
  }, [fetchDashboard]);

  useEffect(() => {
    void fetchUsage();
  }, [fetchUsage]);

  useEffect(() => {
    void fetchAccuracy();
  }, [fetchAccuracy]);

  useEffect(() => {
    void fetchCorrections();
  }, [fetchCorrections]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <p className="text-gray-500">Carregando dados...</p>
      </div>
    );
  }

  if (error && !dashboard) {
    return (
      <div className="rounded-lg bg-red-50 p-4 text-sm text-red-700">{error}</div>
    );
  }

  const stats: StatCard[] = [
    {
      label: 'Total Tenants',
      value: dashboard?.totalTenants ?? 0,
      icon: Building2,
      color: 'text-indigo-600',
      bgColor: 'bg-indigo-100',
    },
    {
      label: 'Total Usuários',
      value: dashboard?.totalUsers ?? 0,
      icon: Users,
      color: 'text-blue-600',
      bgColor: 'bg-blue-100',
    },
    {
      label: 'Total Uploads',
      value: dashboard?.totalUploads ?? 0,
      icon: Upload,
      color: 'text-emerald-600',
      bgColor: 'bg-emerald-100',
    },
    {
      label: 'Cartões Processados',
      value: dashboard?.totalCartoes ?? 0,
      icon: CreditCard,
      color: 'text-purple-600',
      bgColor: 'bg-purple-100',
    },
  ];

  const totalStatus = (dashboard?.statusBreakdown ?? []).reduce(
    (sum, s) => sum + s.count,
    0,
  );

  return (
    <div className="space-y-6">
      {/* Stat Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {stats.map((stat) => {
          const Icon = stat.icon;
          return (
            <div key={stat.label} className="rounded-xl bg-white p-6 shadow-sm">
              <div className="flex items-center gap-4">
                <div
                  className={`flex h-12 w-12 items-center justify-center rounded-lg ${stat.bgColor}`}
                >
                  <Icon size={24} className={stat.color} />
                </div>
                <div>
                  <p className="text-2xl font-bold text-gray-900">{stat.value}</p>
                  <p className="text-sm text-gray-500">{stat.label}</p>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* ================================================================ */}
      {/* CONSUMO & CUSTOS — Azure DI + OpenAI                           */}
      {/* ================================================================ */}
      <div className="rounded-xl bg-white p-6 shadow-sm">
        <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <h3 className="text-lg font-semibold text-gray-900">
            Consumo & Custos — Azure + OpenAI
          </h3>
          <div className="flex items-center gap-2">
            <input
              type="date"
              value={filtroDataDe}
              onChange={(e) => setFiltroDataDe(e.target.value)}
              className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              placeholder="De"
            />
            <span className="text-gray-400">—</span>
            <input
              type="date"
              value={filtroDataAte}
              onChange={(e) => setFiltroDataAte(e.target.value)}
              className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              placeholder="Até"
            />
            {(filtroDataDe || filtroDataAte) && (
              <button
                onClick={() => {
                  setFiltroDataDe('');
                  setFiltroDataAte('');
                }}
                className="rounded-lg bg-gray-100 px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-200"
              >
                Limpar
              </button>
            )}
          </div>
        </div>

        {usageLoading ? (
          <div className="flex items-center justify-center py-8">
            <p className="text-sm text-gray-400">Carregando métricas...</p>
          </div>
        ) : usage ? (
          <div className="space-y-6">
            {/* Período */}
            <p className="text-xs text-gray-400">
              Período: {usage.periodo.de} a {usage.periodo.ate} — {usage.totalUploadsProcessados} uploads processados
            </p>

            {/* Custo Total */}
            <div className="rounded-xl border-2 border-indigo-200 bg-indigo-50 p-5">
              <div className="flex items-center gap-3">
                <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-indigo-100">
                  <DollarSign size={24} className="text-indigo-600" />
                </div>
                <div>
                  <p className="text-3xl font-bold text-indigo-700">
                    {formatUsd(usage.custoTotalUsd)}
                  </p>
                  <p className="text-sm text-indigo-500">Custo Total Estimado (USD)</p>
                </div>
              </div>
            </div>

            {/* Cards de serviço */}
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-4">
              {/* Azure Document Intelligence */}
              <div className="rounded-xl border border-blue-200 bg-blue-50 p-5">
                <div className="mb-3 flex items-center gap-2">
                  <FileText size={20} className="text-blue-600" />
                  <h4 className="font-semibold text-blue-900">Azure Document Intelligence</h4>
                </div>
                <div className="space-y-2">
                  <div className="flex justify-between">
                    <span className="text-sm text-blue-700">Páginas processadas</span>
                    <span className="font-mono font-semibold text-blue-900">
                      {formatNumber(usage.documentIntelligence.totalPaginas)}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-sm text-blue-700">Preço (layout)</span>
                    <span className="font-mono text-sm text-blue-600">
                      ${usage.documentIntelligence.precoPor1000}/1K pgs
                    </span>
                  </div>
                  <div className="border-t border-blue-200 pt-2">
                    <div className="flex justify-between">
                      <span className="text-sm font-medium text-blue-800">Custo</span>
                      <span className="font-mono font-bold text-blue-900">
                        {formatUsd(usage.documentIntelligence.custoEstimadoUsd)}
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              {/* GPT-5-mini */}
              <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-5">
                <div className="mb-3 flex items-center gap-2">
                  <Zap size={20} className="text-emerald-600" />
                  <h4 className="font-semibold text-emerald-900">GPT-5-mini</h4>
                </div>
                <div className="space-y-2">
                  <div className="flex justify-between">
                    <span className="text-sm text-emerald-700">Chamadas</span>
                    <span className="font-mono font-semibold text-emerald-900">
                      {formatNumber(usage.gptMini.chamadas)}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-sm text-emerald-700">Tokens in</span>
                    <span className="font-mono text-sm text-emerald-600">
                      {formatNumber(usage.gptMini.tokensIn)}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-sm text-emerald-700">Tokens out</span>
                    <span className="font-mono text-sm text-emerald-600">
                      {formatNumber(usage.gptMini.tokensOut)}
                    </span>
                  </div>
                  <div className="border-t border-emerald-200 pt-2">
                    <div className="flex justify-between">
                      <span className="text-sm font-medium text-emerald-800">Custo</span>
                      <span className="font-mono font-bold text-emerald-900">
                        {formatUsd(usage.gptMini.custoUsd)}
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              {/* GPT-5.2 */}
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-5">
                <div className="mb-3 flex items-center gap-2">
                  <Eye size={20} className="text-amber-600" />
                  <h4 className="font-semibold text-amber-900">GPT-5.2 (Vision)</h4>
                </div>
                <div className="space-y-2">
                  <div className="flex justify-between">
                    <span className="text-sm text-amber-700">Chamadas</span>
                    <span className="font-mono font-semibold text-amber-900">
                      {formatNumber(usage.gpt52.chamadas)}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-sm text-amber-700">Tokens in</span>
                    <span className="font-mono text-sm text-amber-600">
                      {formatNumber(usage.gpt52.tokensIn)}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-sm text-amber-700">Tokens out</span>
                    <span className="font-mono text-sm text-amber-600">
                      {formatNumber(usage.gpt52.tokensOut)}
                    </span>
                  </div>
                  <div className="border-t border-amber-200 pt-2">
                    <div className="flex justify-between">
                      <span className="text-sm font-medium text-amber-800">Custo</span>
                      <span className="font-mono font-bold text-amber-900">
                        {formatUsd(usage.gpt52.custoUsd)}
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              {/* GPT-4o-mini (AI Filter) */}
              <div className="rounded-xl border border-purple-200 bg-purple-50 p-5">
                <div className="mb-3 flex items-center gap-2">
                  <Filter size={20} className="text-purple-600" />
                  <h4 className="font-semibold text-purple-900">GPT-4o-mini (Filter)</h4>
                </div>
                <div className="space-y-2">
                  <div className="flex justify-between">
                    <span className="text-sm text-purple-700">Chamadas</span>
                    <span className="font-mono font-semibold text-purple-900">
                      {formatNumber(usage.gpt4oMini.chamadas)}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-sm text-purple-700">Tokens in</span>
                    <span className="font-mono text-sm text-purple-600">
                      {formatNumber(usage.gpt4oMini.tokensIn)}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-sm text-purple-700">Tokens out</span>
                    <span className="font-mono text-sm text-purple-600">
                      {formatNumber(usage.gpt4oMini.tokensOut)}
                    </span>
                  </div>
                  <div className="border-t border-purple-200 pt-2">
                    <div className="flex justify-between">
                      <span className="text-sm font-medium text-purple-800">Custo</span>
                      <span className="font-mono font-bold text-purple-900">
                        {formatUsd(usage.gpt4oMini.custoUsd)}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Tabela de preços de referência */}
            <details className="group">
              <summary className="cursor-pointer text-xs font-medium text-gray-500 hover:text-gray-700">
                Referência de preços Azure
              </summary>
              <div className="mt-2 overflow-x-auto rounded-lg border border-gray-200">
                <table className="w-full text-xs">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-4 py-2 text-left font-medium text-gray-500">Serviço</th>
                      <th className="px-4 py-2 text-left font-medium text-gray-500">Modelo</th>
                      <th className="px-4 py-2 text-right font-medium text-gray-500">Input</th>
                      <th className="px-4 py-2 text-right font-medium text-gray-500">Output</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    <tr>
                      <td className="px-4 py-2 text-gray-700">Document Intelligence</td>
                      <td className="px-4 py-2 text-gray-600">prebuilt-layout</td>
                      <td className="px-4 py-2 text-right font-mono text-gray-700">$10/1K páginas</td>
                      <td className="px-4 py-2 text-right text-gray-400">—</td>
                    </tr>
                    <tr>
                      <td className="px-4 py-2 text-gray-700">Azure OpenAI</td>
                      <td className="px-4 py-2 text-gray-600">GPT-5-mini</td>
                      <td className="px-4 py-2 text-right font-mono text-gray-700">$0.40/1M tok</td>
                      <td className="px-4 py-2 text-right font-mono text-gray-700">$1.60/1M tok</td>
                    </tr>
                    <tr>
                      <td className="px-4 py-2 text-gray-700">Azure OpenAI</td>
                      <td className="px-4 py-2 text-gray-600">GPT-5.2</td>
                      <td className="px-4 py-2 text-right font-mono text-gray-700">$2.50/1M tok</td>
                      <td className="px-4 py-2 text-right font-mono text-gray-700">$10/1M tok</td>
                    </tr>
                    <tr>
                      <td className="px-4 py-2 text-gray-700">Azure OpenAI</td>
                      <td className="px-4 py-2 text-gray-600">GPT-4o-mini</td>
                      <td className="px-4 py-2 text-right font-mono text-gray-700">$2.50/1M tok</td>
                      <td className="px-4 py-2 text-right font-mono text-gray-700">$10/1M tok</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </details>
          </div>
        ) : null}
      </div>

      {/* ================================================================ */}
      {/* ACURÁCIA OCR & CORREÇÕES                                       */}
      {/* ================================================================ */}
      <div className="rounded-xl bg-white p-6 shadow-sm">
        <h3 className="mb-6 text-lg font-semibold text-gray-900">
          Acurácia OCR & Correções Humanas
        </h3>

        {accuracyLoading ? (
          <div className="flex items-center justify-center py-8">
            <p className="text-sm text-gray-400">Carregando métricas de acurácia...</p>
          </div>
        ) : accuracy && accuracy.totalGroundTruthRecords > 0 ? (
          <div className="space-y-6">
            {/* Accuracy cards */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <div className="rounded-xl border border-green-200 bg-green-50 p-5">
                <div className="flex items-center gap-2 mb-2">
                  <Target size={18} className="text-green-600" />
                  <span className="text-sm font-medium text-green-800">Acurácia GPT-5.2</span>
                </div>
                <p className="text-3xl font-bold text-green-700">
                  {formatPct(accuracy.globalAccuracy.gpt)}
                </p>
              </div>
              <div className="rounded-xl border border-blue-200 bg-blue-50 p-5">
                <div className="flex items-center gap-2 mb-2">
                  <Target size={18} className="text-blue-600" />
                  <span className="text-sm font-medium text-blue-800">Acurácia DI</span>
                </div>
                <p className="text-3xl font-bold text-blue-700">
                  {formatPct(accuracy.globalAccuracy.di)}
                </p>
              </div>
              <div className="rounded-xl border border-orange-200 bg-orange-50 p-5">
                <div className="flex items-center gap-2 mb-2">
                  <PenTool size={18} className="text-orange-600" />
                  <span className="text-sm font-medium text-orange-800">Total Correções</span>
                </div>
                <p className="text-3xl font-bold text-orange-700">
                  {accuracy.totalCorrections}
                </p>
              </div>
              <div className="rounded-xl border border-gray-200 bg-gray-50 p-5">
                <div className="flex items-center gap-2 mb-2">
                  <FileText size={18} className="text-gray-600" />
                  <span className="text-sm font-medium text-gray-800">Ground Truth</span>
                </div>
                <p className="text-3xl font-bold text-gray-700">
                  {accuracy.totalGroundTruthRecords}
                </p>
              </div>
            </div>

            {/* Accuracy by field */}
            {accuracy.byField.length > 0 && (
              <div>
                <h4 className="mb-2 text-sm font-medium text-gray-700">Acurácia por Campo</h4>
                <div className="overflow-x-auto rounded-lg border border-gray-200">
                  <table className="w-full text-xs">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-4 py-2 text-left font-medium text-gray-500">Campo</th>
                        <th className="px-4 py-2 text-right font-medium text-gray-500">Amostras</th>
                        <th className="px-4 py-2 text-right font-medium text-gray-500">Acurácia DI</th>
                        <th className="px-4 py-2 text-right font-medium text-gray-500">Acurácia GPT</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {accuracy.byField.map((f) => (
                        <tr key={f.campo}>
                          <td className="px-4 py-2 text-gray-700">{CAMPO_LABELS[f.campo] ?? f.campo}</td>
                          <td className="px-4 py-2 text-right font-mono text-gray-600">{f.total}</td>
                          <td className={`px-4 py-2 text-right font-mono ${f.acuraciaDi >= 0.9 ? 'text-green-700' : f.acuraciaDi >= 0.7 ? 'text-yellow-700' : 'text-red-700'}`}>
                            {formatPct(f.acuraciaDi)}
                          </td>
                          <td className={`px-4 py-2 text-right font-mono ${f.acuraciaGpt >= 0.9 ? 'text-green-700' : f.acuraciaGpt >= 0.7 ? 'text-yellow-700' : 'text-red-700'}`}>
                            {formatPct(f.acuraciaGpt)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Accuracy by card type */}
            {Object.keys(accuracy.byTipoCartao).length > 0 && (
              <div>
                <h4 className="mb-2 text-sm font-medium text-gray-700">Acurácia por Tipo de Cartão</h4>
                <div className="overflow-x-auto rounded-lg border border-gray-200">
                  <table className="w-full text-xs">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-4 py-2 text-left font-medium text-gray-500">Tipo</th>
                        <th className="px-4 py-2 text-right font-medium text-gray-500">Amostras</th>
                        <th className="px-4 py-2 text-right font-medium text-gray-500">Acurácia DI</th>
                        <th className="px-4 py-2 text-right font-medium text-gray-500">Acurácia GPT</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {Object.entries(accuracy.byTipoCartao).map(([tipo, stats]) => (
                        <tr key={tipo}>
                          <td className="px-4 py-2 text-gray-700">{tipo}</td>
                          <td className="px-4 py-2 text-right font-mono text-gray-600">{stats.total}</td>
                          <td className={`px-4 py-2 text-right font-mono ${stats.di >= 0.9 ? 'text-green-700' : stats.di >= 0.7 ? 'text-yellow-700' : 'text-red-700'}`}>
                            {formatPct(stats.di)}
                          </td>
                          <td className={`px-4 py-2 text-right font-mono ${stats.gpt >= 0.9 ? 'text-green-700' : stats.gpt >= 0.7 ? 'text-yellow-700' : 'text-red-700'}`}>
                            {formatPct(stats.gpt)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Corrections by user */}
            {accuracy.correctionsByUser.length > 0 && (
              <div>
                <h4 className="mb-2 text-sm font-medium text-gray-700">Correções por Revisor</h4>
                <div className="overflow-x-auto rounded-lg border border-gray-200">
                  <table className="w-full text-xs">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-4 py-2 text-left font-medium text-gray-500">Revisor</th>
                        <th className="px-4 py-2 text-left font-medium text-gray-500">Email</th>
                        <th className="px-4 py-2 text-right font-medium text-gray-500">Correções</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {accuracy.correctionsByUser.map((u) => (
                        <tr key={u.userId}>
                          <td className="px-4 py-2 font-medium text-gray-700">{u.nome}</td>
                          <td className="px-4 py-2 text-gray-500">{u.email}</td>
                          <td className="px-4 py-2 text-right font-mono font-semibold text-gray-900">{u.count}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Corrections detail table */}
            <div>
              <h4 className="mb-2 text-sm font-medium text-gray-700">Histórico de Correções</h4>
              {correctionsLoading ? (
                <p className="text-sm text-gray-400 py-4">Carregando...</p>
              ) : corrections.length > 0 ? (
                <>
                  <div className="overflow-x-auto rounded-lg border border-gray-200">
                    <table className="w-full text-xs">
                      <thead className="bg-gray-50">
                        <tr>
                          <th className="px-3 py-2 text-left font-medium text-gray-500">Data</th>
                          <th className="px-3 py-2 text-left font-medium text-gray-500">Revisor</th>
                          <th className="px-3 py-2 text-left font-medium text-gray-500">Funcionário</th>
                          <th className="px-3 py-2 text-left font-medium text-gray-500">Campo</th>
                          <th className="px-3 py-2 text-center font-medium text-gray-500">Valor Original</th>
                          <th className="px-3 py-2 text-center font-medium text-gray-500">Valor Corrigido</th>
                          <th className="px-3 py-2 text-center font-medium text-gray-500">PDF</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {corrections.map((c) => (
                          <tr key={c.id} className="hover:bg-gray-50">
                            <td className="px-3 py-2 text-gray-600 whitespace-nowrap">
                              {new Date(c.createdAt).toLocaleDateString('pt-BR')}{' '}
                              <span className="text-gray-400">
                                {new Date(c.createdAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                              </span>
                            </td>
                            <td className="px-3 py-2 text-gray-700">{c.user.nome}</td>
                            <td className="px-3 py-2 text-gray-700">{c.cartaoPonto.nomeExtraido ?? '—'}</td>
                            <td className="px-3 py-2 text-gray-600">{CAMPO_LABELS[c.campo] ?? c.campo}</td>
                            <td className="px-3 py-2 text-center">
                              <span className="rounded bg-red-50 px-2 py-0.5 font-mono text-red-700">
                                {c.valorAnterior ?? '—'}
                              </span>
                            </td>
                            <td className="px-3 py-2 text-center">
                              <span className="rounded bg-green-50 px-2 py-0.5 font-mono text-green-700">
                                {c.valorNovo ?? '—'}
                              </span>
                            </td>
                            <td className="px-3 py-2 text-center">
                              <a
                                href={`/revisao/${c.cartaoPonto.id}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1 text-blue-600 hover:text-blue-800"
                                title={`${c.cartaoPonto.upload.nomeArquivo} — pág. ${c.cartaoPonto.paginaPdf}`}
                              >
                                <ExternalLink size={12} />
                                p.{c.cartaoPonto.paginaPdf}
                              </a>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {/* Pagination */}
                  <div className="mt-3 flex items-center justify-between">
                    <p className="text-xs text-gray-500">
                      Página {correctionsPage} de {correctionsTotalPages}
                    </p>
                    <div className="flex gap-2">
                      <button
                        onClick={() => setCorrectionsPage((p) => Math.max(1, p - 1))}
                        disabled={correctionsPage <= 1}
                        className="flex items-center gap-1 rounded-md border border-gray-300 px-2 py-1 text-xs text-gray-600 hover:bg-gray-50 disabled:opacity-50"
                      >
                        <ChevronLeft size={12} /> Anterior
                      </button>
                      <button
                        onClick={() => setCorrectionsPage((p) => Math.min(correctionsTotalPages, p + 1))}
                        disabled={correctionsPage >= correctionsTotalPages}
                        className="flex items-center gap-1 rounded-md border border-gray-300 px-2 py-1 text-xs text-gray-600 hover:bg-gray-50 disabled:opacity-50"
                      >
                        Próxima <ChevronRight size={12} />
                      </button>
                    </div>
                  </div>
                </>
              ) : (
                <p className="py-4 text-sm text-gray-400">Nenhuma correção registrada ainda.</p>
              )}
            </div>
          </div>
        ) : (
          <div className="py-8 text-center text-sm text-gray-400">
            <p>Nenhum dado de acurácia disponível.</p>
            <p className="mt-1 text-xs">Aprove cartões na revisão para gerar ground truth.</p>
          </div>
        )}
      </div>

      {/* Status Breakdown */}
      {dashboard && dashboard.statusBreakdown.length > 0 && (
        <div className="rounded-xl bg-white p-6 shadow-sm">
          <h3 className="mb-4 text-lg font-semibold text-gray-900">
            Status dos Uploads
          </h3>
          <div className="space-y-3">
            {dashboard.statusBreakdown.map((item) => {
              const pct = totalStatus > 0 ? (item.count / totalStatus) * 100 : 0;
              const barColor = STATUS_COLORS[item.status] ?? 'bg-gray-400';
              const badgeColor = STATUS_BG[item.status] ?? 'bg-gray-100 text-gray-800';
              return (
                <div key={item.status} className="flex items-center gap-3">
                  <span
                    className={`inline-flex w-32 justify-center rounded-full px-2.5 py-0.5 text-xs font-medium ${badgeColor}`}
                  >
                    {item.status}
                  </span>
                  <div className="flex-1">
                    <div className="h-6 w-full rounded-full bg-gray-100">
                      <div
                        className={`h-6 rounded-full ${barColor} flex items-center justify-end pr-2`}
                        style={{ width: `${Math.max(pct, 2)}%` }}
                      >
                        <span className="text-xs font-medium text-white drop-shadow">
                          {item.count}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Uploads by Tenant */}
      {dashboard && dashboard.uploadsByTenant.length > 0 && (
        <div className="rounded-xl bg-white p-6 shadow-sm">
          <h3 className="mb-4 text-lg font-semibold text-gray-900">
            Uploads por Tenant (Top 10)
          </h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 text-left">
                  <th className="px-6 py-3 font-medium text-gray-500">#</th>
                  <th className="px-6 py-3 font-medium text-gray-500">Tenant</th>
                  <th className="px-6 py-3 font-medium text-gray-500">Uploads</th>
                </tr>
              </thead>
              <tbody>
                {dashboard.uploadsByTenant.map((item, idx) => (
                  <tr
                    key={item.tenantNome}
                    className="border-b border-gray-100 hover:bg-gray-50"
                  >
                    <td className="px-6 py-3 text-gray-400">{idx + 1}</td>
                    <td className="px-6 py-3 font-medium text-gray-900">
                      {item.tenantNome}
                    </td>
                    <td className="px-6 py-3 text-gray-600">{item.count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
