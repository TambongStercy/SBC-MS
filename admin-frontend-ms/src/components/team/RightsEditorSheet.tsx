import { useEffect, useMemo, useState } from 'react';
import { HugeiconsIcon } from '@hugeicons/react';
import { Alert02Icon, InformationCircleIcon } from '@hugeicons/core-free-icons';
import { getAvatarUrl } from '../../api/apiClient';
import {
  DELEGABLE_MODULES, MODULE_GROUPS, MODULE_INFO, summarizePermissions,
  type Access, type AdminModule, type Permissions,
} from '../../lib/permissions';
import { ROLE_LABEL } from '../../lib/roles';
import { Avatar, Badge, Button, Dialog, DialogClose, SheetContent, Segmented } from '../ui';
import { CopyIdButton } from './CopyIdButton';

/** The account whose rights are being set. */
export interface RightsTarget {
  _id: string;
  name: string;
  email?: string;
  avatar?: string;
  role?: string;
  /** Rights it has today (effective). */
  permissions: Permissions;
}

const LEVELS: { value: Access; label: string }[] = [
  { value: 'none', label: 'Aucun' },
  { value: 'read', label: 'Lecture' },
  { value: 'write', label: 'Modification' },
];

const LEGACY_ROLES = new Set(['withdrawal_admin', 'moderator']);

/**
 * Sets, per module, no access / read / write for one account. Saving makes the
 * account a `staff` account with exactly these rights (a member, or an account
 * with an older role, is converted the same way).
 */
export function RightsEditorSheet({ target, modules, saving, onSave, onOpenChange }: {
  target: RightsTarget | null;
  /** Modules the server lets us delegate (from GET /staff). */
  modules?: AdminModule[];
  saving: boolean;
  onSave: (permissions: Permissions) => void;
  onOpenChange: (open: boolean) => void;
}) {
  const [draft, setDraft] = useState<Permissions>({});

  // A new account opens with what it has today.
  useEffect(() => {
    if (target) setDraft({ ...target.permissions });
  }, [target]);

  const delegable = useMemo(() => {
    const allowed = new Set<AdminModule>(modules && modules.length > 0 ? modules : DELEGABLE_MODULES);
    allowed.delete('staff');
    return MODULE_GROUPS
      .map(g => ({ ...g, modules: g.modules.filter(m => allowed.has(m)) }))
      .filter(g => g.modules.length > 0);
  }, [modules]);

  const setLevel = (module: AdminModule, level: Access) => {
    setDraft(d => {
      const next = { ...d };
      if (level === 'none') delete next[module];
      else next[module] = level;
      return next;
    });
  };

  const allRead = () => setDraft(Object.fromEntries(delegable.flatMap(g => g.modules).map(m => [m, 'read'])) as Permissions);
  const clearAll = () => setDraft({});

  const role = target?.role ?? 'user';
  const isStaff = role === 'staff';
  const isLegacy = LEGACY_ROLES.has(role);
  const empty = Object.keys(draft).length === 0;

  return (
    <Dialog open={!!target} onOpenChange={open => { if (!saving) onOpenChange(open); }}>
      {target && (
        <SheetContent
          width="lg"
          title={isStaff ? 'Droits du membre de l’équipe' : 'Donner des droits'}
          description="Pour chaque espace : aucun accès, lecture (consulter sans rien changer) ou modification."
          footer={(
            <>
              <DialogClose asChild>
                <Button variant="outline" size="lg" disabled={saving}>Annuler</Button>
              </DialogClose>
              <Button variant="primary" size="lg" loading={saving} onClick={() => onSave(draft)}>
                Enregistrer les droits
              </Button>
            </>
          )}
        >
          <div className="space-y-6">
            <div className="flex min-w-0 items-center gap-3">
              <Avatar src={getAvatarUrl(target.avatar)} name={target.name || target.email || '?'} size="md" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-fg">{target.name || 'Sans nom'}</p>
                {target.email && <p className="truncate text-sm text-fg-muted">{target.email}</p>}
              </div>
              {role !== 'user' && <Badge tone={isStaff ? 'info' : 'warning'}>{ROLE_LABEL[role] ?? role}</Badge>}
            </div>

            {!isStaff && (
              <div className="flex gap-3 rounded-control border border-line bg-surface-2 p-3 text-sm text-fg-muted">
                <HugeiconsIcon icon={InformationCircleIcon} size={18} aria-hidden="true" className="mt-0.5 shrink-0 text-info" />
                <p>
                  {isLegacy
                    ? `Ce compte a l’ancien rôle « ${ROLE_LABEL[role]} ». En enregistrant, il devient un compte Équipe avec exactement les droits ci-dessous.`
                    : 'En enregistrant, ce membre devient un compte Équipe avec les droits ci-dessous.'}
                </p>
              </div>
            )}

            <div className="space-y-1.5">
              <p className="text-sm font-medium text-fg">Identifiant du compte</p>
              <CopyIdButton value={target._id} />
              <p className="text-xs text-fg-muted">À transmettre à l’équipe technique pour ADMIN_ALLOWLIST.</p>
            </div>

            <div className="flex flex-col gap-3 border-y border-line py-4 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm text-fg" aria-live="polite">{summarizePermissions(draft)}</p>
              <div className="grid grid-cols-2 gap-2 sm:flex">
                <Button variant="outline" size="lg" onClick={allRead} disabled={saving}>Tout en lecture</Button>
                <Button variant="danger-ghost" size="lg" onClick={clearAll} disabled={saving || empty}>Tout retirer</Button>
              </div>
            </div>

            {empty && (
              <div className="flex gap-3 rounded-control bg-warning-soft p-3 text-sm text-fg">
                <HugeiconsIcon icon={Alert02Icon} size={18} aria-hidden="true" className="mt-0.5 shrink-0 text-warning" />
                <p>Aucun droit : ce compte pourra se connecter, mais ne verra aucun espace.</p>
              </div>
            )}

            {delegable.map(group => (
              <section key={group.id} aria-labelledby={`rights-${group.id}`} className="space-y-3">
                <h3 id={`rights-${group.id}`} className="text-xs font-semibold uppercase tracking-wide text-fg-subtle">{group.label}</h3>
                <ul className="space-y-4">
                  {group.modules.map(module => {
                    const info = MODULE_INFO[module];
                    return (
                      <li key={module} className="space-y-2">
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-fg">{info.label}</p>
                          <p className="text-xs text-fg-muted">{info.description}</p>
                        </div>
                        <Segmented
                          label={`Accès à ${info.label}`}
                          value={draft[module] ?? 'none'}
                          onValueChange={level => setLevel(module, level)}
                          options={LEVELS}
                          size="lg"
                          fill
                        />
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))}
          </div>
        </SheetContent>
      )}
    </Dialog>
  );
}
