import type { ReactNode } from 'react';
import { Tooltip as T } from 'radix-ui';

export const TooltipProvider = T.Provider;

/** Short label on hover or keyboard focus (never the only way to learn something). */
export function Tooltip({ content, side = 'top', children }: { content: ReactNode; side?: 'top' | 'right' | 'bottom' | 'left'; children: ReactNode }) {
  return (
    <T.Root delayDuration={300}>
      <T.Trigger asChild>{children}</T.Trigger>
      <T.Portal>
        <T.Content side={side} sideOffset={6} className="z-[230] rounded-md bg-ink px-2 py-1 text-xs font-medium text-ink-fg shadow-overlay">
          {content}
        </T.Content>
      </T.Portal>
    </T.Root>
  );
}
