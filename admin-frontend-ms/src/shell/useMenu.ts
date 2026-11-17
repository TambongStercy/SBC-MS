import { useMemo } from 'react';
import { useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { homeFor } from '../lib/permissions';
import { activePathFor, menuFor, shortcutsFor } from '../navigation/menu';

/**
 * The menu for the signed-in admin, filtered by their per-module rights (the
 * same rule as the route guard), so it never shows a page the guard refuses.
 */
export function useMenu() {
  const { permissions } = useAuth();
  const { pathname } = useLocation();
  const groups = useMemo(() => menuFor(permissions), [permissions]);
  const shortcuts = useMemo(() => shortcutsFor(permissions), [permissions]);
  const home = useMemo(() => homeFor(permissions) ?? '/', [permissions]);
  return { groups, shortcuts, home, activePath: activePathFor(groups, pathname) };
}
