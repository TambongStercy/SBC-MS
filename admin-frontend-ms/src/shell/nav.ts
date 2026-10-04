import { Inbox, Users, Wallet, LayoutGrid, Menu, type LucideIcon } from 'lucide-react';

export type NavItem = {
    to: string;
    label: string;
    icon: LucideIcon;
    roles: string[];
    /** paths that belong to this place, including old pages not yet moved */
    owns: string[];
};

/**
 * The five places of the admin. Old pages are listed under the place they now
 * belong to, so the right tab stays lit while they are being rebuilt.
 */
export const NAV: NavItem[] = [
    { to: '/', label: 'À traiter', icon: Inbox, roles: ['admin', 'withdrawal_admin', 'moderator'], owns: ['/a-traiter'] },
    { to: '/membres', label: 'Membres', icon: Users, roles: ['admin'], owns: ['/membres', '/users', '/userpage', '/partners'] },
    { to: '/argent', label: 'Argent', icon: Wallet, roles: ['admin', 'withdrawal_admin'],
        owns: ['/argent', '/transactions', '/account-transactions', '/withdrawals', '/fix-', '/manual-payment-recovery', '/user-analytics'] },
    { to: '/modules', label: 'Modules', icon: LayoutGrid, roles: ['admin'],
        owns: ['/modules', '/ads-network', '/event', '/relance', '/sbclove', '/tombola', '/products', '/impact-challenges'] },
    { to: '/plus', label: 'Plus', icon: Menu, roles: ['admin', 'withdrawal_admin', 'moderator'],
        owns: ['/plus', '/settings', '/storage', '/notifications', '/statuses', '/user-roles', '/dashboard', '/logout'] },
];

export const navFor = (role: string | null) => NAV.filter(n => role && n.roles.includes(role));

export function isActive(item: NavItem, path: string): boolean {
    const owned = item.owns.some(p => (p.endsWith('-') ? path.startsWith(p) : path === p || path.startsWith(p + '/')));
    return item.to === '/' ? path === '/' || owned : owned;
}
