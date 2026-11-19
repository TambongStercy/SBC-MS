import type { ReactNode } from 'react';
import { HugeiconsIcon, type IconSvgElement } from '@hugeicons/react';
import { cn } from '../../lib/cn';
import { Panel } from './panel';

/** A key figure: label, value (tabular digits), optional trend or hint. */
export function Metric({ label, value, hint, icon: Icon, tone = 'neutral', onClick, className }: {
  label: ReactNode;
  value: ReactNode;
  hint?: ReactNode;
  icon?: IconSvgElement;
  tone?: 'neutral' | 'primary' | 'success' | 'warning' | 'danger';
  onClick?: () => void;
  className?: string;
}) {
  const toneIcon = {
    neutral: 'bg-surface-3 text-fg-muted',
    primary: 'bg-primary-soft text-primary',
    success: 'bg-success-soft text-success',
    warning: 'bg-warning-soft text-warning',
    danger: 'bg-danger-soft text-danger',
  }[tone];
  const content = (
    <>
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs font-medium text-fg-muted">{label}</p>
        {Icon && (
          <span className={cn('flex h-8 w-8 items-center justify-center rounded-lg', toneIcon)} aria-hidden="true">
            <HugeiconsIcon icon={Icon} size={16} />
          </span>
        )}
      </div>
      {/* div, not p: callers pass skeletons and badges as values */}
      <div className="mt-2 text-2xl font-semibold tracking-tight text-fg tabular-nums">{value}</div>
      {hint && <div className="mt-1 text-xs text-fg-muted">{hint}</div>}
    </>
  );
  return onClick ? (
    <Panel className={cn('p-4 text-left transition-colors hover:border-line-strong', className)} role="button" tabIndex={0} onClick={onClick}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } }}>
      {content}
    </Panel>
  ) : (
    <Panel className={cn('p-4', className)}>{content}</Panel>
  );
}
