import type { ComponentPropsWithoutRef } from 'react';
import { Checkbox as C, Switch as Sw } from 'radix-ui';
import { HugeiconsIcon } from '@hugeicons/react';
import { Tick02Icon } from '@hugeicons/core-free-icons';
import { cn } from '../../lib/cn';

export function Checkbox({ className, ...props }: ComponentPropsWithoutRef<typeof C.Root>) {
  return (
    <C.Root
      className={cn(
        'flex h-4 w-4 shrink-0 items-center justify-center rounded-[4px] border border-line-strong bg-surface text-primary-fg',
        'data-[state=checked]:border-primary data-[state=checked]:bg-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary',
        className,
      )}
      {...props}
    >
      <C.Indicator><HugeiconsIcon icon={Tick02Icon} size={12} aria-hidden="true" /></C.Indicator>
    </C.Root>
  );
}

export function Switch({ className, ...props }: ComponentPropsWithoutRef<typeof Sw.Root>) {
  return (
    <Sw.Root
      className={cn(
        'relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full bg-line-strong transition-colors data-[state=checked]:bg-primary',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:opacity-50',
        className,
      )}
      {...props}
    >
      <Sw.Thumb className="block h-4 w-4 translate-x-0.5 rounded-full bg-surface transition-transform data-[state=checked]:translate-x-[18px]" />
    </Sw.Root>
  );
}
