import type { ReactNode } from 'react';
import { Select as S } from 'radix-ui';
import { HugeiconsIcon } from '@hugeicons/react';
import { ArrowDown01Icon, Tick02Icon } from '@hugeicons/core-free-icons';
import { cn } from '../../lib/cn';

export interface SelectOption { value: string; label: ReactNode; disabled?: boolean }

/** A list of choices (use a plain <Input list> or a combobox for long searchable lists). */
export function Select({ value, onValueChange, options, placeholder, id, disabled, className, 'aria-describedby': describedBy, 'aria-invalid': invalid }: {
  value?: string;
  onValueChange: (v: string) => void;
  options: SelectOption[];
  placeholder?: string;
  id?: string;
  disabled?: boolean;
  className?: string;
  'aria-describedby'?: string;
  'aria-invalid'?: boolean;
}) {
  return (
    <S.Root value={value} onValueChange={onValueChange} disabled={disabled}>
      <S.Trigger
        id={id}
        aria-describedby={describedBy}
        aria-invalid={invalid}
        className={cn(
          'flex h-9 w-full items-center justify-between gap-2 rounded-control border border-line-strong bg-surface px-3 text-sm text-fg',
          'focus:outline-none focus:border-primary focus:ring-3 focus:ring-primary/20 data-[placeholder]:text-fg-subtle disabled:opacity-50 aria-invalid:border-danger',
          className,
        )}
      >
        <S.Value placeholder={placeholder} />
        <S.Icon><HugeiconsIcon icon={ArrowDown01Icon} size={14} className="text-fg-subtle" aria-hidden="true" /></S.Icon>
      </S.Trigger>
      <S.Portal>
        <S.Content position="popper" sideOffset={4} className="z-[220] max-h-72 min-w-[var(--radix-select-trigger-width)] overflow-hidden rounded-panel border border-line bg-surface shadow-overlay">
          <S.Viewport className="p-1">
            {options.map(o => (
              <S.Item key={o.value} value={o.value} disabled={o.disabled} className="relative flex cursor-default select-none items-center rounded-md py-2 pl-2.5 pr-8 text-sm text-fg outline-none data-[highlighted]:bg-surface-2 data-[disabled]:text-fg-subtle data-[disabled]:pointer-events-none">
                <S.ItemText>{o.label}</S.ItemText>
                <S.ItemIndicator className="absolute right-2 text-primary"><HugeiconsIcon icon={Tick02Icon} size={14} aria-hidden="true" /></S.ItemIndicator>
              </S.Item>
            ))}
          </S.Viewport>
        </S.Content>
      </S.Portal>
    </S.Root>
  );
}
