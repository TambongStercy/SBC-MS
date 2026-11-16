// Imported, not a "/src/..." string: that path only exists on the dev server.
import logoSbc from '../assets/logo-sbc.png';
import { cn } from '../lib/cn';

/** The SBC logo, as on the login screen. */
export function BrandLogo({ size = 28, className }: { size?: number; className?: string }) {
  return (
    <img
      src={logoSbc}
      alt=""
      width={size}
      height={size}
      className={cn('shrink-0 rounded-full object-cover', className)}
      style={{ width: size, height: size }}
    />
  );
}

export const BRAND_NAME = 'SBC Admin';
