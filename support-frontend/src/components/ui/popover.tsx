import type { ComponentPropsWithoutRef } from 'react';
import { Popover as P } from 'radix-ui';
import { cn } from '../../lib/cn';

export const Popover = P.Root;
export const PopoverTrigger = P.Trigger;
export const PopoverClose = P.Close;

export function PopoverContent({ className, align = 'end', sideOffset = 6, ...props }: ComponentPropsWithoutRef<typeof P.Content>) {
  return (
    <P.Portal>
      <P.Content align={align} sideOffset={sideOffset} className={cn('z-[220] rounded-panel border border-line bg-surface shadow-overlay focus:outline-none', className)} {...props} />
    </P.Portal>
  );
}
