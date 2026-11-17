import { useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { accessTo, moduleForPath, type Access, type AdminModule } from '../lib/permissions';

/** This account's access to a module: 'none', 'read' or 'write'. */
export function usePermission(module: AdminModule): Access {
  const { permissions } = useAuth();
  return accessTo(permissions, module);
}

/** The current screen's module and this account's access to it. */
export function useCurrentAccess(): { module: AdminModule | null; access: Access } {
  const { pathname } = useLocation();
  const { permissions } = useAuth();
  const module = moduleForPath(pathname);
  return { module, access: accessTo(permissions, module) };
}
