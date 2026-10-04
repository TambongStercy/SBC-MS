import {
    ArrowDownUp, BarChart3, Banknote, FileText, Gift, HardDrive, Heart, Home, Hourglass, Landmark, LifeBuoy, ListChecks, Mail,
    Megaphone, MessageCircle, Bell, ShieldCheck, ShoppingBag, Sparkles, Ticket, Trophy, Users, Video, CreditCard, type LucideIcon,
} from 'lucide-react';
import { canOpen } from '../lib/roles';

export type MenuItem = {
    to: string;
    label: string;
    icon: LucideIcon;
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
        { to: '/', label: 'Accueil', icon: Home },
        { to: '/membres', label: 'Membres', icon: Users, also: ['/membres/'] },
    ] },
    { title: 'À traiter', items: [
        { to: '/a-traiter/verifications', label: 'Vérifications vidéo', icon: Video, badge: ['proofs'] },
        { to: '/a-traiter/retraits', label: 'Retraits à valider', icon: Banknote, badge: ['withdrawals'] },
    ] },
    { title: 'Retraits', items: [
        { to: '/argent/retraits', label: 'Tous les retraits', icon: ListChecks },
        { to: '/argent/bloques', label: 'Retraits sans réponse', icon: Hourglass, badge: ['stuck'] },
    ] },
    { title: 'Paiements', items: [
        { to: '/argent/paiements', label: 'Paiements des membres', icon: CreditCard },
        { to: '/argent/paiements?vue=mouvements', label: 'Historique des soldes', icon: ArrowDownUp },
        { to: '/argent/resoudre', label: 'Problème de paiement', icon: LifeBuoy, also: ['/argent/resoudre/'] },
        { to: '/argent/passerelles', label: 'Argent chez les opérateurs', icon: Landmark },
        { to: '/argent/analyse', label: 'Plus gros gains', icon: BarChart3 },
    ] },
    { title: 'Services de l’app', items: [
        { to: '/modules/ads', label: 'Publicité', icon: Megaphone, badge: ['campaigns'] },
        { to: '/modules/billetterie', label: 'Billetterie', icon: Ticket, badge: ['organizers', 'disputes'], also: ['/modules/billetterie/'] },
        { to: '/modules/relance', label: 'Relance des filleuls', icon: Mail, also: ['/modules/relance/'] },
        { to: '/modules/sbc-love', label: 'SBC Love', icon: Heart, badge: ['love'] },
        { to: '/modules/tombola', label: 'Tombola', icon: Gift, also: ['/modules/tombola/'] },
        { to: '/modules/boutique', label: 'Boutique', icon: ShoppingBag },
        { to: '/modules/impact-challenge', label: 'Impact Challenge', icon: Trophy, also: ['/modules/impact-challenge/'] },
    ] },
    { title: 'Communication', items: [
        { to: '/plus/annonces', label: 'Notifications aux membres', icon: Bell },
        { to: '/plus/whatsapp', label: 'WhatsApp de SBC', icon: MessageCircle },
        { to: '/plus/stories', label: 'Stories', icon: Sparkles },
    ] },
    { title: 'Réglages', items: [
        { to: '/plus/contenu', label: 'Contenu de l’app', icon: FileText },
        { to: '/plus/roles', label: 'Équipe admin', icon: ShieldCheck },
        { to: '/plus/statistiques', label: 'Statistiques', icon: BarChart3 },
        { to: '/plus/stockage', label: 'Fichiers et stockage', icon: HardDrive },
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
