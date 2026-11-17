/**
 * Per-module admin access (2026-11-16).
 *
 * Mirrors user-service src/config/admin-modules.ts (the module list) and
 * gateway-service src/api/middleware/admin-routes.ts (API path → module). The
 * gateway is the real gate; this file decides what the admin shows: the menu,
 * the route guard and the "Lecture seule" badge.
 *
 * A staff account holds, per module, 'read' (sees the pages, changes nothing)
 * or 'write'; a module missing from its map is not visible at all. The super
 * admin (`admin`) holds every module in write, `staff` (the team) included,
 * which is never delegated.
 */

export const ADMIN_MODULES = [
  'dashboard',
  'members',
  'partners',
  'leaderboard',
  'finance',
  'payments',
  'withdrawals',
  'payouts',
  'boutique',
  'tombola',
  'impactChallenge',
  'sbclove',
  'ads',
  'adsProofs',
  'events',
  'relance',
  'notifications',
  'communication',
  'settings',
  'whatsapp',
  'staff',
] as const;

export type AdminModule = typeof ADMIN_MODULES[number];
export type AccessLevel = 'read' | 'write';
/** What an account may do, per module; a missing module = no access. */
export type Permissions = Partial<Record<AdminModule, AccessLevel>>;
/** One module's access as the screens see it. */
export type Access = 'none' | AccessLevel;

/** Modules a staff account can be given ('staff' stays with the super admin). */
export const DELEGABLE_MODULES: AdminModule[] = ADMIN_MODULES.filter(m => m !== 'staff');

export const isAdminModule = (m: unknown): m is AdminModule =>
  typeof m === 'string' && (ADMIN_MODULES as readonly string[]).includes(m);

export interface ModuleInfo {
  label: string;
  description: string;
}

export const MODULE_INFO: Record<AdminModule, ModuleInfo> = {
  dashboard: { label: 'Accueil', description: 'Statistiques générales de la page d’accueil.' },
  members: { label: 'Membres', description: 'Liste et fiche des membres, blocage, abonnements.' },
  partners: { label: 'Partenaires', description: 'Partenaires et leurs packs.' },
  leaderboard: { label: 'Classement', description: 'Classement des membres et bonus du classement.' },
  finance: { label: 'Transactions', description: 'Transactions, transactions des comptes, analyse membres, ajustements de solde.' },
  payments: { label: 'Paiements', description: 'Récupération de paiements, problèmes fournisseurs, soldes des passerelles.' },
  withdrawals: { label: 'Retraits', description: 'Retraits à valider et historique des retraits.' },
  payouts: { label: 'Paiements directs', description: 'Envois d’argent depuis le compte SBC.' },
  boutique: { label: 'Boutique', description: 'Produits et ventes flash.' },
  tombola: { label: 'Tombola', description: 'Tombolas mensuelles, tickets et tirages.' },
  impactChallenge: { label: 'Impact Challenge', description: 'Challenges, entrepreneurs et votes.' },
  sbclove: { label: 'SBC Love', description: 'Profils, signalements et modération de SBC Love.' },
  ads: { label: 'SBC Ads Network', description: 'Tableau de bord, validation des campagnes, diffuseurs (sans les vérifications vidéo).' },
  adsProofs: { label: 'Vérifications vidéo', description: 'Preuves vidéo des diffuseurs à vérifier.' },
  events: { label: 'SBC Event', description: 'Billetterie, organisateurs, commandes, litiges, animation.' },
  relance: { label: 'Relance', description: 'Modèles e-mail et SMS, campagnes de relance.' },
  notifications: { label: 'Notifications', description: 'Notifications envoyées et annonces push.' },
  communication: { label: 'Chat et statuts', description: 'Conversations et statuts des membres.' },
  settings: { label: 'Réglages', description: 'Réglages, formations, stockage, événements communautaires.' },
  whatsapp: { label: 'WhatsApp', description: 'Connexion WhatsApp du serveur.' },
  staff: { label: 'Équipe et droits', description: 'Gérer l’équipe et ses droits (super admin uniquement).' },
};

export interface ModuleGroup {
  id: string;
  label: string;
  modules: AdminModule[];
}

/** Modules grouped for display (rights editor). Every module appears once. */
export const MODULE_GROUPS: ModuleGroup[] = [
  { id: 'dashboard', label: 'Tableau de bord', modules: ['dashboard'] },
  { id: 'members', label: 'Membres', modules: ['members', 'partners', 'leaderboard'] },
  { id: 'money', label: 'Argent', modules: ['finance', 'payments', 'withdrawals', 'payouts'] },
  { id: 'services', label: 'Services', modules: ['boutique', 'tombola', 'impactChallenge', 'sbclove', 'ads', 'adsProofs', 'events'] },
  { id: 'communication', label: 'Communication', modules: ['relance', 'notifications', 'communication'] },
  { id: 'system', label: 'Système', modules: ['settings', 'whatsapp'] },
  { id: 'team', label: 'Équipe', modules: ['staff'] },
];

/**
 * Admin screen path → module. First match wins, so specific paths come before
 * their prefix (/ads-network/manual-verifications before /ads-network).
 * Consistent with the gateway table: a screen belongs to the module of the
 * API calls it makes.
 */
