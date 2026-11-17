import type { HTMLAttributes } from 'react';
import { cn } from '../../lib/cn';

/** Placeholder with the shape of the content being loaded. */
export function Skeleton({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('animate-pulse rounded-md bg-surface-3', className)} aria-hidden="true" {...props} />;
}
