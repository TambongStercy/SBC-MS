import { HTMLAttributes } from 'react';
import { cn } from './cn';

/** A surface on the page: flat in light, frosted with a shadow in dark (`.panel`). */
export function Card({ className, padded = true, ...rest }: HTMLAttributes<HTMLDivElement> & { padded?: boolean }) {
    return <div className={cn('panel rounded-card', padded && 'p-4 sm:p-5', className)} {...rest} />;
}

export function SectionTitle({ children, action, className }: { children: React.ReactNode; action?: React.ReactNode; className?: string }) {
    return (
        <div className={cn('flex items-end justify-between gap-3 mb-2', className)}>
            <h2 className="text-xs font-bold uppercase tracking-wider text-ink-3">{children}</h2>
            {action}
        </div>
    );
}
