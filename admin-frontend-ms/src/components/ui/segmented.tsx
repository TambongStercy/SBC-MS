import { useRef, type KeyboardEvent, type ReactNode } from 'react';
import { HugeiconsIcon, type IconSvgElement } from '@hugeicons/react';
import { cn } from '../../lib/cn';

export interface SegmentedOption<T extends string> {
  value: T;
  label: ReactNode;
  icon?: IconSvgElement;
}

/**
 * A small set of mutually exclusive choices shown side by side (a view
 * switch, a period, a difficulty). Arrow keys move between choices.
 */
export function Segmented<T extends string>({ value, onValueChange, options, label, size = 'md', className }: {
  value: T;
  onValueChange: (v: T) => void;
  options: SegmentedOption<T>[];
  /** What is being chosen, for screen readers. */
  label: string;
  size?: 'sm' | 'md';
  className?: string;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>, i: number) => {
    const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const next = (i + step + options.length) % options.length;
    onValueChange(options[next].value);
    refs.current[next]?.focus();
  };
  return (
    <div role="radiogroup" aria-label={label} className={cn('inline-flex max-w-full items-center gap-0.5 overflow-x-auto rounded-control border border-line bg-surface-2 p-0.5', className)}>
      {options.map((o, i) => {
        const on = o.value === value;
                return (
          <button
            key={o.value}
            ref={el => { refs.current[i] = el; }}
            type="button"
            role="radio"
            aria-checked={on}
            tabIndex={on ? 0 : -1}
            onClick={() => onValueChange(o.value)}
            onKeyDown={e => onKeyDown(e, i)}
            className={cn(
              'inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-md font-medium transition-colors',
              'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary',
              size === 'sm' ? 'h-7 px-2.5 text-xs' : 'h-8 px-3 text-sm',
              on ? 'bg-surface text-fg shadow-panel' : 'text-fg-muted hover:text-fg',
            )}
          >
            {o.icon && <HugeiconsIcon icon={o.icon} size={size === 'sm' ? 14 : 16} aria-hidden="true" />}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
