import type { ComponentPropsWithoutRef } from 'react';
import { Tabs as T } from 'radix-ui';
import { cn } from '../../lib/cn';

export const Tabs = T.Root;
export const TabsContent = T.Content;

export function TabsList({ className, ...props }: ComponentPropsWithoutRef<typeof T.List>) {
  return <T.List className={cn('flex gap-1 overflow-x-auto border-b border-line [scrollbar-width:none] [&::-webkit-scrollbar]:hidden', className)} {...props} />;
}

export function TabsTrigger({ className, ...props }: ComponentPropsWithoutRef<typeof T.Trigger>) {
  return (
    <T.Trigger
      className={cn(
        '-mb-px whitespace-nowrap border-b-2 border-transparent px-3 pb-2.5 pt-1 text-sm font-medium text-fg-muted transition-colors hover:text-fg',
        'data-[state=active]:border-primary data-[state=active]:text-fg focus-visible:outline-2 focus-visible:outline-primary',
        className,
      )}
      {...props}
    />
  );
}
