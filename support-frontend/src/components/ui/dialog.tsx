import type { ReactNode } from 'react';
import { Dialog as D } from 'radix-ui';
import { HugeiconsIcon } from '@hugeicons/react';
import { Cancel01Icon } from '@hugeicons/core-free-icons';
import { cn } from '../../lib/cn';

export const Dialog = D.Root;
export const DialogTrigger = D.Trigger;
export const DialogClose = D.Close;

const overlay = 'fixed inset-0 z-[210] bg-[oklch(0.15_0.02_258/0.45)]';

/**
 * A centred dialog for short, focused tasks (confirmations, small forms).
 * Title and description are announced; Escape and the close button dismiss it.
 */
export function DialogContent({ title, description, children, footer, size = 'md', className }: {
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}) {
  const width = { sm: 'max-w-sm', md: 'max-w-lg', lg: 'max-w-2xl' }[size];
  return (
    <D.Portal>
      <D.Overlay className={overlay} />
      <D.Content
        className={cn(
          'fixed left-1/2 top-1/2 z-[211] flex max-h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] -translate-x-1/2 -translate-y-1/2 flex-col',
          'rounded-panel border border-line bg-surface shadow-overlay focus:outline-none',
          width, className,
        )}
      >
        <div className="flex items-start justify-between gap-4 px-6 pt-5 pb-3">
          <div className="min-w-0">
            <D.Title className="text-base font-semibold text-fg">{title}</D.Title>
            {description ? <D.Description className="mt-1 text-sm text-fg-muted">{description}</D.Description> : <D.Description className="sr-only">{title}</D.Description>}
          </div>
          <D.Close className="-mr-2 -mt-1 rounded-md p-2 text-fg-subtle hover:bg-surface-2 hover:text-fg" aria-label="Fermer">
            <HugeiconsIcon icon={Cancel01Icon} size={16} aria-hidden="true" />
          </D.Close>
        </div>
        {children && <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-5">{children}</div>}
        {footer && <div className="flex flex-col-reverse gap-2 border-t border-line px-6 py-4 sm:flex-row sm:justify-end">{footer}</div>}
      </D.Content>
    </D.Portal>
  );
}

/** A panel sliding from the right, for details and longer forms (full screen on phones). */
export function SheetContent({ title, description, children, footer, width = 'md', className }: {
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  width?: 'md' | 'lg' | 'xl';
  className?: string;
}) {
  const w = { md: 'sm:max-w-md', lg: 'sm:max-w-xl', xl: 'sm:max-w-3xl' }[width];
  return (
    <D.Portal>
      <D.Overlay className={overlay} />
      <D.Content className={cn('fixed inset-y-0 right-0 z-[211] flex w-full flex-col border-l border-line bg-surface shadow-overlay focus:outline-none', w, className)}>
        <div className="flex items-start justify-between gap-4 border-b border-line px-6 py-4">
          <div className="min-w-0">
            <D.Title className="text-base font-semibold text-fg">{title}</D.Title>
            {description ? <D.Description className="mt-1 text-sm text-fg-muted">{description}</D.Description> : <D.Description className="sr-only">{title}</D.Description>}
          </div>
          <D.Close className="-mr-2 rounded-md p-2 text-fg-subtle hover:bg-surface-2 hover:text-fg" aria-label="Fermer">
            <HugeiconsIcon icon={Cancel01Icon} size={16} aria-hidden="true" />
          </D.Close>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">{children}</div>
        {footer && <div className="flex flex-col-reverse gap-2 border-t border-line px-6 py-4 sm:flex-row sm:justify-end">{footer}</div>}
      </D.Content>
    </D.Portal>
  );
}
