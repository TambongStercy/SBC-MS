import { useSyncExternalStore } from 'react';
import { HugeiconsIcon } from '@hugeicons/react';
import { Alert02Icon, Cancel01Icon, CheckmarkCircle02Icon, InformationCircleIcon } from '@hugeicons/core-free-icons';
import { cn } from '../lib/cn';

/**
 * Small toast system. Not sonner: sonner injects a <style> tag at run time,
 * which a strict `style-src 'self'` CSP refuses.
 */
type Tone = 'success' | 'error' | 'info';
interface ToastItem { id: number; tone: Tone; message: string }

let items: ToastItem[] = [];
let nextId = 1;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach(l => l());

function push(tone: Tone, message: string, ms = tone === 'error' ? 6000 : 4000) {
  const id = nextId++;
  items = [...items.slice(-3), { id, tone, message }];
  emit();
  setTimeout(() => dismiss(id), ms);
}
function dismiss(id: number) {
  items = items.filter(t => t.id !== id);
  emit();
}

export const toast = {
  success: (m: string) => push('success', m),
  error: (m: string) => push('error', m),
  info: (m: string) => push('info', m),
};

const ICON = { success: CheckmarkCircle02Icon, error: Alert02Icon, info: InformationCircleIcon };
const TONE = { success: 'text-success', error: 'text-danger', info: 'text-info' };

export function Toaster() {
  const list = useSyncExternalStore(
    cb => { listeners.add(cb); return () => { listeners.delete(cb); }; },
    () => items,
    () => items,
  );
  return (
    <div aria-live="polite" className="pointer-events-none fixed inset-x-0 top-[max(0.75rem,env(safe-area-inset-top))] z-[300] flex flex-col items-center gap-2 px-4 sm:items-end">
      {list.map(t => (
        <div key={t.id} role={t.tone === 'error' ? 'alert' : 'status'}
          className="animate-toast-in pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-panel border border-line bg-surface px-4 py-3 text-sm text-fg">
          <HugeiconsIcon icon={ICON[t.tone]} size={18} className={cn('mt-0.5 shrink-0', TONE[t.tone])} aria-hidden="true" />
          <p className="min-w-0 flex-1">{t.message}</p>
          <button type="button" onClick={() => dismiss(t.id)} aria-label="Fermer" className="-mr-1 rounded p-1 text-fg-subtle hover:text-fg">
            <HugeiconsIcon icon={Cancel01Icon} size={14} aria-hidden="true" />
          </button>
        </div>
      ))}
    </div>
  );
}
