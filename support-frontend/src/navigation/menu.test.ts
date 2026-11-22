import { describe, expect, it } from 'vitest';
import { permissionsForRoles, ROLES, type Role } from '../lib/permissions';
import { canOpenPath, homeFor, menuFor, shortcutsFor } from './menu';

const perms = (...roles: Role[]) => new Set<string>(permissionsForRoles(roles));
const paths = (...roles: Role[]) => menuFor(perms(...roles)).flatMap(g => g.items.map(i => i.path));

describe('menu filtered by permissions', () => {
  it.each<[Role, string[]]>([
    ['support_agent', ['/', '/tickets', '/membres', '/activation', '/identites', '/approbations', '/contenus']],
    ['finance_agent', ['/', '/tickets', '/membres', '/activation', '/identites', '/finance', '/approbations', '/rapports']],
    ['finance_manager', ['/', '/tickets', '/membres', '/activation', '/identites', '/finance', '/approbations', '/contenus', '/rapports']],
    ['verifier', ['/', '/verifications']],
    ['views_supervisor', ['/', '/tickets', '/membres', '/identites', '/verifications', '/supervision', '/contenus', '/rapports']],
    ['support_admin', ['/', '/tickets', '/membres', '/activation', '/identites', '/finance', '/approbations', '/supervision', '/contenus', '/rapports', '/analytique', '/admin/agents', '/admin/reglages', '/admin/audit']],
  ])('%s', (role, expected) => {
    expect(paths(role)).toEqual(expected);
  });

  it('administration is for support_admin only', () => {
    for (const r of ROLES.filter(r => r !== 'support_admin')) {
      expect(canOpenPath(perms(r), '/admin/agents')).toBe(false);
      expect(canOpenPath(perms(r), '/admin/audit')).toBe(false);
    }
  });

  it('the route guard follows the menu, sub-pages included', () => {
    expect(canOpenPath(perms('verifier'), '/tickets/abc')).toBe(false);
    expect(canOpenPath(perms('support_agent'), '/tickets/abc')).toBe(true);
    expect(canOpenPath(perms('support_agent'), '/finance')).toBe(false);
    expect(canOpenPath(perms('finance_agent'), '/supervision')).toBe(false);
  });

  it('identities: every support role but the views verifier', () => {
    expect(canOpenPath(perms('verifier'), '/identites/abc')).toBe(false);
    expect(canOpenPath(perms('support_agent'), '/identites/abc')).toBe(true);
  });

  it('several roles add up', () => {
    expect(paths('verifier', 'support_agent')).toContain('/verifications');
    expect(paths('verifier', 'support_agent')).toContain('/tickets');
  });

  it('home by role: a verifier lands on the next task', () => {
    expect(homeFor(perms('verifier'))).toBe('/verifications');
    expect(homeFor(perms('views_supervisor'))).toBe('/');
    expect(homeFor(perms('support_agent'))).toBe('/');
  });

  it('bottom bar: three shortcuts the agent can open', () => {
    expect(shortcutsFor(perms('verifier')).map(i => i.path)).toEqual(['/verifications']);
    expect(shortcutsFor(perms('support_agent')).map(i => i.path)).toEqual(['/', '/tickets', '/membres']);
    expect(shortcutsFor(perms('finance_agent')).map(i => i.path)).toEqual(['/', '/tickets', '/membres']);
  });
});
