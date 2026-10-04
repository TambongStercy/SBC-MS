import { ReactNode } from 'react';
import { AlertTriangle, Inbox, Loader2 } from 'lucide-react';
import { Button } from './Button';
import { cn } from './cn';

export function Spinner({ label = 'Chargement…', className }: { label?: string; className?: string }) {
    return (
        <div className={cn('flex items-center justify-center gap-2 py-10 text-sm text-ink-3', className)} role="status">
            <Loader2 size={18} className="animate-spin" />{label}
        </div>
    );
}

export function Skeleton({ className }: { className?: string }) {
    return <div className={cn('animate-pulse rounded-tile bg-surface-2', className)} />;
}

export function ListSkeleton({ rows = 5 }: { rows?: number }) {
    return (
        <div className="space-y-2" aria-busy="true">
            {Array.from({ length: rows }, (_, i) => <Skeleton key={i} className="h-16" />)}
        </div>
    );
}

export function EmptyState({ icon, title, children, className }: { icon?: ReactNode; title: ReactNode; children?: ReactNode; className?: string }) {
    return (
        <div className={cn('flex flex-col items-center text-center py-12 px-4', className)}>
            <span className="size-14 grid place-items-center rounded-pill bg-surface-2 text-ink-3 mb-3">{icon ?? <Inbox size={26} />}</span>
            <p className="font-semibold text-ink">{title}</p>
            {children && <div className="mt-1 text-sm text-ink-2 max-w-sm">{children}</div>}
        </div>
    );
}

export function ErrorState({ message = 'Impossible de charger ces données.', onRetry, className }: { message?: string; onRetry?: () => void; className?: string }) {
    return (
        <div className={cn('flex flex-col items-center text-center py-10 px-4', className)} role="alert">
            <span className="size-12 grid place-items-center rounded-pill bg-danger-soft text-danger mb-3"><AlertTriangle size={22} /></span>
            <p className="font-semibold text-ink">{message}</p>
            {onRetry && <Button variant="secondary" size="sm" className="mt-3" onClick={onRetry}>Réessayer</Button>}
        </div>
    );
}
