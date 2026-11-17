import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MENU } from '../navigation/menu';
import {
  ADMIN_MODULES, DELEGABLE_MODULES, MODULE_GROUPS, MODULE_INFO, canOpenPath, canRead, canWrite, hasAnyModule, homeFor,
  isGatewayAccessRefusal, moduleForPath, permissionsForRole, sanitizePermissions, summarizePermissions,
  type Permissions,
} from './permissions';

/** Every route path declared in App.tsx, with sample values for its parameters. */
function appRoutePaths(): string[] {
  const source = readFileSync(resolve(__dirname, '../App.tsx'), 'utf8');
  return [...source.matchAll(/<Route\s+path="([^"]+)"/g)]
    .map(m => m[1])
    .filter(p => p !== '*' && p !== '/login')
    .map(p => p.replace(/:[A-Za-z]+/g, 'abc123'));
}

describe('moduleForPath', () => {
  it('maps every menu entry to a module', () => {
    for (const item of MENU.flatMap(g => g.items)) {
      expect(moduleForPath(item.path), item.path).not.toBeNull();
    }
  });

  it('maps every signed-in route of App.tsx to a module (except /logout)', () => {
    const paths = appRoutePaths();
    expect(paths.length).toBeGreaterThan(40);
    for (const path of paths) {
      if (path === '/logout') continue;
      expect(moduleForPath(path), path).not.toBeNull();
    }
  });

  it.each([
    ['/', 'dashboard'],
    ['/dashboard', 'dashboard'],
    ['/users', 'members'],
    ['/userpage/abc', 'members'],
    ['/partners', 'partners'],
    ['/transactions', 'finance'],
    ['/account-transactions', 'finance'],
    ['/user-analytics', 'finance'],
    ['/fix-provider-issues', 'payments'],
    ['/fix-moneyfusion-withdrawals', 'payments'],
    ['/fix-feexpay-payments', 'payments'],
    ['/manual-payment-recovery', 'payments'],
    ['/withdrawals/approvals', 'withdrawals'],
    ['/withdrawals/history', 'withdrawals'],
    ['/products', 'boutique'],
    ['/tombola', 'tombola'],
    ['/tombola/draw/2026-11', 'tombola'],
    ['/impact-challenges/42', 'impactChallenge'],
    ['/sbclove', 'sbclove'],
    ['/ads-network/manual-verifications', 'adsProofs'],
    ['/ads-network', 'ads'],
    ['/ads-network/review', 'ads'],
    ['/event', 'events'],
    ['/event/animation', 'events'],
    ['/relance/campaigns', 'relance'],
    ['/notifications', 'notifications'],
    ['/notifications/push', 'notifications'],
    ['/chat', 'communication'],
    ['/statuses', 'communication'],
    ['/settings', 'settings'],
    ['/storage', 'settings'],
    ['/user-roles', 'staff'],
    ['/equipe', 'staff'],
    ['/Equipe/', 'staff'],
  ])('%s → %s', (path, module) => {
    expect(moduleForPath(path)).toBe(module);
  });

  it('does not confuse look-alike prefixes', () => {
    expect(moduleForPath('/user-roles')).toBe('staff');
    expect(moduleForPath('/user-analytics')).toBe('finance');
    expect(moduleForPath('/events-x')).toBeNull();
    expect(moduleForPath('/unknown')).toBeNull();
  });
});

describe('canRead / canWrite', () => {
  const perms: Permissions = { members: 'read', withdrawals: 'write' };

  it('reads what is read or write, writes only what is write', () => {
    expect(canRead(perms, 'members')).toBe(true);
    expect(canWrite(perms, 'members')).toBe(false);
    expect(canRead(perms, 'withdrawals')).toBe(true);
    expect(canWrite(perms, 'withdrawals')).toBe(true);
    expect(canRead(perms, 'finance')).toBe(false);
    expect(canWrite(perms, 'finance')).toBe(false);
  });

  it('refuses everything without permissions or module', () => {
    expect(canRead(null, 'members')).toBe(false);
    expect(canRead(undefined, 'members')).toBe(false);
    expect(canRead(perms, null)).toBe(false);
  });

  it('opens unmapped paths to the super admin only, /logout to everyone', () => {
    expect(canOpenPath({}, '/logout')).toBe(true);
    expect(canOpenPath(perms, '/something-new')).toBe(false);
    expect(canOpenPath(permissionsForRole('admin'), '/something-new')).toBe(true);
    expect(canOpenPath(perms, '/users')).toBe(true);
    expect(canOpenPath(perms, '/equipe')).toBe(false);
  });
});

