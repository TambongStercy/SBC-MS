import { ReactNode } from 'react';
import { cn } from './cn';

export type Tone = 'neutral' | 'primary' | 'success' | 'danger' | 'warning' | 'accent';

const TONE: Record<Tone, string> = {
    neutral: 'bg-surface-2 text-ink-2',
    primary: 'bg-primary-soft text-primary',
    success: 'bg-success-soft text-success',
    danger: 'bg-danger-soft text-danger',
    warning: 'bg-warning-soft text-warning',
    accent: 'bg-accent-soft text-accent',
};

export function Badge({ tone = 'neutral', children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
    return (
        <span className={cn('inline-flex items-center gap-1 rounded-pill px-2 py-0.5 text-xs font-semibold whitespace-nowrap', TONE[tone], className)}>
            {children}
        </span>
    );
}

/** A count bubble, e.g. on a menu item. Hidden at zero. */
export function CountBadge({ count, tone = 'danger', className }: { count?: number; tone?: 'danger' | 'primary'; className?: string }) {
    if (!count) return null;
    return (
        <span className={cn('inline-flex min-w-5 h-5 items-center justify-center rounded-pill px-1.5 text-[11px] font-bold text-white tabular',
            tone === 'danger' ? 'bg-danger' : 'bg-primary', className)}>
            {count > 99 ? '99+' : count}
        </span>
    );
}

/**
 * A status in French, never a raw code. Each domain passes its own table:
 * { completed: ['Payé', 'success'], pending_admin_approval: ['À valider', 'warning'] }.
 */
export function StatusBadge({ status, labels }: { status?: string | null; labels: Record<string, [string, Tone]> }) {
    if (!status) return <Badge>—</Badge>;
    const [label, tone] = labels[status] ?? labels[status.toLowerCase()] ?? [status, 'neutral' as Tone];
    return <Badge tone={tone}>{label}</Badge>;
}
