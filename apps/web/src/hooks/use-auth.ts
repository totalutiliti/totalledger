'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthContext } from '@/lib/auth-context';

export function useAuth() {
  const auth = useAuthContext();
  const router = useRouter();

  useEffect(() => {
    if (!auth.isLoading && !auth.isAuthenticated) {
      router.replace('/login');
    }
  }, [auth.isLoading, auth.isAuthenticated, router]);

  return auth;
}
