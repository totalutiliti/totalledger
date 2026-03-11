'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useAuth } from '@/hooks/use-auth';
import { api } from '@/lib/api';
import type { Empresa, Funcionario } from '@/lib/types';
import { Plus, Pencil, Trash2, X } from 'lucide-react';

interface FuncionarioForm {
  nome: string;
  cpf: string;
  matricula: string;
  cargo: string;
  empresaId: string;
}

const emptyForm: FuncionarioForm = {
  nome: '',
  cpf: '',
  matricula: '',
  cargo: '',
  empresaId: '',
};

export default function FuncionariosPage() {
  const { accessToken } = useAuth();
  const [funcionarios, setFuncionarios] = useState<Funcionario[]>([]);
  const [empresas, setEmpresas] = useState<Empresa[]>([]);
  const [filterEmpresaId, setFilterEmpresaId] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FuncionarioForm>(emptyForm);
  const [submitting, setSubmitting] = useState(false);

  const fetchEmpresas = useCallback(async () => {
    if (!accessToken) return;
    try {
      const response = await api.get<Empresa[]>('/api/v1/empresas', accessToken);
      setEmpresas(response.data);
    } catch {
      // silently fail
    }
  }, [accessToken]);

  const fetchFuncionarios = useCallback(async () => {
    if (!accessToken) return;
    try {
      const query = filterEmpresaId
        ? `/api/v1/funcionarios?empresaId=${filterEmpresaId}`
        : '/api/v1/funcionarios';
      const response = await api.get<Funcionario[]>(query, accessToken);
      setFuncionarios(response.data);
      setError('');
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Erro ao carregar funcionários',
      );
    } finally {
      setLoading(false);
    }
  }, [accessToken, filterEmpresaId]);

  useEffect(() => {
    void fetchEmpresas();
  }, [fetchEmpresas]);

  useEffect(() => {
    void fetchFuncionarios();
  }, [fetchFuncionarios]);

  const openCreate = () => {
    setForm(emptyForm);
    setEditingId(null);
    setShowModal(true);
  };

  const openEdit = (func: Funcionario) => {
    setForm({
      nome: func.nome,
      cpf: func.cpf,
      matricula: func.matricula ?? '',
      cargo: func.cargo ?? '',
      empresaId: func.empresaId,
    });
    setEditingId(func.id);
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
        cpf: form.cpf,
        matricula: form.matricula || null,
        cargo: form.cargo || null,
        empresaId: form.empresaId,
      };

      if (editingId) {
        await api.patch(
          `/api/v1/funcionarios/${editingId}`,
          payload,
          accessToken,
        );
      } else {
        await api.post('/api/v1/funcionarios', payload, accessToken);
      }

      setShowModal(false);
      void fetchFuncionarios();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Erro ao salvar funcionário',
      );
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (func: Funcionario) => {
    if (!accessToken) return;
    if (!confirm(`Deseja desativar o funcionário "${func.nome}"?`)) return;

    try {
      await api.delete(`/api/v1/funcionarios/${func.id}`, accessToken);
      void fetchFuncionarios();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Erro ao remover funcionário',
      );
    }
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
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <label htmlFor="filterEmpresa" className="text-sm text-gray-500">
            Filtrar por empresa:
          </label>
          <select
            id="filterEmpresa"
            value={filterEmpresaId}
            onChange={(e) => setFilterEmpresaId(e.target.value)}
            className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm focus:border-blue-500 focus:outline-none"
          >
            <option value="">Todas</option>
            {empresas.map((emp) => (
              <option key={emp.id} value={emp.id}>
                {emp.razaoSocial}
              </option>
            ))}
          </select>
        </div>

        <button
          onClick={openCreate}
          className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
        >
          <Plus size={16} />
          Novo Funcionário
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
                <th className="px-6 py-3 font-medium text-gray-500">CPF</th>
                <th className="px-6 py-3 font-medium text-gray-500">
                  Matrícula
                </th>
                <th className="px-6 py-3 font-medium text-gray-500">Cargo</th>
                <th className="px-6 py-3 font-medium text-gray-500">Empresa</th>
                <th className="px-6 py-3 font-medium text-gray-500">Status</th>
                <th className="px-6 py-3 font-medium text-gray-500">Ações</th>
              </tr>
            </thead>
            <tbody>
              {funcionarios.length === 0 ? (
                <tr>
                  <td
                    colSpan={7}
                    className="px-6 py-8 text-center text-gray-500"
                  >
                    Nenhum funcionário encontrado.
                  </td>
                </tr>
              ) : (
                funcionarios.map((func) => (
                  <tr
                    key={func.id}
                    className="border-b border-gray-100 hover:bg-gray-50"
                  >
                    <td className="px-6 py-4 font-medium text-gray-900">
                      {func.nome}
                    </td>
                    <td className="px-6 py-4 text-gray-600">{func.cpf}</td>
                    <td className="px-6 py-4 text-gray-600">
                      {func.matricula || '-'}
                    </td>
                    <td className="px-6 py-4 text-gray-600">
                      {func.cargo || '-'}
                    </td>
                    <td className="px-6 py-4 text-gray-600">
                      {func.empresa?.razaoSocial ?? '-'}
                    </td>
                    <td className="px-6 py-4">
                      <span
                        className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${
                          func.ativo
                            ? 'bg-green-100 text-green-700'
                            : 'bg-gray-100 text-gray-700'
                        }`}
                      >
                        {func.ativo ? 'Ativo' : 'Inativo'}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => openEdit(func)}
                          className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-blue-600"
                          title="Editar"
                        >
                          <Pencil size={16} />
                        </button>
                        <button
                          onClick={() => void handleDelete(func)}
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
                {editingId ? 'Editar Funcionário' : 'Novo Funcionário'}
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
                  htmlFor="funcNome"
                  className="mb-1 block text-sm font-medium text-gray-700"
                >
                  Nome *
                </label>
                <input
                  id="funcNome"
                  type="text"
                  required
                  value={form.nome}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, nome: e.target.value }))
                  }
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>

              <div>
                <label
                  htmlFor="funcCpf"
                  className="mb-1 block text-sm font-medium text-gray-700"
                >
                  CPF *
                </label>
                <input
                  id="funcCpf"
                  type="text"
                  required
                  value={form.cpf}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, cpf: e.target.value }))
                  }
                  placeholder="000.000.000-00"
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>

              <div>
                <label
                  htmlFor="funcEmpresa"
                  className="mb-1 block text-sm font-medium text-gray-700"
                >
                  Empresa *
                </label>
                <select
                  id="funcEmpresa"
                  required
                  value={form.empresaId}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, empresaId: e.target.value }))
                  }
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                >
                  <option value="">Selecione</option>
                  {empresas.map((emp) => (
                    <option key={emp.id} value={emp.id}>
                      {emp.razaoSocial}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label
                    htmlFor="funcMatricula"
                    className="mb-1 block text-sm font-medium text-gray-700"
                  >
                    Matrícula
                  </label>
                  <input
                    id="funcMatricula"
                    type="text"
                    value={form.matricula}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, matricula: e.target.value }))
                    }
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                </div>

                <div>
                  <label
                    htmlFor="funcCargo"
                    className="mb-1 block text-sm font-medium text-gray-700"
                  >
                    Cargo
                  </label>
                  <input
                    id="funcCargo"
                    type="text"
                    value={form.cargo}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, cargo: e.target.value }))
                    }
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
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
                  className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
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
