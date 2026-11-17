import logoSbc from '../assets/logo-sbc.png';
import { cn } from '../lib/cn';

/** The SBC logo. */
export function BrandLogo({ size = 28, className }: { size?: number; className?: string }) {
  return (
    <img src={logoSbc} alt="" width={size} height={size} className={cn('shrink-0 rounded-full object-cover', className)} />
  );
}

export const BRAND_NAME = 'SBC Support';
