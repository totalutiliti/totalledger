'use client';

import { useState, type FormEvent } from 'react';
import { useAuth } from '@/hooks/use-auth';
import { api } from '@/lib/api';
import { User, Lock } from 'lucide-react';

export default function ConfiguracoesPage() {
  const { user, accessToken } = useAuth();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const handleChangePassword = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess('');

    if (newPassword !== confirmPassword) {
      setError('A nova senha e a confirmação não coincidem.');
      return;
    }

    if (newPassword.length < 8) {
      setError('A nova senha deve ter pelo menos 8 caracteres.');
      return;
    }

    setSubmitting(true);

    try {
      await api.post(
        '/api/v1/auth/change-password',
        {
          currentPassword,
          newPassword,
        },
        accessToken ?? undefined,
      );

      setSuccess('Senha alterada com sucesso!');
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao alterar senha');
    } finally {
      setSubmitting(false);
    }
  };

  const roleLabels: Record<string, string> = {
    SUPER_ADMIN: 'Super Administrador',
    ADMIN: 'Administrador',
    OPERADOR: 'Operador',
    REVISOR: 'Revisor',
  };

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      {/* User Info */}
      <div className="rounded-xl bg-white p-6 shadow-sm">
        <div className="mb-4 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-100">
            <User size={20} className="text-blue-600" />
          </div>
          <h2 className="text-lg font-semibold text-gray-900">
            Informações do Usuário
          </h2>
        </div>

        {user && (
          <div className="space-y-3">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <p className="text-xs font-medium uppercase text-gray-500">
                  Nome
                </p>
                <p className="text-sm text-gray-900">{user.nome}</p>
              </div>
              <div>
                <p className="text-xs font-medium uppercase text-gray-500">
                  E-mail
                </p>
                <p className="text-sm text-gray-900">{user.email}</p>
              </div>
              <div>
                <p className="text-xs font-medium uppercase text-gray-500">
                  Perfil
                </p>
                <p className="text-sm text-gray-900">
                  {roleLabels[user.role] ?? user.role}
                </p>
              </div>
              <div>
                <p className="text-xs font-medium uppercase text-gray-500">
                  Tenant
                </p>
                <p className="truncate text-sm text-gray-900">
                  {user.tenantId}
                </p>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Change Password */}
      <div className="rounded-xl bg-white p-6 shadow-sm">
        <div className="mb-4 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-yellow-100">
            <Lock size={20} className="text-yellow-600" />
          </div>
          <h2 className="text-lg font-semibold text-gray-900">Alterar Senha</h2>
        </div>

        {error && (
          <div className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">
            {error}
          </div>
        )}

        {success && (
          <div className="mb-4 rounded-lg bg-green-50 p-3 text-sm text-green-700">
            {success}
          </div>
        )}

        <form onSubmit={handleChangePassword} className="space-y-4">
          <div>
            <label
              htmlFor="currentPassword"
              className="mb-1 block text-sm font-medium text-gray-700"
            >
              Senha Atual
            </label>
            <input
              id="currentPassword"
              type="password"
              required
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>

          <div>
            <label
              htmlFor="newPassword"
              className="mb-1 block text-sm font-medium text-gray-700"
            >
              Nova Senha
            </label>
            <input
              id="newPassword"
              type="password"
              required
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              minLength={8}
            />
          </div>

          <div>
            <label
              htmlFor="confirmPassword"
              className="mb-1 block text-sm font-medium text-gray-700"
            >
              Confirmar Nova Senha
            </label>
            <input
              id="confirmPassword"
              type="password"
              required
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              minLength={8}
            />
          </div>

          <button
            type="submit"
            disabled={submitting}
            className="rounded-lg bg-blue-600 px-6 py-2.5 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
          >
            {submitting ? 'Alterando...' : 'Alterar Senha'}
          </button>
        </form>
      </div>
    </div>
  );
}
