'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useAuthContext } from '@/lib/auth-context';
import { api } from '@/lib/api';
import type { AdminUser, Tenant } from '@/lib/types';
import { Plus, Pencil, X } from 'lucide-react';

interface UserCreateForm {
  tenantId: string;
  email: string;
  nome: string;
  role: 'ADMIN' | 'SUPERVISOR' | 'ANALISTA';
  password: string;
}

interface UserEditForm {
  nome: string;
  role: 'ADMIN' | 'SUPERVISOR' | 'ANALISTA';
  ativo: boolean;
}

const emptyCreateForm: UserCreateForm = {
  tenantId: '',
  email: '',
  nome: '',
  role: 'ANALISTA',
  password: '',
};

const emptyEditForm: UserEditForm = {
  nome: '',
  role: 'ANALISTA',
  ativo: true,
};

const ROLE_BADGE: Record<string, string> = {
  SUPER_ADMIN: 'bg-red-100 text-red-700',
  ADMIN: 'bg-blue-100 text-blue-700',
  SUPERVISOR: 'bg-yellow-100 text-yellow-700',
  ANALISTA: 'bg-green-100 text-green-700',
};

export default function UsersPage() {
  const { accessToken } = useAuthContext();
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [filterTenantId, setFilterTenantId] = useState('');
  const [filterRole, setFilterRole] = useState('');
  const [filterAtivo, setFilterAtivo] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [createForm, setCreateForm] = useState<UserCreateForm>(emptyCreateForm);
  const [editForm, setEditForm] = useState<UserEditForm>(emptyEditForm);
  const [submitting, setSubmitting] = useState(false);

  const fetchTenants = useCallback(async () => {
    if (!accessToken) return;
    try {
      const response = await api.get<Tenant[]>('/api/v1/tenants', accessToken);
      setTenants(response.data);
    } catch {
      // silently fail
    }
  }, [accessToken]);

  const fetchUsers = useCallback(async () => {
    if (!accessToken) return;
    try {
      const params = new URLSearchParams();
      if (filterTenantId) params.set('tenantId', filterTenantId);
      if (filterRole) params.set('role', filterRole);
      if (filterAtivo) params.set('ativo', filterAtivo);
      const query = params.toString();
      const path = query ? `/api/v1/users?${query}` : '/api/v1/users';
      const response = await api.get<AdminUser[]>(path, accessToken);
      setUsers(response.data);
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao carregar usuários');
    } finally {
      setLoading(false);
    }
  }, [accessToken, filterTenantId, filterRole, filterAtivo]);

  useEffect(() => {
    void fetchTenants();
  }, [fetchTenants]);

  useEffect(() => {
    void fetchUsers();
  }, [fetchUsers]);

  const openCreate = () => {
    setCreateForm(emptyCreateForm);
    setShowCreateModal(true);
  };

  const openEdit = (user: AdminUser) => {
    setEditForm({
      nome: user.nome,
      role: user.role === 'SUPER_ADMIN' ? 'ADMIN' : user.role,
      ativo: user.ativo,
    });
    setEditingId(user.id);
    setShowEditModal(true);
  };

  const handleCreate = async (e: FormEvent) => {
    e.preventDefault();
    if (!accessToken) return;
    setSubmitting(true);
    setError('');

    try {
      await api.post(
        '/api/v1/users',
        {
          tenantId: createForm.tenantId,
          email: createForm.email,
          nome: createForm.nome,
          role: createForm.role,
          password: createForm.password,
        },
        accessToken,
      );
      setShowCreateModal(false);
      void fetchUsers();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao criar usuário');
    } finally {
      setSubmitting(false);
    }
  };

  const handleEdit = async (e: FormEvent) => {
    e.preventDefault();
    if (!accessToken || !editingId) return;
    setSubmitting(true);
    setError('');

    try {
      await api.patch(
        `/api/v1/users/${editingId}`,
        {
          nome: editForm.nome,
          role: editForm.role,
          ativo: editForm.ativo,
        },
        accessToken,
      );
      setShowEditModal(false);
      void fetchUsers();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao atualizar usuário');
    } finally {
      setSubmitting(false);
    }
  };

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return '-';
    return new Date(dateStr).toLocaleDateString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
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
      {/* Filters */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <label htmlFor="filterTenant" className="text-sm text-gray-500">
              Tenant:
            </label>
            <select
              id="filterTenant"
              value={filterTenantId}
              onChange={(e) => setFilterTenantId(e.target.value)}
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

          <div className="flex items-center gap-2">
            <label htmlFor="filterRole" className="text-sm text-gray-500">
              Role:
            </label>
            <select
              id="filterRole"
              value={filterRole}
              onChange={(e) => setFilterRole(e.target.value)}
              className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm focus:border-indigo-500 focus:outline-none"
            >
              <option value="">Todos</option>
              <option value="ADMIN">ADMIN</option>
              <option value="SUPERVISOR">SUPERVISOR</option>
              <option value="ANALISTA">ANALISTA</option>
            </select>
          </div>

          <div className="flex items-center gap-2">
            <label htmlFor="filterAtivo" className="text-sm text-gray-500">
              Ativo:
            </label>
            <select
              id="filterAtivo"
              value={filterAtivo}
              onChange={(e) => setFilterAtivo(e.target.value)}
              className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm focus:border-indigo-500 focus:outline-none"
            >
              <option value="">Todos</option>
              <option value="true">Sim</option>
              <option value="false">Não</option>
            </select>
          </div>
        </div>

        <button
          onClick={openCreate}
          className="flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
        >
          <Plus size={16} />
          Novo Usuário
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
                <th className="px-6 py-3 font-medium text-gray-500">Email</th>
                <th className="px-6 py-3 font-medium text-gray-500">Role</th>
                <th className="px-6 py-3 font-medium text-gray-500">Tenant</th>
                <th className="px-6 py-3 font-medium text-gray-500">Ativo</th>
                <th className="px-6 py-3 font-medium text-gray-500">Último Login</th>
                <th className="px-6 py-3 font-medium text-gray-500">Ações</th>
              </tr>
            </thead>
            <tbody>
              {users.length === 0 ? (
                <tr>
                  <td
                    colSpan={7}
                    className="px-6 py-8 text-center text-gray-500"
                  >
                    Nenhum usuário encontrado.
                  </td>
                </tr>
              ) : (
                users.map((u) => (
                  <tr
                    key={u.id}
                    className="border-b border-gray-100 hover:bg-gray-50"
                  >
                    <td className="px-6 py-4 font-medium text-gray-900">
                      {u.nome}
                    </td>
                    <td className="px-6 py-4 text-gray-600">{u.email}</td>
                    <td className="px-6 py-4">
                      <span
                        className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${ROLE_BADGE[u.role] ?? 'bg-gray-100 text-gray-700'}`}
                      >
                        {u.role}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-gray-600">
                      {u.tenant?.nome ?? '-'}
                    </td>
                    <td className="px-6 py-4">
                      <span
                        className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${
                          u.ativo
                            ? 'bg-green-100 text-green-700'
                            : 'bg-gray-100 text-gray-700'
                        }`}
                      >
                        {u.ativo ? 'Sim' : 'Não'}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-gray-600">
                      {formatDate(u.lastLoginAt)}
                    </td>
                    <td className="px-6 py-4">
                      <button
                        onClick={() => openEdit(u)}
                        className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-indigo-600"
                        title="Editar"
                      >
                        <Pencil size={16} />
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Create Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-lg font-semibold text-gray-900">
                Novo Usuário
              </h3>
              <button
                onClick={() => setShowCreateModal(false)}
                className="rounded p-1 text-gray-400 hover:bg-gray-100"
              >
                <X size={20} />
              </button>
            </div>

            <form onSubmit={handleCreate} className="space-y-4">
              <div>
                <label
                  htmlFor="userTenant"
                  className="mb-1 block text-sm font-medium text-gray-700"
                >
                  Tenant *
                </label>
                <select
                  id="userTenant"
                  required
                  value={createForm.tenantId}
                  onChange={(e) =>
                    setCreateForm((f) => ({ ...f, tenantId: e.target.value }))
                  }
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                >
                  <option value="">Selecione</option>
                  {tenants.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.nome}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label
                  htmlFor="userEmail"
                  className="mb-1 block text-sm font-medium text-gray-700"
                >
                  Email *
                </label>
                <input
                  id="userEmail"
                  type="email"
                  required
                  value={createForm.email}
                  onChange={(e) =>
                    setCreateForm((f) => ({ ...f, email: e.target.value }))
                  }
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                />
              </div>

              <div>
                <label
                  htmlFor="userNome"
                  className="mb-1 block text-sm font-medium text-gray-700"
                >
                  Nome *
                </label>
                <input
                  id="userNome"
                  type="text"
                  required
                  value={createForm.nome}
                  onChange={(e) =>
                    setCreateForm((f) => ({ ...f, nome: e.target.value }))
                  }
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                />
              </div>

              <div>
                <label
                  htmlFor="userRole"
                  className="mb-1 block text-sm font-medium text-gray-700"
                >
                  Role *
                </label>
                <select
                  id="userRole"
                  required
                  value={createForm.role}
                  onChange={(e) =>
                    setCreateForm((f) => ({
                      ...f,
                      role: e.target.value as UserCreateForm['role'],
                    }))
                  }
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                >
                  <option value="ADMIN">ADMIN</option>
                  <option value="SUPERVISOR">SUPERVISOR</option>
                  <option value="ANALISTA">ANALISTA</option>
                </select>
              </div>

              <div>
                <label
                  htmlFor="userPassword"
                  className="mb-1 block text-sm font-medium text-gray-700"
                >
                  Senha *
                </label>
                <input
                  id="userPassword"
                  type="password"
                  required
                  value={createForm.password}
                  onChange={(e) =>
                    setCreateForm((f) => ({ ...f, password: e.target.value }))
                  }
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                />
              </div>

              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
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

      {/* Edit Modal */}
      {showEditModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-lg font-semibold text-gray-900">
                Editar Usuário
              </h3>
              <button
                onClick={() => setShowEditModal(false)}
                className="rounded p-1 text-gray-400 hover:bg-gray-100"
              >
                <X size={20} />
              </button>
            </div>

            <form onSubmit={handleEdit} className="space-y-4">
              <div>
                <label
                  htmlFor="editNome"
                  className="mb-1 block text-sm font-medium text-gray-700"
                >
                  Nome *
                </label>
                <input
                  id="editNome"
                  type="text"
                  required
                  value={editForm.nome}
                  onChange={(e) =>
                    setEditForm((f) => ({ ...f, nome: e.target.value }))
                  }
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                />
              </div>

              <div>
                <label
                  htmlFor="editRole"
                  className="mb-1 block text-sm font-medium text-gray-700"
                >
                  Role *
                </label>
                <select
                  id="editRole"
                  required
                  value={editForm.role}
                  onChange={(e) =>
                    setEditForm((f) => ({
                      ...f,
                      role: e.target.value as UserEditForm['role'],
                    }))
                  }
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                >
                  <option value="ADMIN">ADMIN</option>
                  <option value="SUPERVISOR">SUPERVISOR</option>
                  <option value="ANALISTA">ANALISTA</option>
                </select>
              </div>

              <div className="flex items-center gap-2">
                <input
                  id="editAtivo"
                  type="checkbox"
                  checked={editForm.ativo}
                  onChange={(e) =>
                    setEditForm((f) => ({ ...f, ativo: e.target.checked }))
                  }
                  className="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                />
                <label
                  htmlFor="editAtivo"
                  className="text-sm font-medium text-gray-700"
                >
                  Ativo
                </label>
              </div>

              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowEditModal(false)}
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
