import { ReactNode, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { IconButton } from './Button';
import { cn } from './cn';

/**
 * A panel over the page: rises from the bottom on a phone (thumb reach), a
 * centred dialog on a computer. Escape and the backdrop close it unless busy.
 */
export function Sheet({ open, onClose, title, children, footer, busy, size = 'md' }: {
    open: boolean;
    onClose: () => void;
    title?: ReactNode;
    children: ReactNode;
    footer?: ReactNode;
    busy?: boolean;
    size?: 'md' | 'lg';
}) {
    const panel = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!open) return;
        const prev = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) onClose(); };
        window.addEventListener('keydown', onKey);
        // focus the first control so keyboard users land inside
        setTimeout(() => panel.current?.querySelector<HTMLElement>('input,textarea,select,button:not([data-close])')?.focus(), 30);
        return () => { document.body.style.overflow = prev; window.removeEventListener('keydown', onKey); };
    }, [open, busy, onClose]);

    if (!open) return null;
    return createPortal(
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center" role="dialog" aria-modal="true">
            <div className="absolute inset-0 bg-black/50 animate-[fade-in_150ms_ease-out]" onClick={() => !busy && onClose()} />
            <div ref={panel}
                className={cn('relative w-full bg-surface text-ink rounded-t-card sm:rounded-card border border-border max-h-[92vh] flex flex-col animate-[sheet-up_200ms_ease-out]',
                    size === 'lg' ? 'sm:max-w-2xl' : 'sm:max-w-md', 'sm:mx-4')}>
                <div className="flex items-center gap-2 px-5 pt-4 pb-2">
                    <div className="min-w-0 flex-1 text-lg font-bold">{title}</div>
                    <IconButton label="Fermer" data-close onClick={onClose} disabled={busy} className="-mr-2"><X size={20} /></IconButton>
                </div>
                <div className="px-5 pb-4 overflow-y-auto">{children}</div>
                {footer && <div className="px-5 pt-3 pb-[calc(env(safe-area-inset-bottom,0px)+16px)] sm:pb-4 border-t border-border">{footer}</div>}
            </div>
        </div>,
        document.body,
    );
}
