import { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { cn } from './cn';

/** A figure with its label. Linked when there is a list behind the number. */
export function Stat({ label, value, hint, to, tone, loading }: {
    label: ReactNode; value: ReactNode; hint?: ReactNode; to?: string; tone?: 'danger' | 'success' | 'warning'; loading?: boolean;
}) {
    const body = (
        <>
            <div className="text-xs font-semibold text-ink-2">{label}</div>
            <div className={cn('mt-1 text-xl font-extrabold tabular tracking-tight',
                tone === 'danger' ? 'text-danger' : tone === 'success' ? 'text-success' : tone === 'warning' ? 'text-warning' : 'text-ink')}>
                {loading ? <span className="inline-block h-6 w-12 animate-pulse rounded bg-surface-2 align-middle" /> : value}
            </div>
            {hint && <div className="mt-0.5 text-xs text-ink-3">{hint}</div>}
        </>
    );
    const cls = 'block panel rounded-card p-3.5';
    return to ? <Link to={to} className={cn(cls, 'lift')}>{body}</Link> : <div className={cls}>{body}</div>;
}