const PATH_RULES: { pattern: RegExp; module: AdminModule }[] = [
  { pattern: /^\/(dashboard)?$/, module: 'dashboard' },
  { pattern: /^\/(users|userpage)(\/|$)/, module: 'members' },
  { pattern: /^\/partners(\/|$)/, module: 'partners' },
  { pattern: /^\/(transactions|account-transactions|user-analytics)(\/|$)/, module: 'finance' },
  { pattern: /^\/(fix-[^/]+|manual-payment-recovery)(\/|$)/, module: 'payments' },
  { pattern: /^\/withdrawals(\/|$)/, module: 'withdrawals' },
  { pattern: /^\/products(\/|$)/, module: 'boutique' },
  { pattern: /^\/tombola(\/|$)/, module: 'tombola' },
  { pattern: /^\/impact-challenges(\/|$)/, module: 'impactChallenge' },
  { pattern: /^\/sbclove(\/|$)/, module: 'sbclove' },
  { pattern: /^\/ads-network\/manual-verifications(\/|$)/, module: 'adsProofs' },
  { pattern: /^\/ads-network(\/|$)/, module: 'ads' },
  { pattern: /^\/event(\/|$)/, module: 'events' },
  { pattern: /^\/relance(\/|$)/, module: 'relance' },
  { pattern: /^\/notifications(\/|$)/, module: 'notifications' },
  { pattern: /^\/(chat|statuses)(\/|$)/, module: 'communication' },
  { pattern: /^\/(settings|storage)(\/|$)/, module: 'settings' },
  { pattern: /^\/(user-roles|equipe)(\/|$)/, module: 'staff' },
];

/** Screens every signed-in account may open, whatever its rights. */
const OPEN_PATHS = new Set(['/logout']);

/** The module a screen belongs to, or null when the path is not mapped. */
export function moduleForPath(pathname: string): AdminModule | null {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, '').toLowerCase() : pathname;
  return PATH_RULES.find(r => r.pattern.test(path))?.module ?? null;
}

export function accessTo(permissions: Permissions | null | undefined, module: AdminModule | null): Access {
  if (!permissions || !module) return 'none';
  return permissions[module] ?? 'none';
}

export const canRead = (permissions: Permissions | null | undefined, module: AdminModule | null): boolean =>
  accessTo(permissions, module) !== 'none';

export const canWrite = (permissions: Permissions | null | undefined, module: AdminModule | null): boolean =>
  accessTo(permissions, module) === 'write';

/**
 * Whether this account may open a screen. A path that maps to no module is
 * super-admin only (like an unmapped admin API path at the gateway), so a new
 * screen stays closed to staff until it is mapped here.
 */
export function canOpenPath(permissions: Permissions | null | undefined, pathname: string): boolean {
  if (OPEN_PATHS.has(pathname)) return true;
  return canRead(permissions, moduleForPath(pathname) ?? 'staff');
}

/** Each module's main screen (modules without a screen of their own are left out). */
const MODULE_HOME: Partial<Record<AdminModule, string>> = {
  dashboard: '/',
  members: '/users',
  partners: '/partners',
  finance: '/transactions',
  payments: '/fix-provider-issues',
  withdrawals: '/withdrawals/approvals',
  boutique: '/products',
  tombola: '/tombola',
  impactChallenge: '/impact-challenges',
  sbclove: '/sbclove',
  ads: '/ads-network',
  adsProofs: '/ads-network/manual-verifications',
  events: '/event',
  relance: '/relance/dashboard',
  notifications: '/notifications',
  communication: '/chat',
  settings: '/settings',
  staff: '/equipe',
};

/** The first screen this account can read (display order), or null when it has none. */
export function homeFor(permissions: Permissions | null | undefined): string | null {
  for (const module of ADMIN_MODULES) {
    const home = MODULE_HOME[module];
    if (home && canRead(permissions, module)) return home;
  }
  return null;
}

/** True when the account can read at least one module. */
export const hasAnyModule = (permissions: Permissions | null | undefined): boolean =>
  !!permissions && ADMIN_MODULES.some(m => canRead(permissions, m));

/** Keeps only known modules with a valid level (server answers, stored copies). */
export function sanitizePermissions(input: unknown): Permissions {
  const out: Permissions = {};
  if (!input || typeof input !== 'object') return out;
  for (const [module, level] of Object.entries(input as Record<string, unknown>)) {
    if (!isAdminModule(module)) continue;
    if (level === 'read' || level === 'write') out[module] = level;
  }
  return out;
}

/**
 * What a role grants on its own, for sessions opened before the server sent
 * `adminPermissions` (same rule as user-service effectivePermissions). A
 * `staff` account's rights are stored per account: null = ask the server.
 */
export function permissionsForRole(role: string | null | undefined): Permissions | null {
  switch (role) {
    case 'admin':
      return Object.fromEntries(ADMIN_MODULES.map(m => [m, 'write'])) as Permissions;
    case 'withdrawal_admin':
      return { withdrawals: 'write' };
    case 'moderator':
      return { adsProofs: 'write' };
    case 'staff':
      return null;
    default:
      return {};
  }
}

/** "3 modules · 1 en modification", "Aucun droit". */
export function summarizePermissions(permissions: Permissions | null | undefined): string {
  const levels = Object.values(permissions ?? {}).filter(Boolean);
  if (levels.length === 0) return 'Aucun droit';
  const writes = levels.filter(l => l === 'write').length;
  const modules = `${levels.length} module${levels.length > 1 ? 's' : ''}`;
  return writes > 0 ? `${modules} · ${writes} en modification` : `${modules} · lecture seule`;
}

/**
 * The gateway's refusals for a module the account cannot change or cannot see
 * (gateway-service admin-allowlist.middleware.ts). The API client shows them
 * as a toast instead of signing the admin out.
 */
export const GATEWAY_ACCESS_MESSAGES: readonly string[] = [
  'Vous avez cet espace en lecture seule, ou pas du tout.',
  'Vous n’avez pas accès à cet espace.',
];

export const isGatewayAccessRefusal = (status: number | undefined, body: unknown): body is { message: string } =>
  status === 403 &&
  !!body && typeof body === 'object' &&
  GATEWAY_ACCESS_MESSAGES.includes(String((body as { message?: unknown }).message));
