import { useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { HugeiconsIcon, type IconSvgElement } from '@hugeicons/react';
import { Copy01Icon, InformationCircleIcon, Search01Icon, Tick02Icon } from '@hugeicons/core-free-icons';
import { Badge, Button, Input, Tooltip } from '../ui';
import { formatDateTime } from '../common/format';
import { HOUR, waitedFor } from './stuck';
import { cn } from '../../lib/cn';

/** Copies a value (ids, tokens, phone numbers) with a toast. */
export function CopyValue({ value, label = 'Copier', className }: { value?: string | null; label?: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  if (!value) return <span className="text-fg-subtle">—</span>;
  const copy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      toast.success('Copié.');
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error('Copie impossible : sélectionnez le texte et copiez-le à la main.');
    }
  };
  return (
    <span className={cn('inline-flex min-w-0 max-w-full items-center gap-1', className)}>
      <code className="min-w-0 select-all break-all font-mono text-xs text-fg">{value}</code>
      <Button variant="ghost" size="icon-sm" className="h-8 w-8 shrink-0" onClick={copy} aria-label={`${label} : ${value}`}>
        <HugeiconsIcon icon={copied ? Tick02Icon : Copy01Icon} size={14} aria-hidden="true" />
      </Button>
    </span>
  );
}

/**
 * How long an item has been waiting (neutral under 1 h, warning under 24 h,
 * danger beyond), the exact date in a tooltip.
 */
export function AgeBadge({ date }: { date?: string | null }) {
  const waited = waitedFor(date);
  if (!date || !waited) return <span className="text-fg-subtle">—</span>;
  const age = Date.now() - new Date(date).getTime();
  const tone = age < HOUR ? 'neutral' : age < 24 * HOUR ? 'warning' : 'danger';
  return (
    <Tooltip content={`Demandé le ${formatDateTime(date)}`}>
      <span tabIndex={0} className="inline-flex rounded-md focus-visible:outline-2 focus-visible:outline-primary">
        <Badge tone={tone}>{age < HOUR ? 'Moins d’1 h' : `Depuis ${waited}`}</Badge>
      </span>
    </Tooltip>
  );
}

/** "Avant d'agir" callout: what the admin must check before clicking. */
export function CheckFirst({ title = 'Avant d’agir', icon = InformationCircleIcon, children, className }: {
  title?: ReactNode;
  icon?: IconSvgElement;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex gap-3 rounded-panel border border-info/30 bg-info-soft/50 px-4 py-3', className)}>
      <HugeiconsIcon icon={icon} size={18} aria-hidden="true" className="mt-0.5 shrink-0 text-info" />
      <div className="min-w-0 text-sm text-fg-muted">
        <p className="font-medium text-fg">{title}</p>
        <div className="mt-0.5 space-y-1">{children}</div>
      </div>
    </div>
  );
}

/** Name over e-mail. */
export function MemberCell({ name, email }: { name?: string | null; email?: string | null }) {
  return (
    <div className="min-w-0">
      <p className="truncate text-sm font-medium text-fg">{name || 'Membre inconnu'}</p>
      {email && <p className="truncate text-xs text-fg-muted">{email}</p>}
    </div>
  );
}

/** One label / value line in a details sheet. */
export function DetailRow({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 py-2 sm:flex-row sm:items-baseline sm:justify-between sm:gap-4">
      <dt className="shrink-0 text-xs text-fg-muted">{label}</dt>
      <dd className="min-w-0 text-sm text-fg sm:text-right">{children}</dd>
    </div>
  );
}

/** Search box with an icon (44 px on phones). */
export function SearchInput({ value, onChange, placeholder, label }: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  label: string;
}) {
  return (
    <div className="relative min-w-0 flex-1 sm:min-w-[18rem]">
      <HugeiconsIcon icon={Search01Icon} size={16} aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-fg-subtle" />
      <Input
        type="search"
        aria-label={label}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className="h-11 pl-9 sm:h-9"
      />
    </div>
  );
}
