import { redirect } from 'next/navigation';

// This page maps to / but app/page.tsx takes priority.
// Kept as fallback redirect to /dashboard.
export default function FallbackPage() {
  redirect('/dashboard');
}
