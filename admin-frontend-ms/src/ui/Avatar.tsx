import { useState } from 'react';
import { initials, thumbnailUrl } from '../lib/format';
import { cn } from './cn';

/** A member's photo (a small resized copy) or their initials. */
export function Avatar({ name, src, size = 40, className }: { name?: string | null; src?: string | null; size?: number; className?: string }) {
    const [failed, setFailed] = useState(false);
    const url = src && !failed ? thumbnailUrl(src, size * 2) : '';
    return (
        <span className={cn('inline-grid place-items-center shrink-0 overflow-hidden rounded-pill bg-primary-soft text-primary font-bold', className)}
            style={{ width: size, height: size, fontSize: Math.max(11, size * 0.36) }}>
            {url ? <img src={url} alt="" loading="lazy" className="size-full object-cover" onError={() => setFailed(true)} /> : initials(name)}
        </span>
    );
}
