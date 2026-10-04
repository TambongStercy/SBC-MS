import { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { cn } from './cn';
import { IconButton } from './Button';

/**
 * Every new screen: a header (back, title, actions) and its content at a
 * readable width. The header sticks while scrolling on a phone.
 */
export function Page({ title, subtitle, back, actions, width = 'default', children }: {
    title: ReactNode;
    subtitle?: ReactNode;
    /** true = browser back; a path = go there */
    back?: boolean | string;
    actions?: ReactNode;
    width?: 'narrow' | 'default' | 'wide';
    children: ReactNode;
}) {
    const navigate = useNavigate();
    const max = width === 'narrow' ? 'max-w-2xl' : width === 'wide' ? 'max-w-page' : 'max-w-5xl';
    return (
        <div className="min-h-full">
            <header className="sticky top-0 z-20 bg-bg/95 backdrop-blur supports-[backdrop-filter]:bg-bg/80 border-b border-transparent">
                <div className={cn('mx-auto flex items-center gap-2 px-4 lg:px-8 pt-[calc(env(safe-area-inset-top,0px)+12px)] pb-3', max)}>
                    {back && (
                        <IconButton label="Retour" className="-ml-2" onClick={() => (typeof back === 'string' ? navigate(back) : navigate(-1))}>
                            <ArrowLeft size={20} />
                        </IconButton>
                    )}
                    <div className="min-w-0 flex-1">
                        <h1 className="text-xl sm:text-2xl font-extrabold tracking-tight text-ink truncate">{title}</h1>
                        {subtitle && <p className="text-sm text-ink-2 truncate">{subtitle}</p>}
                    </div>
                    {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
                </div>
            </header>
            <div className={cn('mx-auto px-4 lg:px-8 pb-8', max)}>{children}</div>
        </div>
    );
}
