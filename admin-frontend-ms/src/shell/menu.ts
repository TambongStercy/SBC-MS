import {
    ArrowDownUp, BarChart3, Banknote, FileText, Gift, HardDrive, Heart, Home, Hourglass, Landmark, LifeBuoy, ListChecks, Mail,
    Megaphone, MessageCircle, Bell, ShieldCheck, ShoppingBag, Sparkles, Ticket, Trophy, Users, Video, CreditCard, type LucideIcon,
} from 'lucide-react';
import { canOpen } from '../lib/roles';

export type MenuItem = {
    to: string;
    label: string;
    icon: LucideIcon;
    /** The icon's colour, as each entry had its own in the original admin's sidebar. */
    color: string;
    /** Queue keys (features/home/queues) whose counts show as a badge. */
    badge?: string[];
    /** Other paths that belong to this entry, so it stays lit on them. */
    also?: string[];
};
export type MenuSection = { title?: string; items: MenuItem[] };

/**
 * Every page of the admin, in one menu (sidebar on a computer, the ☰ drawer on
 * a phone). Named for what an admin is trying to do, not after services.
 */
export const MENU: MenuSection[] = [
    { items: [
        { to: '/', label: 'Accueil', icon: Home, color: '#6366f1' },
        { to: '/membres', label: 'Membres', icon: Users, color: '#8b5cf6', also: ['/membres/'] },
    ] },
    { title: 'À traiter', items: [
        { to: '/a-traiter/verifications', label: 'Vérifications vidéo', icon: Video, color: '#ef4444', badge: ['proofs'] },
        { to: '/a-traiter/retraits', label: 'Retraits à valider', icon: Banknote, color: '#f59e0b', badge: ['withdrawals'] },
    ] },
    { title: 'Retraits', items: [
        { to: '/argent/retraits', label: 'Tous les retraits', icon: ListChecks, color: '#06b6d4' },
        { to: '/argent/bloques', label: 'Retraits sans réponse', icon: Hourglass, color: '#3b82f6', badge: ['stuck'] },
    ] },
    { title: 'Paiements', items: [
        { to: '/argent/paiements', label: 'Paiements des membres', icon: CreditCard, color: '#f472b6' },
        { to: '/argent/paiements?vue=mouvements', label: 'Historique des soldes', icon: ArrowDownUp, color: '#10b981' },
        { to: '/argent/resoudre', label: 'Problème de paiement', icon: LifeBuoy, color: '#f59e0b', also: ['/argent/resoudre/'] },
        { to: '/argent/passerelles', label: 'Argent chez les opérateurs', icon: Landmark, color: '#a855f7' },
        { to: '/argent/analyse', label: 'Plus gros gains', icon: BarChart3, color: '#8b5cf6' },
    ] },
    { title: 'Services de l’app', items: [
        { to: '/modules/ads', label: 'Publicité', icon: Megaphone, color: '#6366f1', badge: ['campaigns'] },
        { to: '/modules/billetterie', label: 'Billetterie', icon: Ticket, color: '#3b82f6', badge: ['organizers', 'disputes'], also: ['/modules/billetterie/'] },
        { to: '/modules/relance', label: 'Relance des filleuls', icon: Mail, color: '#06b6d4', also: ['/modules/relance/'] },
        { to: '/modules/sbc-love', label: 'SBC Love', icon: Heart, color: '#ec4899', badge: ['love'] },
        { to: '/modules/tombola', label: 'Tombola', icon: Gift, color: '#f59e0b', also: ['/modules/tombola/'] },
        { to: '/modules/boutique', label: 'Boutique', icon: ShoppingBag, color: '#10b981' },
        { to: '/modules/impact-challenge', label: 'Impact Challenge', icon: Trophy, color: '#f97316', also: ['/modules/impact-challenge/'] },
    ] },
    { title: 'Communication', items: [
        { to: '/plus/annonces', label: 'Notifications aux membres', icon: Bell, color: '#f472b6' },
        { to: '/plus/whatsapp', label: 'WhatsApp de SBC', icon: MessageCircle, color: '#22c55e' },
        { to: '/plus/stories', label: 'Stories', icon: Sparkles, color: '#a855f7' },
    ] },
    { title: 'Réglages', items: [
        { to: '/plus/contenu', label: 'Contenu de l’app', icon: FileText, color: '#6366f1' },
        { to: '/plus/roles', label: 'Équipe admin', icon: ShieldCheck, color: '#8b5cf6' },
        { to: '/plus/statistiques', label: 'Statistiques', icon: BarChart3, color: '#06b6d4' },
        { to: '/plus/stockage', label: 'Fichiers et stockage', icon: HardDrive, color: '#94a3b8' },
    ] },
];

/** The menu as this role may use it: entries it can't open are left out, then empty sections. */
export function menuFor(role: string | null): MenuSection[] {
    return MENU
        .map(s => ({ ...s, items: s.items.filter(i => canOpen(role, i.to.split('?')[0])) }))
        .filter(s => s.items.length > 0);
}

/** Lit when the address is this entry (query included, if it has one) or one of its own sub-pages. */
export function isCurrent(item: MenuItem, pathname: string, search: string): boolean {
    const [path, query] = item.to.split('?');
    if (query) return pathname === path && search.includes(query);
    if (pathname === path) {
        // "Paiements des membres" must not stay lit while its "Historique des soldes" view is open.
        const sibling = MENU.flatMap(s => s.items).some(o => o !== item && o.to.startsWith(path + '?') && search.includes(o.to.split('?')[1]));
        return !sibling;
    }
    return (item.also ?? []).some(p => pathname.startsWith(p));
}
