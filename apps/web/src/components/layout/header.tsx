'use client';

import { usePathname } from 'next/navigation';
import { useAuthContext } from '@/lib/auth-context';
import { Menu, User } from 'lucide-react';

const pageTitles: Record<string, string> = {
  '/': 'Dashboard',
  '/dashboard': 'Dashboard',
  '/upload': 'Upload de Cartões',
  '/processamento': 'Processamento',
  '/revisao': 'Revisão',
  '/empresas': 'Empresas',
  '/funcionarios': 'Funcionários',
  '/exportacao': 'Exportação',
  '/configuracoes': 'Configurações',
};

function getPageTitle(pathname: string): string {
  if (pageTitles[pathname]) return pageTitles[pathname];

  // Check for dynamic routes
  if (pathname.startsWith('/revisao/')) return 'Revisão de Cartão';

  // Fallback: try matching first segment
  const segment = '/' + pathname.split('/')[1];
  return pageTitles[segment] || 'Total Ledger';
}

interface HeaderProps {
  onMenuToggle: () => void;
}

export function Header({ onMenuToggle }: HeaderProps) {
  const pathname = usePathname();
  const { user } = useAuthContext();
  const title = getPageTitle(pathname);

  return (
    <header className="flex h-16 items-center justify-between border-b border-gray-200 bg-white px-4 lg:px-6">
      <div className="flex items-center gap-3">
        <button
          onClick={onMenuToggle}
          className="rounded-lg p-2 text-gray-500 hover:bg-gray-100 lg:hidden"
          aria-label="Abrir menu"
        >
          <Menu size={20} />
        </button>
        <h1 className="text-lg font-semibold text-gray-900">{title}</h1>
      </div>

      {user && (
        <div className="flex items-center gap-3">
          <span className="hidden text-sm text-gray-600 sm:block">{user.nome}</span>
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-600 text-white">
            <User size={16} />
          </div>
        </div>
      )}
    </header>
  );
}
