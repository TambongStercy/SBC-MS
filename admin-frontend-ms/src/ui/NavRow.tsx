import { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import { cn } from './cn';
import type { Tone } from './Badge';

const ICON_TONE: Record<Tone, string> = {
    neutral: 'bg-surface-2 text-ink-2',
    primary: 'bg-primary-soft text-primary',
    success: 'bg-success-soft text-success',
    danger: 'bg-danger-soft text-danger',
    warning: 'bg-warning-soft text-warning',
    accent: 'bg-accent-soft text-accent',
};

/** A row that opens a screen: icon, name, one line of description, a count. */
export function NavRow({ to, icon, title, description, trailing, tone = 'primary', onClick }: {
    to?: string; icon: ReactNode; title: ReactNode; description?: ReactNode; trailing?: ReactNode; tone?: Tone; onClick?: () => void;
}) {
    const inner = (
        <>
            <span className={cn('size-10 grid place-items-center rounded-pill shrink-0', ICON_TONE[tone])}>{icon}</span>
            <span className="min-w-0 flex-1">
                <span className="block font-semibold text-ink">{title}</span>
                {description && <span className="block text-sm text-ink-2 line-clamp-2">{description}</span>}
            </span>
            {trailing}
            <ChevronRight size={18} className="text-ink-3 shrink-0" />
        </>
    );
    const cls = 'flex items-center gap-3 px-4 py-3 hover:bg-surface-2 active:bg-surface-2 transition-colors';
    return to ? <Link to={to} className={cls}>{inner}</Link> : <button type="button" onClick={onClick} className={cn(cls, 'w-full text-left')}>{inner}</button>;
}

/** NavRows grouped in one card with hairlines between them. */
export function NavList({ children, className }: { children: ReactNode; className?: string }) {
    return <div className={cn('bg-surface border border-border rounded-card divide-y divide-border overflow-hidden', className)}>{children}</div>;
}
