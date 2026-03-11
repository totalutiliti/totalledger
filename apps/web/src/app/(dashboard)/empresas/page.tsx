'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useAuth } from '@/hooks/use-auth';
import { api } from '@/lib/api';
import type { Empresa } from '@/lib/types';
import { Plus, Pencil, Trash2, X } from 'lucide-react';

interface EmpresaForm {
  razaoSocial: string;
  cnpj: string;
  nomeFantasia: string;
}

const emptyForm: EmpresaForm = { razaoSocial: '', cnpj: '', nomeFantasia: '' };

export default function EmpresasPage() {
  const { accessToken } = useAuth();
  const [empresas, setEmpresas] = useState<Empresa[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<EmpresaForm>(emptyForm);
  const [submitting, setSubmitting] = useState(false);

  const fetchEmpresas = useCallback(async () => {
    if (!accessToken) return;
    try {
      const response = await api.get<Empresa[]>('/api/v1/empresas', accessToken);
      setEmpresas(response.data);
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao carregar empresas');
    } finally {
      setLoading(false);
    }
  }, [accessToken]);

  useEffect(() => {
    void fetchEmpresas();
  }, [fetchEmpresas]);

  const openCreate = () => {
    setForm(emptyForm);
    setEditingId(null);
    setShowModal(true);
  };

  const openEdit = (empresa: Empresa) => {
    setForm({
      razaoSocial: empresa.razaoSocial,
      cnpj: empresa.cnpj,
      nomeFantasia: empresa.nomeFantasia ?? '',
    });
    setEditingId(empresa.id);
    setShowModal(true);
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!accessToken) return;
    setSubmitting(true);
    setError('');

    try {
      const payload = {
        razaoSocial: form.razaoSocial,
        cnpj: form.cnpj,
        nomeFantasia: form.nomeFantasia || null,
      };

      if (editingId) {
        await api.patch(`/api/v1/empresas/${editingId}`, payload, accessToken);
      } else {
        await api.post('/api/v1/empresas', payload, accessToken);
      }

      setShowModal(false);
      void fetchEmpresas();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao salvar empresa');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (empresa: Empresa) => {
    if (!accessToken) return;
    if (!confirm(`Deseja desativar a empresa "${empresa.razaoSocial}"?`)) return;

    try {
      await api.delete(`/api/v1/empresas/${empresa.id}`, accessToken);
      void fetchEmpresas();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao remover empresa');
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
      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-500">
          {empresas.length} empresa(s) cadastrada(s)
        </p>
        <button
          onClick={openCreate}
          className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
        >
          <Plus size={16} />
          Nova Empresa
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
                  Razão Social
                </th>
                <th className="px-6 py-3 font-medium text-gray-500">CNPJ</th>
                <th className="px-6 py-3 font-medium text-gray-500">
                  Nome Fantasia
                </th>
                <th className="px-6 py-3 font-medium text-gray-500">Status</th>
                <th className="px-6 py-3 font-medium text-gray-500">Ações</th>
              </tr>
            </thead>
            <tbody>
              {empresas.length === 0 ? (
                <tr>
                  <td
                    colSpan={5}
                    className="px-6 py-8 text-center text-gray-500"
                  >
                    Nenhuma empresa cadastrada.
                  </td>
                </tr>
              ) : (
                empresas.map((empresa) => (
                  <tr
                    key={empresa.id}
                    className="border-b border-gray-100 hover:bg-gray-50"
                  >
                    <td className="px-6 py-4 font-medium text-gray-900">
                      {empresa.razaoSocial}
                    </td>
                    <td className="px-6 py-4 text-gray-600">{empresa.cnpj}</td>
                    <td className="px-6 py-4 text-gray-600">
                      {empresa.nomeFantasia || '-'}
                    </td>
                    <td className="px-6 py-4">
                      <span
                        className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${
                          empresa.ativa
                            ? 'bg-green-100 text-green-700'
                            : 'bg-gray-100 text-gray-700'
                        }`}
                      >
                        {empresa.ativa ? 'Ativa' : 'Inativa'}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => openEdit(empresa)}
                          className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-blue-600"
                          title="Editar"
                        >
                          <Pencil size={16} />
                        </button>
                        <button
                          onClick={() => void handleDelete(empresa)}
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
                {editingId ? 'Editar Empresa' : 'Nova Empresa'}
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
                  htmlFor="razaoSocial"
                  className="mb-1 block text-sm font-medium text-gray-700"
                >
                  Razão Social *
                </label>
                <input
                  id="razaoSocial"
                  type="text"
                  required
                  value={form.razaoSocial}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, razaoSocial: e.target.value }))
                  }
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>

              <div>
                <label
                  htmlFor="cnpj"
                  className="mb-1 block text-sm font-medium text-gray-700"
                >
                  CNPJ *
                </label>
                <input
                  id="cnpj"
                  type="text"
                  required
                  value={form.cnpj}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, cnpj: e.target.value }))
                  }
                  placeholder="00.000.000/0000-00"
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>

              <div>
                <label
                  htmlFor="nomeFantasia"
                  className="mb-1 block text-sm font-medium text-gray-700"
                >
                  Nome Fantasia
                </label>
                <input
                  id="nomeFantasia"
                  type="text"
                  value={form.nomeFantasia}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, nomeFantasia: e.target.value }))
                  }
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
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
