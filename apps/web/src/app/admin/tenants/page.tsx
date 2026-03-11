'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useAuthContext } from '@/lib/auth-context';
import { api } from '@/lib/api';
import type { Tenant } from '@/lib/types';
import { Plus, Pencil, Trash2, X } from 'lucide-react';

interface TenantForm {
  nome: string;
  cnpj: string;
  plano: 'STARTER' | 'PROFESSIONAL' | 'ENTERPRISE';
  ativo: boolean;
  suspenso: boolean;
}

const emptyForm: TenantForm = {
  nome: '',
  cnpj: '',
  plano: 'STARTER',
  ativo: true,
  suspenso: false,
};

const PLANO_BADGE: Record<string, string> = {
  STARTER: 'bg-gray-100 text-gray-700',
  PROFESSIONAL: 'bg-blue-100 text-blue-700',
  ENTERPRISE: 'bg-purple-100 text-purple-700',
};

export default function TenantsPage() {
  const { accessToken } = useAuthContext();
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<TenantForm>(emptyForm);
  const [submitting, setSubmitting] = useState(false);

  const fetchTenants = useCallback(async () => {
    if (!accessToken) return;
    try {
      const response = await api.get<Tenant[]>('/api/v1/tenants', accessToken);
      setTenants(response.data);
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao carregar tenants');
    } finally {
      setLoading(false);
    }
  }, [accessToken]);

  useEffect(() => {
    void fetchTenants();
  }, [fetchTenants]);

  const openCreate = () => {
    setForm(emptyForm);
    setEditingId(null);
    setShowModal(true);
  };

  const openEdit = (tenant: Tenant) => {
    setForm({
      nome: tenant.nome,
      cnpj: tenant.cnpj,
      plano: tenant.plano,
      ativo: tenant.ativo,
      suspenso: tenant.suspenso,
    });
    setEditingId(tenant.id);
    setShowModal(true);
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!accessToken) return;
    setSubmitting(true);
    setError('');

    try {
      const payload = {
        nome: form.nome,
        cnpj: form.cnpj,
        plano: form.plano,
        ativo: form.ativo,
        suspenso: form.suspenso,
      };

      if (editingId) {
        await api.patch(`/api/v1/tenants/${editingId}`, payload, accessToken);
      } else {
        await api.post('/api/v1/tenants', payload, accessToken);
      }

      setShowModal(false);
      void fetchTenants();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao salvar tenant');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (tenant: Tenant) => {
    if (!accessToken) return;
    if (!confirm(`Deseja desativar o tenant "${tenant.nome}"?`)) return;

    try {
      await api.delete(`/api/v1/tenants/${tenant.id}`, accessToken);
      void fetchTenants();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao remover tenant');
    }
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString('pt-BR');
  };

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
          {tenants.length} tenant(s) cadastrado(s)
        </p>
        <button
          onClick={openCreate}
          className="flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
        >
          <Plus size={16} />
          Novo Tenant
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
                <th className="px-6 py-3 font-medium text-gray-500">Nome</th>
                <th className="px-6 py-3 font-medium text-gray-500">CNPJ</th>
                <th className="px-6 py-3 font-medium text-gray-500">Plano</th>
                <th className="px-6 py-3 font-medium text-gray-500">Ativo</th>
                <th className="px-6 py-3 font-medium text-gray-500">Suspenso</th>
                <th className="px-6 py-3 font-medium text-gray-500">Criado em</th>
                <th className="px-6 py-3 font-medium text-gray-500">Ações</th>
              </tr>
            </thead>
            <tbody>
              {tenants.length === 0 ? (
                <tr>
                  <td
                    colSpan={7}
                    className="px-6 py-8 text-center text-gray-500"
                  >
                    Nenhum tenant cadastrado.
                  </td>
                </tr>
              ) : (
                tenants.map((tenant) => (
                  <tr
                    key={tenant.id}
                    className="border-b border-gray-100 hover:bg-gray-50"
                  >
                    <td className="px-6 py-4 font-medium text-gray-900">
                      {tenant.nome}
                    </td>
                    <td className="px-6 py-4 text-gray-600">{tenant.cnpj}</td>
                    <td className="px-6 py-4">
                      <span
                        className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${PLANO_BADGE[tenant.plano] ?? 'bg-gray-100 text-gray-700'}`}
                      >
                        {tenant.plano}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      <span
                        className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${
                          tenant.ativo
                            ? 'bg-green-100 text-green-700'
                            : 'bg-gray-100 text-gray-700'
                        }`}
                      >
                        {tenant.ativo ? 'Sim' : 'Não'}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      <span
                        className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${
                          tenant.suspenso
                            ? 'bg-red-100 text-red-700'
                            : 'bg-green-100 text-green-700'
                        }`}
                      >
                        {tenant.suspenso ? 'Sim' : 'Não'}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-gray-600">
                      {formatDate(tenant.createdAt)}
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => openEdit(tenant)}
                          className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-indigo-600"
                          title="Editar"
                        >
                          <Pencil size={16} />
                        </button>
                        <button
                          onClick={() => void handleDelete(tenant)}
                          className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-red-600"
                          title="Desativar"
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-lg font-semibold text-gray-900">
                {editingId ? 'Editar Tenant' : 'Novo Tenant'}
              </h3>
              <button
                onClick={() => setShowModal(false)}
                className="rounded p-1 text-gray-400 hover:bg-gray-100"
              >
                <X size={20} />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label
                  htmlFor="tenantNome"
                  className="mb-1 block text-sm font-medium text-gray-700"
                >
                  Nome *
                </label>
                <input
                  id="tenantNome"
                  type="text"
                  required
                  value={form.nome}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, nome: e.target.value }))
                  }
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                />
              </div>

              <div>
                <label
                  htmlFor="tenantCnpj"
                  className="mb-1 block text-sm font-medium text-gray-700"
                >
                  CNPJ *
                </label>
                <input
                  id="tenantCnpj"
                  type="text"
                  required
                  value={form.cnpj}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, cnpj: e.target.value }))
                  }
                  placeholder="00.000.000/0000-00"
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                />
              </div>

              <div>
                <label
                  htmlFor="tenantPlano"
                  className="mb-1 block text-sm font-medium text-gray-700"
                >
                  Plano *
                </label>
                <select
                  id="tenantPlano"
                  required
                  value={form.plano}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      plano: e.target.value as TenantForm['plano'],
                    }))
                  }
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                >
                  <option value="STARTER">STARTER</option>
                  <option value="PROFESSIONAL">PROFESSIONAL</option>
                  <option value="ENTERPRISE">ENTERPRISE</option>
                </select>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="flex items-center gap-2">
                  <input
                    id="tenantAtivo"
                    type="checkbox"
                    checked={form.ativo}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, ativo: e.target.checked }))
                    }
                    className="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                  />
                  <label
                    htmlFor="tenantAtivo"
                    className="text-sm font-medium text-gray-700"
                  >
                    Ativo
                  </label>
                </div>

                <div className="flex items-center gap-2">
                  <input
                    id="tenantSuspenso"
                    type="checkbox"
                    checked={form.suspenso}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, suspenso: e.target.checked }))
                    }
                    className="h-4 w-4 rounded border-gray-300 text-red-600 focus:ring-red-500"
                  />
                  <label
                    htmlFor="tenantSuspenso"
                    className="text-sm font-medium text-gray-700"
                  >
                    Suspenso
                  </label>
                </div>
              </div>

              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
                >
                  {submitting ? 'Salvando...' : 'Salvar'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
