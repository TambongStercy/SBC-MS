import { forwardRef, ButtonHTMLAttributes, ReactNode } from 'react';
import { Link, LinkProps } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { cn } from './cn';

type Variant = 'primary' | 'secondary' | 'ghost' | 'success' | 'danger' | 'danger-soft';
type Size = 'sm' | 'md' | 'lg';

const VARIANT: Record<Variant, string> = {
    primary: 'bg-primary text-white hover:bg-primary-hover',
    secondary: 'bg-surface text-ink border border-border hover:bg-surface-2',
    ghost: 'text-ink-2 hover:bg-surface-2 hover:text-ink',
    success: 'bg-success text-white hover:opacity-90',
    danger: 'bg-danger text-white hover:opacity-90',
    'danger-soft': 'bg-surface text-danger border border-border hover:bg-danger-soft',
};
const SIZE: Record<Size, string> = {
    sm: 'h-9 px-3 text-sm gap-1.5',
    md: 'h-11 px-4 text-sm gap-2',
    lg: 'h-12 px-5 text-base gap-2',
};

export const buttonClass = (variant: Variant = 'primary', size: Size = 'md', full = false) =>
    cn('inline-flex items-center justify-center rounded-pill font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed select-none',
        VARIANT[variant], SIZE[size], full && 'w-full');

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
    variant?: Variant;
    size?: Size;
    full?: boolean;
    loading?: boolean;
    icon?: ReactNode;
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
    { variant = 'primary', size = 'md', full, loading, icon, className, children, disabled, type = 'button', ...rest }, ref,
) {
    return (
        <button ref={ref} type={type} disabled={disabled || loading} className={cn(buttonClass(variant, size, full), className)} {...rest}>
            {loading ? <Loader2 size={16} className="animate-spin" /> : icon}
            {children}
        </button>
    );
});

export function ButtonLink({ variant = 'primary', size = 'md', full, icon, className, children, ...rest }:
    LinkProps & { variant?: Variant; size?: Size; full?: boolean; icon?: ReactNode }) {
    return (
        <Link className={cn(buttonClass(variant, size, full), className)} {...rest}>
            {icon}
            {children}
        </Link>
    );
}

export function IconButton({ label, className, children, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
    return (
        <button type="button" aria-label={label} title={label}
            className={cn('inline-grid place-items-center size-10 rounded-pill text-ink-2 hover:bg-surface-2 hover:text-ink transition-colors disabled:opacity-50', className)}
            {...rest}>
            {children}
        </button>
    );
}
