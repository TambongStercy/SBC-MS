import type { IconSvgElement } from '@hugeicons/react';
import {
  Activity01Icon,
  BookOpen01Icon,
  Analytics01Icon, ChartBarLineIcon,
  CheckListIcon,
  FileSecurityIcon,
  Home01Icon,
  Money03Icon,
  Settings01Icon,
  Ticket01Icon,
  UserSearch01Icon,
  UserShield01Icon,
  Video01Icon,
  ViewIcon,
} from '@hugeicons/core-free-icons';
import { APPROVE_PERMISSIONS, REQUEST_PERMISSIONS, type Permission, type PermissionSet } from '../lib/permissions';

/** Who may open an entry: every permission of `all`, and at least one of `any`. */
export interface Access {
  all?: Permission[];
  any?: Permission[];
}

export interface MenuItem {
  label: string;
  path: string;
  icon: IconSvgElement;
  access: Access;
}

export interface MenuGroup {
  id: string;
  label: string;
  items: MenuItem[];
}

/**
 * Every screen of SBC Support, in one place: the sidebar, the phone menu, the
 * bottom bar, the command palette and the route guard all read it, so a
 * screen hidden from the menu is also refused by the router.
 */
export const MENU: MenuGroup[] = [
  {
    id: 'home',
    label: 'Accueil',
    items: [{ label: 'Accueil', path: '/', icon: Home01Icon, access: {} }],
  },
  {
    id: 'support',
    label: 'Support',
    items: [
      { label: 'Tickets', path: '/tickets', icon: Ticket01Icon, access: { all: ['tickets.read'] } },
      { label: 'Membres', path: '/membres', icon: UserSearch01Icon, access: { all: ['members.read'] } },
      { label: 'Activation', path: '/activation', icon: Activity01Icon, access: { all: ['activation.check'] } },
    ],
  },
  {
    id: 'finance',
    label: 'Finance',
    items: [
      { label: 'Finance', path: '/finance', icon: Money03Icon, access: { all: ['finance.read'] } },
      { label: 'Approbations', path: '/approbations', icon: CheckListIcon, access: { any: [...APPROVE_PERMISSIONS, ...REQUEST_PERMISSIONS] } },
    ],
  },
  {
    id: 'views',
    label: 'Vérifications',
    items: [
      { label: 'Vérifications', path: '/verifications', icon: Video01Icon, access: { all: ['views.verify'] } },
      { label: 'Supervision', path: '/supervision', icon: ViewIcon, access: { all: ['views.supervise'] } },
    ],
  },
  {
    id: 'content',
    label: 'Contenus et rapports',
    items: [
      { label: 'Contenus', path: '/contenus', icon: BookOpen01Icon, access: { any: ['kb.edit', 'kb.publish', 'templates.manage'] } },
      { label: 'Rapports', path: '/rapports', icon: ChartBarLineIcon, access: { all: ['reports.read'] } },
      { label: 'Analytique', path: '/analytique', icon: Analytics01Icon, access: { all: ['analytics.read'] } },
    ],
  },
  {
    id: 'admin',
    label: 'Administration',
    items: [
      { label: 'Agents', path: '/admin/agents', icon: UserShield01Icon, access: { all: ['agents.manage'] } },
      { label: 'Réglages', path: '/admin/reglages', icon: Settings01Icon, access: { all: ['settings.manage'] } },
      { label: 'Journal d’audit', path: '/admin/audit', icon: FileSecurityIcon, access: { all: ['audit.read'] } },
    ],
  },
];

export const LOGOUT = { label: 'Déconnexion', path: '/deconnexion' } as const;

export function allows(perms: PermissionSet, access: Access): boolean {
  if (access.all && !access.all.every(p => perms.has(p))) return false;
  if (access.any && !access.any.some(p => perms.has(p))) return false;
  return true;
}

const ALL_ITEMS = MENU.flatMap(g => g.items);

/** The menu entry that owns a path (the most specific one). */
export function itemForPath(pathname: string): MenuItem | undefined {
  return ALL_ITEMS
    .filter(i => (i.path === '/' ? pathname === '/' : pathname === i.path || pathname.startsWith(`${i.path}/`)))
    .sort((a, b) => b.path.length - a.path.length)[0];
}

/** Same rule as the menu: a path is open when its menu entry is. Unknown paths are open (404 page). */
export function canOpenPath(perms: PermissionSet, pathname: string): boolean {
  const item = itemForPath(pathname);
  return item ? allows(perms, item.access) : true;
}

export function menuFor(perms: PermissionSet): MenuGroup[] {
  return MENU
    .map(g => ({ ...g, items: g.items.filter(i => allows(perms, i.access)) }))
    .filter(g => g.items.length > 0);
}

export function activePathFor(groups: MenuGroup[], pathname: string): string | undefined {
  const item = itemForPath(pathname);
  return item && groups.some(g => g.items.includes(item) || g.items.some(i => i.path === item.path)) ? item.path : undefined;
}

/**
 * Where an agent lands. A verifier's job is the next task, so their home is
 * the verification screen; everyone else gets the overview (/).
 */
export function homeFor(perms: PermissionSet): string {
  const onlyVerifies = perms.has('views.verify') && !perms.has('tickets.read') && !perms.has('views.supervise');
  return onlyVerifies ? '/verifications' : '/';
}

/** Phone bottom bar: the first three screens the agent can open, then "Menu". */
const SHORTCUT_PATHS = ['/verifications', '/tickets', '/membres', '/finance', '/approbations', '/supervision', '/activation', '/contenus', '/admin/agents'];

export function shortcutsFor(perms: PermissionSet): MenuItem[] {
  const home = homeFor(perms);
  const first = home === '/' ? [ALL_ITEMS[0]] : [];
  const rest = SHORTCUT_PATHS
    .map(p => ALL_ITEMS.find(i => i.path === p))
    .filter((i): i is MenuItem => !!i && allows(perms, i.access));
  return [...first, ...rest].slice(0, 3);
}
