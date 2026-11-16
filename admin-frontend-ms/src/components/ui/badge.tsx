import type { HTMLAttributes } from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../../lib/cn';

const badgeVariants = cva('inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium whitespace-nowrap', {
  variants: {
    tone: {
      neutral: 'bg-surface-3 text-fg-muted',
      primary: 'bg-primary-soft text-primary',
      success: 'bg-success-soft text-success',
      warning: 'bg-warning-soft text-[color-mix(in_oklch,var(--warning),var(--fg)_35%)]',
      danger: 'bg-danger-soft text-danger',
      info: 'bg-info-soft text-info',
      outline: 'border border-line text-fg-muted',
    },
  },
  defaultVariants: { tone: 'neutral' },
});

/** A status or category, always in words (never a raw code). */
export function Badge({ className, tone, ...props }: HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ tone }), className)} {...props} />;
}