describe('homeFor', () => {
  it('sends the super admin to the dashboard', () => {
    expect(homeFor(permissionsForRole('admin'))).toBe('/');
  });

  it('sends a limited account to its first readable page', () => {
    expect(homeFor({ withdrawals: 'write' })).toBe('/withdrawals/approvals');
    expect(homeFor({ adsProofs: 'write' })).toBe('/ads-network/manual-verifications');
    expect(homeFor({ events: 'read', members: 'read' })).toBe('/users');
    expect(homeFor({ ads: 'read', adsProofs: 'read' })).toBe('/ads-network');
  });

  it('skips modules without a screen of their own', () => {
    expect(homeFor({ leaderboard: 'read', payouts: 'write', whatsapp: 'read' })).toBeNull();
    expect(homeFor({ leaderboard: 'read', settings: 'read' })).toBe('/settings');
  });

  it('is null without any readable module', () => {
    expect(homeFor({})).toBeNull();
    expect(homeFor(null)).toBeNull();
    expect(hasAnyModule({})).toBe(false);
    expect(hasAnyModule({ whatsapp: 'read' })).toBe(true);
  });
});

describe('module list', () => {
  it('has a label for every module and groups each one exactly once', () => {
    expect(ADMIN_MODULES).toHaveLength(21);
    for (const m of ADMIN_MODULES) expect(MODULE_INFO[m].label).toBeTruthy();
    const grouped = MODULE_GROUPS.flatMap(g => g.modules);
    expect([...grouped].sort()).toEqual([...ADMIN_MODULES].sort());
  });

  it('never delegates staff', () => {
    expect(DELEGABLE_MODULES).not.toContain('staff');
    expect(DELEGABLE_MODULES).toHaveLength(20);
  });
});

describe('role fallback and helpers', () => {
  it('matches user-service effectivePermissions for the older roles', () => {
    expect(permissionsForRole('withdrawal_admin')).toEqual({ withdrawals: 'write' });
    expect(permissionsForRole('moderator')).toEqual({ adsProofs: 'write' });
    expect(permissionsForRole('staff')).toBeNull();
    expect(permissionsForRole('user')).toEqual({});
    const admin = permissionsForRole('admin')!;
    expect(ADMIN_MODULES.every(m => admin[m] === 'write')).toBe(true);
  });

  it('drops unknown modules and levels', () => {
    expect(sanitizePermissions({ members: 'read', bogus: 'write', finance: 'admin' })).toEqual({ members: 'read' });
    expect(sanitizePermissions(null)).toEqual({});
  });

  it('summarizes rights in French', () => {
    expect(summarizePermissions({})).toBe('Aucun droit');
    expect(summarizePermissions({ members: 'read', finance: 'read', withdrawals: 'write' })).toBe('3 modules · 1 en modification');
    expect(summarizePermissions({ members: 'read' })).toBe('1 module · lecture seule');
  });

  it('recognises only the gateway module refusals', () => {
    expect(isGatewayAccessRefusal(403, { message: 'Vous avez cet espace en lecture seule, ou pas du tout.' })).toBe(true);
    expect(isGatewayAccessRefusal(403, { message: 'Vous n’avez pas accès à cet espace.' })).toBe(true);
    expect(isGatewayAccessRefusal(403, { message: 'Admin access denied' })).toBe(false);
    expect(isGatewayAccessRefusal(401, { message: 'Vous n’avez pas accès à cet espace.' })).toBe(false);
    expect(isGatewayAccessRefusal(403, undefined)).toBe(false);
  });
});
