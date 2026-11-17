import { useState } from 'react';
import { toast } from 'sonner';
import { HugeiconsIcon } from '@hugeicons/react';
import { Copy01Icon, Tick02Icon } from '@hugeicons/core-free-icons';
import { Button } from '../ui';
import { cn } from '../../lib/cn';

/** An account id in monospace, with a button that copies it (for ADMIN_ALLOWLIST). */
export function CopyIdButton({ value, className }: { value: string; className?: string }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      toast.success('Identifiant copié.');
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error('Copie impossible : sélectionnez l’identifiant et copiez-le à la main.');
    }
  };

  return (
    <div className={cn('flex min-w-0 items-center gap-2', className)}>
      <code className="min-w-0 flex-1 select-all truncate rounded-control border border-line bg-surface-2 px-3 py-2.5 font-mono text-xs text-fg">
        {value}
      </code>
      <Button variant="outline" size="lg" onClick={copy} aria-label="Copier l’identifiant" className="shrink-0 px-3">
        <HugeiconsIcon icon={copied ? Tick02Icon : Copy01Icon} size={18} aria-hidden="true" />
        <span className="hidden sm:inline">{copied ? 'Copié' : 'Copier'}</span>
      </Button>
    </div>
  );
}
