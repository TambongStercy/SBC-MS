import { ReactNode } from 'react';

/**
 * Pages not rebuilt yet were designed for the old dark admin. They keep that
 * look inside the new shell (`dark` scopes their dark: styles) until their turn.
 */
export function LegacyFrame({ children }: { children: ReactNode }) {
    return <div className="dark legacy-frame min-h-screen bg-gray-900 text-gray-100 [&>div]:min-h-screen">{children}</div>;
}
