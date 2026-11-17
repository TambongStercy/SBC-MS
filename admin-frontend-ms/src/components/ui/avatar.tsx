import { Avatar as AvatarPrimitive } from 'radix-ui';
import { cn } from '../../lib/cn';

const SIZES = { xs: 'h-6 w-6 text-[10px]', sm: 'h-8 w-8 text-xs', md: 'h-10 w-10 text-sm', lg: 'h-14 w-14 text-base' } as const;

/** A person's photo, or their initials when there is none (or it fails to load). */
export function Avatar({ src, name, size = 'sm', className }: { src?: string | null; name: string; size?: keyof typeof SIZES; className?: string }) {
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]?.toUpperCase()).join('') || '?';
  return (
    <AvatarPrimitive.Root className={cn('relative inline-flex shrink-0 overflow-hidden rounded-full bg-primary-soft', SIZES[size], className)}>
      {src && <AvatarPrimitive.Image src={src} alt={name} className="h-full w-full object-cover" />}
      <AvatarPrimitive.Fallback delayMs={src ? 300 : 0} className="flex h-full w-full items-center justify-center font-semibold text-primary">
        {initials}
      </AvatarPrimitive.Fallback>
    </AvatarPrimitive.Root>
  );
}
