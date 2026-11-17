import { cloneElement, forwardRef, isValidElement, useId, type InputHTMLAttributes, type ReactElement, type ReactNode, type TextareaHTMLAttributes } from 'react';
import { cn } from '../../lib/cn';

const control =
  'w-full rounded-control border border-line-strong bg-surface px-3 text-sm text-fg placeholder:text-fg-subtle ' +
  'transition-[border-color,box-shadow] focus:outline-none focus:border-primary focus:ring-3 focus:ring-primary/20 ' +
  'disabled:cursor-not-allowed disabled:bg-surface-2 disabled:text-fg-muted aria-invalid:border-danger aria-invalid:focus:ring-danger/20';

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(({ className, ...props }, ref) => (
  <input ref={ref} className={cn(control, 'h-9', className)} {...props} />
));
Input.displayName = 'Input';

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(({ className, ...props }, ref) => (
  <textarea ref={ref} className={cn(control, 'min-h-20 py-2 leading-relaxed', className)} {...props} />
));
Textarea.displayName = 'Textarea';

/**
 * A form field: label above, the control, then help or error below, wired
 * together for screen readers (id, aria-describedby, aria-invalid).
 */
export function Field({ label, help, error, required, className, children }: {
  label: ReactNode;
  help?: ReactNode;
  error?: ReactNode;
  required?: boolean;
  className?: string;
  children: ReactElement<{ id?: string; 'aria-describedby'?: string; 'aria-invalid'?: boolean; required?: boolean }>;
}) {
  const id = useId();
  const controlId = (isValidElement(children) && children.props.id) || id;
  const describedBy = error ? `${id}-error` : help ? `${id}-help` : undefined;
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <label htmlFor={controlId} className="text-sm font-medium text-fg">
        {label}{required && <span className="text-danger" aria-hidden="true"> *</span>}
      </label>
      {cloneElement(children, { id: controlId, 'aria-describedby': describedBy, 'aria-invalid': error ? true : undefined, required })}
      {error ? (
        <p id={`${id}-error`} className="text-xs text-danger">{error}</p>
      ) : help ? (
        <p id={`${id}-help`} className="text-xs text-fg-muted">{help}</p>
      ) : null}
    </div>
  );
}
