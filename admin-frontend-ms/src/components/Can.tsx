import type { ReactNode } from 'react';
import { usePermission } from '../hooks/usePermission';
import type { AdminModule } from '../lib/permissions';

/**
 * Shows its children only when this account may use the module: reading by
 * default, changing with `write` (action buttons, forms). `fallback` is shown
 * otherwise. The gateway refuses the call anyway; this keeps the screen honest.
 */
export function Can({ module, write = false, fallback = null, children }: {
  module: AdminModule;
  write?: boolean;
  fallback?: ReactNode;
  children: ReactNode;
}) {
  const access = usePermission(module);
  const allowed = write ? access === 'write' : access !== 'none';
  return <>{allowed ? children : fallback}</>;
}
