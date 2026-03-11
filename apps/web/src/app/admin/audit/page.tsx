'use client';

import { useCallback, useEffect, useState } from 'react';
import { useAuthContext } from '@/lib/auth-context';
import { api } from '@/lib/api';
import type { AuditLog, Tenant } from '@/lib/types';
import { ChevronLeft, ChevronRight } from 'lucide-react';

export default function AuditPage() {
  const { accessToken } = useAuthContext();
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Filters
  const [filterTenantId, setFilterTenantId] = useState('');
  const [filterUser, setFilterUser] = useState('');
  const [filterAction, setFilterAction] = useState('');
  const [filterDateFrom, setFilterDateFrom] = useState('');
  const [filterDateTo, setFilterDateTo] = useState('');

  // Pagination
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const limit = 20;

  const fetchTenants = useCallback(async () => {
    if (!accessToken) return;
    try {
      const response = await api.get<Tenant[]>('/api/v1/tenants', accessToken);
      setTenants(response.data);
    } catch {
      // silently fail
    }
  }, [accessToken]);

  const fetchLogs = useCallback(async () => {
    if (!accessToken) return;
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set('page', String(page));
      params.set('limit', String(limit));
      if (filterTenantId) params.set('tenantId', filterTenantId);
      if (filterUser) params.set('user', filterUser);
      if (filterAction) params.set('action', filterAction);
      if (filterDateFrom) params.set('dateFrom', filterDateFrom);
      if (filterDateTo) params.set('dateTo', filterDateTo);

      const response = await api.get<AuditLog[]>(
        `/api/v1/audit-logs?${params.toString()}`,
        accessToken,
      );
      setLogs(response.data);
      setTotal(response.meta?.total ?? 0);
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao carregar logs');
    } finally {
      setLoading(false);
    }
  }, [accessToken, page, filterTenantId, filterUser, filterAction, filterDateFrom, filterDateTo]);

  useEffect(() => {
    void fetchTenants();
  }, [fetchTenants]);

  useEffect(() => {
    void fetchLogs();
  }, [fetchLogs]);

  const totalPages = Math.ceil(total / limit) || 1;

  const formatDateTime = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  };

  const formatDetails = (details: Record<string, unknown> | null) => {
    if (!details) return '-';
    try {
      return JSON.stringify(details, null, 0).slice(0, 120);
    } catch {
      return '-';
    }
  };

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label htmlFor="auditTenant" className="mb-1 block text-xs text-gray-500">
            Tenant
          </label>
          <select
            id="auditTenant"
            value={filterTenantId}
            onChange={(e) => {
              setFilterTenantId(e.target.value);
              setPage(1);
            }}
            className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm focus:border-indigo-500 focus:outline-none"
          >
            <option value="">Todos</option>
            {tenants.map((t) => (
              <option key={t.id} value={t.id}>
                {t.nome}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="auditUser" className="mb-1 block text-xs text-gray-500">
            Usuário
          </label>
          <input
            id="auditUser"
            type="text"
            value={filterUser}
            onChange={(e) => {
              setFilterUser(e.target.value);
              setPage(1);
            }}
            placeholder="Nome ou email"
            className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm focus:border-indigo-500 focus:outline-none"
          />
        </div>

        <div>
          <label htmlFor="auditAction" className="mb-1 block text-xs text-gray-500">
            Ação
          </label>
          <input
            id="auditAction"
            type="text"
            value={filterAction}
            onChange={(e) => {
              setFilterAction(e.target.value);
              setPage(1);
            }}
            placeholder="CREATE, UPDATE..."
            className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm focus:border-indigo-500 focus:outline-none"
          />
        </div>

        <div>
          <label htmlFor="auditDateFrom" className="mb-1 block text-xs text-gray-500">
            De
          </label>
          <input
            id="auditDateFrom"
            type="date"
            value={filterDateFrom}
            onChange={(e) => {
              setFilterDateFrom(e.target.value);
              setPage(1);
            }}
            className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm focus:border-indigo-500 focus:outline-none"
          />
        </div>

        <div>
          <label htmlFor="auditDateTo" className="mb-1 block text-xs text-gray-500">
            Até
          </label>
          <input
            id="auditDateTo"
            type="date"
            value={filterDateTo}
            onChange={(e) => {
              setFilterDateTo(e.target.value);
              setPage(1);
            }}
            className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm focus:border-indigo-500 focus:outline-none"
          />
        </div>
      </div>

      {error && (
        <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <p className="text-gray-500">Carregando...</p>
        </div>
      ) : (
        <>
          <div className="rounded-xl bg-white shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200 text-left">
                    <th className="px-6 py-3 font-medium text-gray-500">Data/Hora</th>
                    <th className="px-6 py-3 font-medium text-gray-500">Tenant</th>
                    <th className="px-6 py-3 font-medium text-gray-500">Usuário</th>
                    <th className="px-6 py-3 font-medium text-gray-500">Ação</th>
                    <th className="px-6 py-3 font-medium text-gray-500">Entidade</th>
                    <th className="px-6 py-3 font-medium text-gray-500">Detalhes</th>
                  </tr>
                </thead>
                <tbody>
                  {logs.length === 0 ? (
                    <tr>
                      <td
                        colSpan={6}
                        className="px-6 py-8 text-center text-gray-500"
                      >
                        Nenhum log encontrado.
                      </td>
                    </tr>
                  ) : (
                    logs.map((log) => (
                      <tr
                        key={log.id}
                        className="border-b border-gray-100 hover:bg-gray-50"
                      >
                        <td className="whitespace-nowrap px-6 py-4 text-gray-600">
                          {formatDateTime(log.createdAt)}
                        </td>
                        <td className="px-6 py-4 text-gray-600">
                          {log.tenant?.nome ?? '-'}
                        </td>
                        <td className="px-6 py-4 text-gray-600">
                          {log.user?.nome ?? '-'}
                          {log.user?.email ? (
                            <span className="block text-xs text-gray-400">
                              {log.user.email}
                            </span>
                          ) : null}
                        </td>
                        <td className="px-6 py-4">
                          <span className="inline-flex rounded-full bg-indigo-100 px-2.5 py-0.5 text-xs font-medium text-indigo-700">
                            {log.action}
                          </span>
                        </td>
                        <td className="px-6 py-4 text-gray-600">
                          {log.entity}
                          {log.entityId ? (
                            <span className="block truncate text-xs text-gray-400">
                              {log.entityId}
                            </span>
                          ) : null}
                        </td>
                        <td className="max-w-xs truncate px-6 py-4 text-xs text-gray-500">
                          {formatDetails(log.details)}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Pagination */}
          <div className="flex items-center justify-between">
            <p className="text-sm text-gray-500">
              {total} registro(s) - Página {page} de {totalPages}
            </p>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
                className="rounded-lg border border-gray-300 p-2 text-gray-500 hover:bg-gray-50 disabled:opacity-50"
              >
                <ChevronLeft size={16} />
              </button>
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
                className="rounded-lg border border-gray-300 p-2 text-gray-500 hover:bg-gray-50 disabled:opacity-50"
              >
                <ChevronRight size={16} />
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
