'use client';

import { useEffect, useState, useCallback } from 'react';
import { useAuth } from '@/hooks/use-auth';
import { api } from '@/lib/api';
import type { DashboardResumo } from '@/lib/types';
import {
  Upload,
  CheckCircle2,
  Clock,
  ShieldCheck,
  AlertTriangle,
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

export default function DashboardPage() {
  const { accessToken } = useAuth();
  const [resumo, setResumo] = useState<DashboardResumo | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const fetchResumo = useCallback(async () => {
    if (!accessToken) return;
    try {
      const response = await api.get<DashboardResumo>(
        '/api/v1/dashboard/resumo',
        accessToken,
      );
      setResumo(response.data);
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao carregar dashboard');
    } finally {
      setLoading(false);
    }
  }, [accessToken]);

  useEffect(() => {
    void fetchResumo();
  }, [fetchResumo]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <p className="text-gray-500">Carregando dados...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg bg-red-50 p-4 text-sm text-red-700">{error}</div>
    );
  }

  const stats: StatCard[] = [
    {
      label: 'Total Uploads',
      value: resumo?.totalUploads ?? 0,
      icon: Upload,
      color: 'text-blue-600',
      bgColor: 'bg-blue-100',
    },
    {
      label: 'Processados',
      value: resumo?.processados ?? 0,
      icon: CheckCircle2,
      color: 'text-green-600',
      bgColor: 'bg-green-100',
    },
    {
      label: 'Pendentes de Revisão',
      value: resumo?.pendentesRevisao ?? 0,
      icon: Clock,
      color: 'text-yellow-600',
      bgColor: 'bg-yellow-100',
    },
    {
      label: 'Validados',
      value: resumo?.validados ?? 0,
      icon: ShieldCheck,
      color: 'text-emerald-600',
      bgColor: 'bg-emerald-100',
    },
    {
      label: 'Erros',
      value: resumo?.erros ?? 0,
      icon: AlertTriangle,
      color: 'text-red-600',
      bgColor: 'bg-red-100',
    },
  ];

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
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

      {resumo && (
        <div className="rounded-xl bg-white p-6 shadow-sm">
          <h3 className="mb-4 text-lg font-semibold text-gray-900">
            Visão Geral
          </h3>
          <div className="space-y-3">
            {stats.map((stat) => {
              const maxValue = Math.max(
                resumo.totalUploads,
                resumo.processados,
                resumo.pendentesRevisao,
                resumo.validados,
                resumo.erros,
                1,
              );
              const pct = (stat.value / maxValue) * 100;
              return (
                <div key={stat.label} className="flex items-center gap-3">
                  <span className="w-40 text-sm text-gray-600">{stat.label}</span>
                  <div className="flex-1">
                    <div className="h-6 w-full rounded-full bg-gray-100">
                      <div
                        className={`h-6 rounded-full ${stat.bgColor} flex items-center justify-end pr-2`}
                        style={{ width: `${Math.max(pct, 2)}%` }}
                      >
                        <span className="text-xs font-medium text-gray-700">
                          {stat.value}
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
    </div>
  );
}
