import type { IconSvgElement } from '@hugeicons/react';
import {
  Activity01Icon,
  Agreement01Icon,
  Analytics01Icon,
  Calendar03Icon,
  ChampionIcon,
  ChartIncreaseIcon,
  CheckListIcon,
  Clock01Icon,
  DashboardSquare01Icon,
  Discount01Icon,
  FavouriteIcon,
  HardDriveIcon,
  Home01Icon,
  Invoice01Icon,
  LifebuoyIcon,
  Mail01Icon,
  Megaphone01Icon,
  Megaphone02Icon,
  Message01Icon,
  MessageMultiple01Icon,
  PackageIcon,
  PartyIcon,
  RssIcon,
  SecurityCheckIcon,
  SentIcon,
  Settings01Icon,
  ShoppingCart01Icon,
  SmartPhone01Icon,
  Target01Icon,
  TestTube01Icon,
  Ticket01Icon,
  Ticket02Icon,
  UserGroupIcon,
  UserMultipleIcon,
  UserShield01Icon,
  UserSettings01Icon,
  Video01Icon,
  Wallet01Icon,
  Wrench01Icon,
} from '@hugeicons/core-free-icons';
import { canOpenPath, type Permissions } from '../lib/permissions';

export interface MenuItem {
  label: string;
  path: string;
  icon: IconSvgElement;
}

export interface MenuGroup {
  id: string;
  label: string;
  items: MenuItem[];
}

/**
 * Every page of the admin menu, in one place: the computer sidebar, the phone
 * menu, the phone bottom bar and the command palette all read it. Same entries
 * and paths as the original sidebar (the removed components/Sidebar.tsx),
 * in French. Pages reachable only by link (old fix pages, details) stay out.
 */
export const MENU: MenuGroup[] = [
  {
    id: 'dashboard',
    label: 'Tableau de bord',
    items: [
      { label: 'Activité', path: '/', icon: Activity01Icon },
      { label: 'Vue d’ensemble', path: '/dashboard', icon: Home01Icon },
    ],
  },
  {
    id: 'admin-tools',
    label: 'Outils admin',
    items: [
      { label: 'Équipe', path: '/equipe', icon: UserShield01Icon },
      { label: 'Rôles', path: '/user-roles', icon: UserSettings01Icon },
      // One page with three tabs (FeexPay payins, MoneyFusion and CinetPay
      // withdrawals); the old per-provider paths still work by direct link.
      { label: 'Problèmes fournisseurs', path: '/fix-provider-issues', icon: Wrench01Icon },
      { label: 'Récupération de paiement', path: '/manual-payment-recovery', icon: LifebuoyIcon },
    ],
  },
  {
    id: 'core',
    label: 'Gestion',
    items: [
      { label: 'Membres', path: '/users', icon: UserGroupIcon },
      { label: 'Partenaires', path: '/partners', icon: Agreement01Icon },
      { label: 'Boutique', path: '/products', icon: PackageIcon },
      { label: 'Tombola', path: '/tombola', icon: Ticket01Icon },
      { label: 'Impact Challenge', path: '/impact-challenges', icon: ChampionIcon },
      { label: 'SBC Love', path: '/sbclove', icon: FavouriteIcon },
    ],
  },
  {
    id: 'ads-network',
    label: 'SBC Ads Network',
    items: [
      { label: 'Tableau de bord', path: '/ads-network', icon: Megaphone01Icon },
      { label: 'Validation des campagnes', path: '/ads-network/review', icon: SecurityCheckIcon },
      { label: 'Vérifications vidéo', path: '/ads-network/manual-verifications', icon: Video01Icon },
      { label: 'Campagnes', path: '/ads-network/campaigns', icon: Target01Icon },
      { label: 'Diffuseurs', path: '/ads-network/diffuseurs', icon: ChampionIcon },
      { label: 'Campagne test', path: '/ads-network/test-campaign', icon: TestTube01Icon },
    ],
  },
  {
    id: 'event',
    label: 'SBC Event',
    items: [
      { label: 'Tableau de bord', path: '/event', icon: DashboardSquare01Icon },
      { label: 'Organisateurs', path: '/event/organizers', icon: UserMultipleIcon },
      { label: 'Événements', path: '/event/events', icon: Calendar03Icon },
      { label: 'Commandes', path: '/event/orders', icon: ShoppingCart01Icon },
      { label: 'Billets', path: '/event/tickets', icon: Ticket02Icon },
      { label: 'Marketplace revente', path: '/event/listings', icon: ChartIncreaseIcon },
      { label: 'Litiges', path: '/event/disputes', icon: Message01Icon },
      { label: 'Animation & votes', path: '/event/animation', icon: PartyIcon },
      { label: 'Commissions', path: '/event/commissions', icon: Discount01Icon },
    ],
  },
  {
    id: 'financial',
    label: 'Finances',
    items: [
      { label: 'Paiements (conversion)', path: '/paiements', icon: ChartIncreaseIcon },
      { label: 'Transactions', path: '/transactions', icon: Invoice01Icon },
      { label: 'Transactions des comptes', path: '/account-transactions', icon: Wallet01Icon },
      { label: 'Retraits à valider', path: '/withdrawals/approvals', icon: CheckListIcon },
      { label: 'Historique des retraits', path: '/withdrawals/history', icon: Clock01Icon },
      { label: 'Analyse membres', path: '/user-analytics', icon: Analytics01Icon },
    ],
  },
  {
    id: 'communication',
    label: 'Communication',
    items: [
      { label: 'Chat', path: '/chat', icon: MessageMultiple01Icon },
      { label: 'Statuts', path: '/statuses', icon: RssIcon },
    ],
  },
  {
    id: 'relance',
    label: 'Relance',
    items: [
      { label: 'Tableau de bord', path: '/relance/dashboard', icon: Activity01Icon },
      { label: 'Modèles e-mail', path: '/relance/messages', icon: Mail01Icon },
      { label: 'Modèles SMS', path: '/relance/sms-templates', icon: SmartPhone01Icon },
      { label: 'Campagnes', path: '/relance/campaigns', icon: Target01Icon },
    ],
  },
  {
    id: 'system',
    label: 'Système',
    items: [
      { label: 'Réglages', path: '/settings', icon: Settings01Icon },
      { label: 'Stockage', path: '/storage', icon: HardDriveIcon },
      { label: 'Notifications', path: '/notifications', icon: SentIcon },
      { label: 'Annonces push', path: '/notifications/push', icon: Megaphone02Icon },
    ],
  },
];

