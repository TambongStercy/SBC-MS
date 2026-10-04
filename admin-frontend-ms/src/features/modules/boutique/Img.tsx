import { useState } from 'react';
import { ImageOff } from 'lucide-react';
import { cn } from '../../../ui';

/** A product picture; a missing file shows as a quiet tile instead of the browser's broken-image icon. */
export function Img({ src, className }: { src: string; className?: string }) {
    const [failed, setFailed] = useState(false);
    if (failed) return <span className={cn('grid place-items-center bg-surface-2 text-ink-3', className)}><ImageOff size={18} /></span>;
    return <img src={src} alt="" className={cn('bg-surface-2', className)} onError={() => setFailed(true)} />;
}
