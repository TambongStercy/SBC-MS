import { forwardRef, InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes, useId } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from './cn';

const control = 'w-full rounded-tile border border-border bg-surface dark:bg-surface-2/60 text-ink placeholder:text-ink-3 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 disabled:opacity-60';

function Wrap({ id, label, hint, error, children }: { id: string; label?: ReactNode; hint?: ReactNode; error?: ReactNode; children: ReactNode }) {
    return (
        <div>
            {label && <label htmlFor={id} className="block text-sm font-semibold text-ink mb-1.5">{label}</label>}
            {children}
            {error ? <p className="mt-1 text-xs text-danger">{error}</p> : hint ? <p className="mt-1 text-xs text-ink-3">{hint}</p> : null}
        </div>
    );
}

type Extra = { label?: ReactNode; hint?: ReactNode; error?: ReactNode };

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & Extra>(function Input(
    { label, hint, error, className, id, ...rest }, ref) {
    const auto = useId();
    const fid = id ?? auto;
    return (
        <Wrap id={fid} label={label} hint={hint} error={error}>
            <input ref={ref} id={fid} className={cn(control, 'h-11 px-3 text-[15px]', !!error && 'border-danger', className)} {...rest} />
        </Wrap>
    );
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement> & Extra>(function Textarea(
    { label, hint, error, className, id, ...rest }, ref) {
    const auto = useId();
    const fid = id ?? auto;
    return (
        <Wrap id={fid} label={label} hint={hint} error={error}>
            <textarea ref={ref} id={fid} className={cn(control, 'px-3 py-2.5 text-[15px] resize-y', !!error && 'border-danger', className)} {...rest} />
        </Wrap>
    );
});

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement> & Extra>(function Select(
    { label, hint, error, className, id, children, ...rest }, ref) {
    const auto = useId();
    const fid = id ?? auto;
    return (
        <Wrap id={fid} label={label} hint={hint} error={error}>
            <div className="relative">
                <select ref={ref} id={fid} className={cn(control, 'h-11 pl-3 pr-9 text-[15px] appearance-none', className)} {...rest}>{children}</select>
                <ChevronDown size={16} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-ink-3" />
            </div>
        </Wrap>
    );
});
