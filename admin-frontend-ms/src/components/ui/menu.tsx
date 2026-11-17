import type { ComponentPropsWithoutRef, ReactNode } from 'react';
import { DropdownMenu as M } from 'radix-ui';
import { HugeiconsIcon } from '@hugeicons/react';
import { Tick02Icon } from '@hugeicons/core-free-icons';
import { cn } from '../../lib/cn';

export const Menu = M.Root;
export const MenuTrigger = M.Trigger;
export const MenuGroup = M.Group;
export const MenuRadioGroup = M.RadioGroup;

const surface = 'z-[220] min-w-48 overflow-hidden rounded-panel border border-line bg-surface p-1 shadow-overlay';
const item = 'relative flex cursor-default select-none items-center gap-2 rounded-md px-2.5 py-2 text-sm text-fg outline-none data-[highlighted]:bg-surface-2 data-[disabled]:opacity-50 [&_svg]:text-fg-muted';

export function MenuContent({ className, align = 'end', sideOffset = 6, ...props }: ComponentPropsWithoutRef<typeof M.Content>) {
  return (
    <M.Portal>
      <M.Content align={align} sideOffset={sideOffset} className={cn(surface, className)} {...props} />
    </M.Portal>
  );
}

export function MenuItem({ className, destructive, ...props }: ComponentPropsWithoutRef<typeof M.Item> & { destructive?: boolean }) {
  return <M.Item className={cn(item, destructive && 'text-danger data-[highlighted]:bg-danger-soft [&_svg]:text-danger', className)} {...props} />;
}

export function MenuRadioItem({ className, children, ...props }: ComponentPropsWithoutRef<typeof M.RadioItem>) {
  return (
    <M.RadioItem className={cn(item, 'pr-8', className)} {...props}>
      {children}
      <M.ItemIndicator className="absolute right-2"><HugeiconsIcon icon={Tick02Icon} size={14} aria-hidden="true" /></M.ItemIndicator>
    </M.RadioItem>
  );
}

export function MenuLabel({ children }: { children: ReactNode }) {
  return <M.Label className="px-2.5 pt-2 pb-1 text-xs font-medium text-fg-subtle">{children}</M.Label>;
}

export function MenuSeparator() {
  return <M.Separator className="-mx-1 my-1 h-px bg-line" />;
}
