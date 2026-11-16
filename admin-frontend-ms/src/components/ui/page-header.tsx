import type { ReactNode } from 'react';
import { cn } from '../../lib/cn';

/** Title of a screen, what it is for, and its main actions (right on desktop, below on phones). */
export function PageHeader({ title, description, actions, children, className }: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  /** Tabs or filters under the title. */
  children?: ReactNode;
  className?: string;
}) {
  return (
    <header className={cn('mb-6 flex flex-col gap-4', className)}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight text-fg">{title}</h1>
          {description && <p className="mt-1 max-w-[65ch] text-sm text-fg-muted">{description}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {children}
    </header>
  );
}