/** Not in a group: always last in the menus, open to every account. */
export const LOGOUT = { label: 'Déconnexion', path: '/logout' } as const;

/**
 * The menu as this account may use it: an entry shows when its module is
 * readable (lib/permissions, the same rule as the route guard). Empty groups
 * are dropped.
 */
export function menuFor(permissions: Permissions | null): MenuGroup[] {
  return MENU
    .map(g => ({ ...g, items: g.items.filter(i => canOpenPath(permissions, i.path)) }))
    .filter(g => g.items.length > 0);
}

/** The menu entry of the current page: the most specific path wins (/event/orders over /event). */
export function activePathFor(groups: MenuGroup[], pathname: string): string | undefined {
  return groups
    .flatMap(g => g.items)
    .filter(i => (i.path === '/' ? pathname === '/' : pathname === i.path || pathname.startsWith(`${i.path}/`)))
    .sort((a, b) => b.path.length - a.path.length)[0]?.path;
}

/**
 * Phone bottom bar, in order of preference; each account gets the first three
 * it can read, then "Menu". Super admin: Accueil, Membres, Retraits à
 * valider; a withdrawals-only account: its two withdrawal pages; a video
 * checker: Vérifications vidéo.
 */
const SHORTCUT_PATHS = [
  '/',
  '/users',
  '/withdrawals/approvals',
  '/ads-network/manual-verifications',
  '/event/events',
  '/withdrawals/history',
  '/transactions',
  '/partners',
  '/products',
  '/tombola',
  '/impact-challenges',
  '/sbclove',
  '/ads-network',
  '/relance/dashboard',
  '/notifications',
  '/chat',
  '/settings',
  '/equipe',
];

export function shortcutsFor(permissions: Permissions | null): MenuItem[] {
  const all = MENU.flatMap(g => g.items);
  return SHORTCUT_PATHS
    .filter(p => canOpenPath(permissions, p))
    .map(p => all.find(i => i.path === p))
    .filter((i): i is MenuItem => !!i)
    .slice(0, 3);
}
