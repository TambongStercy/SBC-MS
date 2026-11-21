import { describe, expect, it } from 'vitest';
import { permissionsForRole, type Permissions } from '../lib/permissions';
import { MENU, menuFor, shortcutsFor } from './menu';

const paths = (perms: Permissions | null) => menuFor(perms).flatMap(g => g.items.map(i => i.path));

describe('menuFor', () => {
  it('shows every entry to the super admin', () => {
    const all = MENU.flatMap(g => g.items.map(i => i.path));
    expect(paths(permissionsForRole('admin'))).toEqual(all);
    expect(all).toContain('/equipe');
  });

  it('shows a read-only staff account only its readable modules', () => {
    const groups = menuFor({ members: 'read', events: 'read' });
    expect(groups.map(g => g.id)).toEqual(['core', 'event']);
    expect(groups[0].items.map(i => i.path)).toEqual(['/users']);
    expect(groups[1].items.every(i => i.path.startsWith('/event'))).toBe(true);
    expect(paths({ members: 'read', events: 'read' })).not.toContain('/equipe');
  });

  it('keeps ads and video checks apart', () => {
    expect(paths({ adsProofs: 'write' })).toEqual(['/ads-network/manual-verifications']);
    expect(paths({ ads: 'read' })).not.toContain('/ads-network/manual-verifications');
    expect(paths({ ads: 'read' })).toContain('/ads-network/review');
  });

  it('shows nothing to an account without modules', () => {
    expect(menuFor({})).toEqual([]);
    expect(menuFor(null)).toEqual([]);
  });

  it('gives the older roles what they had', () => {
    expect(paths(permissionsForRole('withdrawal_admin'))).toEqual(['/withdrawals/approvals', '/withdrawals/history']);
    expect(paths(permissionsForRole('moderator'))).toEqual(['/ads-network/manual-verifications']);
  });
});

describe('shortcutsFor', () => {
  const shortcutPaths = (perms: Permissions | null) => shortcutsFor(perms).map(i => i.path);

  it('gives the super admin Accueil, Membres, Retraits à valider', () => {
    expect(shortcutPaths(permissionsForRole('admin'))).toEqual(['/', '/users', '/withdrawals/approvals']);
  });

  it('gives a limited account its first three readable pages', () => {
    expect(shortcutPaths({ withdrawals: 'write' })).toEqual(['/withdrawals/approvals', '/withdrawals/history']);
    expect(shortcutPaths({ adsProofs: 'read', events: 'read', finance: 'read', tombola: 'read' }))
      .toEqual(['/ads-network/manual-verifications', '/event/events', '/transactions']);
    expect(shortcutPaths({})).toEqual([]);
  });
});

describe('activePathFor', () => {
  it('Activité (/) and Vue d’ensemble (/dashboard) are two entries of the dashboard module', async () => {
    const { activePathFor } = await import('./menu');
    expect(activePathFor(MENU, '/')).toBe('/');
    expect(activePathFor(MENU, '/dashboard')).toBe('/dashboard');
    expect(paths({ dashboard: 'read' })).toEqual(['/', '/dashboard']);
  });
});
