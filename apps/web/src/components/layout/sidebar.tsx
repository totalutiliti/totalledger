'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuthContext } from '@/lib/auth-context';
import {
  LayoutDashboard,
  Upload,
  Cpu,
  ClipboardCheck,
  Building2,
  Users,
  Download,
  Settings,
  LogOut,
  X,
} from 'lucide-react';
import type { ComponentType } from 'react';
import type { LucideProps } from 'lucide-react';

interface NavItem {
  label: string;
  href: string;
  icon: ComponentType<LucideProps>;
}

const navItems: NavItem[] = [
  { label: 'Dashboard', href: '/dashboard', icon: LayoutDashboard },
  { label: 'Upload', href: '/upload', icon: Upload },
  { label: 'Processamento', href: '/processamento', icon: Cpu },
  { label: 'Revisão', href: '/revisao', icon: ClipboardCheck },
  { label: 'Empresas', href: '/empresas', icon: Building2 },
  { label: 'Funcionários', href: '/funcionarios', icon: Users },
  { label: 'Exportação', href: '/exportacao', icon: Download },
  { label: 'Configurações', href: '/configuracoes', icon: Settings },
];

interface SidebarProps {
  isOpen: boolean;
  onClose: () => void;
}

export function Sidebar({ isOpen, onClose }: SidebarProps) {
  const pathname = usePathname();
  const { user, logout } = useAuthContext();

  const isActive = (href: string) => {
    if (href === '/dashboard') return pathname === '/dashboard' || pathname === '/';
    return pathname.startsWith(href);
  };

  return (
    <>
      {/* Mobile overlay */}
      {isOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 lg:hidden"
          onClick={onClose}
          onKeyDown={(e) => {
            if (e.key === 'Escape') onClose();
          }}
          role="button"
          tabIndex={0}
          aria-label="Fechar menu"
        />
      )}

      {/* Sidebar */}
      <aside
        className={`
          fixed left-0 top-0 z-50 flex h-full w-64 flex-col bg-slate-900 text-white
          transition-transform duration-300 ease-in-out
          lg:static lg:translate-x-0
          ${isOpen ? 'translate-x-0' : '-translate-x-full'}
        `}
      >
        {/* Logo */}
        <div className="flex h-16 items-center justify-between border-b border-slate-700 px-6">
          <Link href="/dashboard" className="text-xl font-bold tracking-tight">
            Total Ledger
          </Link>
          <button
            onClick={onClose}
            className="rounded p-1 hover:bg-slate-700 lg:hidden"
            aria-label="Fechar menu"
          >
            <X size={20} />
          </button>
        </div>

        {/* Navigation */}
        <nav className="flex-1 overflow-y-auto px-3 py-4">
          <ul className="space-y-1">
            {navItems.map((item) => {
              const Icon = item.icon;
              const active = isActive(item.href);
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    onClick={onClose}
                    className={`
                      flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium
                      transition-colors
                      ${
                        active
                          ? 'bg-blue-600 text-white'
                          : 'text-slate-300 hover:bg-slate-800 hover:text-white'
                      }
                    `}
                  >
                    <Icon size={20} />
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>

        {/* User info + Logout */}
        <div className="border-t border-slate-700 p-4">
          {user && (
            <div className="mb-3">
              <p className="truncate text-sm font-medium">{user.nome}</p>
              <p className="truncate text-xs text-slate-400">{user.email}</p>
            </div>
          )}
          <button
            onClick={logout}
            className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-slate-300 transition-colors hover:bg-slate-800 hover:text-white"
          >
            <LogOut size={18} />
            Sair
          </button>
        </div>
      </aside>
    </>
  );
}
