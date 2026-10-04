import { cn } from './cn';

export function Switch({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
    return (
        <button type="button" role="switch" aria-checked={checked} aria-label={label} disabled={disabled}
            onClick={() => onChange(!checked)}
            className={cn('relative inline-flex h-7 w-12 shrink-0 items-center rounded-pill transition-colors disabled:opacity-50',
                checked ? 'bg-primary' : 'bg-ink-3/40')}>
            <span className={cn('inline-block size-5 rounded-pill bg-white transition-transform', checked ? 'translate-x-6' : 'translate-x-1')} />
        </button>
    );
}
