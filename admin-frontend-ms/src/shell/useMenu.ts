import { useMemo } from 'react';
import { useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { activePathFor, menuFor, shortcutsFor } from '../navigation/menu';

/**
 * The menu for the signed-in admin. The role comes from AuthContext `role`
 * (read from the session token, like the route guard), not from the stored
 * adminUser, so the menu never shows a page the guard would refuse.
 */
export function useMenu() {
  const { role } = useAuth();
  const { pathname } = useLocation();
  const groups = useMemo(() => menuFor(role), [role]);
  const shortcuts = useMemo(() => shortcutsFor(role), [role]);
  return { role, groups, shortcuts, activePath: activePathFor(groups, pathname) };
}
