import type { ReactNode } from 'react';
import logoSbc from '../../assets/logo-sbc.png';

/** Sign-in frame: the admin's photo background and the SBC card. */
export function AuthLayout({ children, subtitle = 'Espace support' }: { children: ReactNode; subtitle?: string }) {
  return (
    <main className="auth-background flex h-dvh w-full items-start justify-center overflow-y-auto px-4 py-8 pt-[max(2rem,env(safe-area-inset-top))] pb-[max(2rem,env(safe-area-inset-bottom))] sm:items-center">
      <div className="pointer-events-none fixed inset-0 bg-black/40" aria-hidden="true" />
      <div className="relative w-full max-w-md rounded-panel border border-line bg-surface p-6 sm:p-8">
        <div className="mb-6 flex items-center gap-3">
          <img className="h-14 w-14 shrink-0 rounded-full object-cover" src={logoSbc} alt="Logo SBC" />
          <div className="min-w-0">
            <p className="text-xs font-medium uppercase tracking-wide text-primary">{subtitle}</p>
            <h1 className="text-lg font-semibold leading-snug text-fg">Sniper Business Center</h1>
          </div>
        </div>
        {children}
      </div>
    </main>
  );
}

export function FormError({ message }: { message?: string }) {
  if (!message) return null;
  return <div role="alert" className="rounded-control border border-danger/30 bg-danger-soft px-3 py-2 text-sm text-danger">{message}</div>;
}
