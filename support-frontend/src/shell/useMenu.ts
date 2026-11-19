import { useMemo } from 'react';
import { useLocation } from 'react-router-dom';
import { usePermissions } from '../auth/context';
import { activePathFor, homeFor, menuFor, shortcutsFor } from '../navigation/menu';

/** The menu for the signed-in agent, filtered by their permissions (the same rule as the route guard). */
export function useMenu() {
  const perms = usePermissions();
  const { pathname } = useLocation();
  const groups = useMemo(() => menuFor(perms), [perms]);
  const shortcuts = useMemo(() => shortcutsFor(perms), [perms]);
  const home = useMemo(() => homeFor(perms), [perms]);
  return { groups, shortcuts, home, activePath: activePathFor(groups, pathname) };
}
