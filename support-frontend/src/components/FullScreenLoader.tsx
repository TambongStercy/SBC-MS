import { BrandLogo } from '../shell/BrandMark';

export function FullScreenLoader({ label = 'Chargement…' }: { label?: string }) {
  return (
    <div className="flex h-dvh flex-col items-center justify-center gap-4 bg-background" role="status" aria-live="polite">
      <BrandLogo size={56} className="animate-pulse" />
      <p className="text-sm text-fg-muted">{label}</p>
    </div>
  );
}
