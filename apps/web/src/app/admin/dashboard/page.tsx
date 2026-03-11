'use client';

import { useEffect, useState, useCallback } from 'react';
import { useAuthContext } from '@/lib/auth-context';
import { api } from '@/lib/api';
import type { GlobalDashboard } from '@/lib/types';
import {
  Building2,
  Users,
  Upload,
  CreditCard,
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

export default function AdminDashboardPage() {
  const { accessToken } = useAuthContext();
  const [dashboard, setDashboard] = useState<GlobalDashboard | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

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

  useEffect(() => {
    void fetchDashboard();
  }, [fetchDashboard]);

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
