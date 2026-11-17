import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { HugeiconsIcon } from '@hugeicons/react';
import {
  Cancel01Icon, CheckmarkCircle02Icon, Edit02Icon, InformationCircleIcon, RefreshIcon, UserAdd01Icon, UserRemove01Icon, UserShield01Icon,
} from '@hugeicons/core-free-icons';
import { getAvatarUrl } from '../api/apiClient';
import { apiErrorMessage, listStaff, revokeStaff, setStaffAccess, type StaffMember } from '../services/adminStaffApi';
import type { AdminUserData } from '../services/adminUserApi';
import { summarizePermissions, type Permissions } from '../lib/permissions';
import { ROLE_LABEL } from '../lib/roles';
import {
  Avatar, Badge, Button, Dialog, DialogClose, DialogContent, EmptyState, PageHeader, Panel, PanelBody, PanelHeader, ResponsiveList,
  type ListColumn,
} from '../components/ui';
import { AddMemberSheet } from '../components/team/AddMemberSheet';
import { CopyIdButton } from '../components/team/CopyIdButton';
import { RightsEditorSheet, type RightsTarget } from '../components/team/RightsEditorSheet';

const STAFF_KEY = ['admin-staff'] as const;

const ROLE_TONE: Record<string, 'primary' | 'info' | 'warning' | 'neutral'> = {
  admin: 'primary',
  staff: 'info',
  withdrawal_admin: 'warning',
  moderator: 'warning',
};

function RoleBadge({ role }: { role: string }) {
  return <Badge tone={ROLE_TONE[role] ?? 'neutral'}>{ROLE_LABEL[role] ?? role}</Badge>;
}

const rightsSummary = (m: StaffMember) => (m.role === 'admin' ? 'Tous les droits' : summarizePermissions(m.permissions));

function Identity({ member }: { member: StaffMember }) {
  return (
    <div className="flex min-w-0 items-center gap-3">
      <Avatar src={getAvatarUrl(member.avatar)} name={member.name || member.email || '?'} size="sm" />
      <div className="min-w-0">
        <p className="truncate text-sm font-medium text-fg">{member.name || 'Sans nom'}</p>
        <p className="truncate text-xs text-fg-muted">{member.email}</p>
      </div>
    </div>
  );
}

/**
 * Équipe (super admin only, module `staff`): who can open the admin, and
 * what each staff account may do per module (none / read / write).
 * Server: user-service admin-access.controller (GET/PUT/DELETE /users/admin/staff).
 */
export default function TeamPage() {
  const queryClient = useQueryClient();
  const staffQuery = useQuery({ queryKey: STAFF_KEY, queryFn: listStaff });
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<RightsTarget | null>(null);
  const [removing, setRemoving] = useState<StaffMember | null>(null);
  const [saved, setSaved] = useState<{ id: string; name: string } | null>(null);

  const staff = useMemo(() => staffQuery.data?.staff ?? [], [staffQuery.data]);
  const teamIds = useMemo(() => new Set(staff.map(m => m._id)), [staff]);

  const save = useMutation({
    mutationFn: ({ id, permissions }: { id: string; permissions: Permissions }) => setStaffAccess(id, permissions),
    onSuccess: member => {
      toast.success(`Droits enregistrés pour ${member.name || member.email}.`);
      setSaved({ id: member._id, name: member.name || member.email });
      setEditing(null);
      void queryClient.invalidateQueries({ queryKey: STAFF_KEY });
    },
    onError: error => toast.error(apiErrorMessage(error, 'Impossible d’enregistrer les droits.')),
  });

  const revoke = useMutation({
    mutationFn: (member: StaffMember) => revokeStaff(member._id),
    onSuccess: (_, member) => {
      toast.success(`${member.name || member.email} n’a plus accès à l’administration.`);
      setRemoving(null);
      if (saved?.id === member._id) setSaved(null);
      void queryClient.invalidateQueries({ queryKey: STAFF_KEY });
    },
    onError: error => toast.error(apiErrorMessage(error, 'Impossible de retirer l’accès.')),
  });

  const edit = (m: StaffMember) => setEditing({ _id: m._id, name: m.name, email: m.email, avatar: m.avatar, role: m.role, permissions: m.permissions });

  const pick = (member: AdminUserData) => {
    const existing = staff.find(m => m._id === member._id);
    setAdding(false);
    if (existing) {
      edit(existing);
      return;
    }
    setEditing({ _id: member._id, name: member.name, email: member.email, avatar: member.avatar, role: member.role ?? 'user', permissions: {} });
  };

  const actions = (m: StaffMember, phone = false) => {
    if (m.role === 'admin') {
      return <span className="text-xs text-fg-subtle">Non modifiable ici</span>;
    }
    const size = phone ? 'lg' : 'sm';
    return (
      <div className={phone ? 'grid grid-cols-1 gap-2' : 'flex justify-end gap-1'}>
        <Button variant={phone ? 'outline' : 'ghost'} size={size} onClick={() => edit(m)}>
          <HugeiconsIcon icon={Edit02Icon} size={16} aria-hidden="true" />
          {m.role === 'staff' ? 'Modifier les droits' : 'Passer en Équipe'}
        </Button>
        <Button variant="danger-ghost" size={size} onClick={() => setRemoving(m)}>
          <HugeiconsIcon icon={UserRemove01Icon} size={16} aria-hidden="true" />
          Retirer l’accès
        </Button>
      </div>
    );
  };

  const columns: ListColumn<StaffMember>[] = [
    { key: 'member', header: 'Membre', cell: m => <Identity member={m} /> },
    { key: 'role', header: 'Rôle', cell: m => <RoleBadge role={m.role} /> },
    { key: 'rights', header: 'Droits', cell: m => <span className="text-sm text-fg">{rightsSummary(m)}</span> },
    { key: 'state', header: 'État', cell: m => (m.blocked ? <Badge tone="danger">Bloqué</Badge> : <Badge tone="success">Actif</Badge>) },
    { key: 'actions', header: <span className="sr-only">Actions</span>, cell: m => actions(m), className: 'text-right', hideOnCard: true },
  ];

  const card = (m: StaffMember) => (
    <div className="space-y-3">
      <Identity member={m} />
      <div className="flex flex-wrap items-center gap-2">
        <RoleBadge role={m.role} />
        {m.blocked && <Badge tone="danger">Bloqué</Badge>}
        <span className="text-sm text-fg-muted">{rightsSummary(m)}</span>
      </div>
      {actions(m, true)}
    </div>
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Équipe"
        description="Qui peut ouvrir l’administration, et ce que chacun peut y faire, espace par espace."
        className="mb-0"
        actions={(
          <Button variant="primary" size="lg" className="w-full sm:w-auto" onClick={() => setAdding(true)}>
            <HugeiconsIcon icon={UserAdd01Icon} size={18} aria-hidden="true" />
            Ajouter un membre de l’équipe
          </Button>
        )}
      />

      {saved && (
        <Panel className="border-success/40 bg-success-soft/40" role="status">
          <div className="flex items-start gap-3 px-4 pt-4 sm:px-5">
            <HugeiconsIcon icon={CheckmarkCircle02Icon} size={20} aria-hidden="true" className="mt-0.5 shrink-0 text-success" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-fg">Droits enregistrés pour {saved.name}</p>
              <p className="mt-0.5 text-sm text-fg-muted">
                Pour qu’il puisse se connecter, envoyez cet identifiant à l’équipe technique : il doit être ajouté à ADMIN_ALLOWLIST.
              </p>
            </div>
            <Button variant="ghost" size="icon" className="-mr-2 -mt-1 h-11 w-11 shrink-0" aria-label="Masquer" onClick={() => setSaved(null)}>
              <HugeiconsIcon icon={Cancel01Icon} size={18} aria-hidden="true" />
            </Button>
          </div>
          <div className="px-4 pb-4 pt-3 sm:px-5">
            <CopyIdButton value={saved.id} />
          </div>
        </Panel>
      )}

      <Panel>
        <PanelHeader
          title="Comptes de l’administration"
          description={staffQuery.data ? `${staff.length} compte${staff.length > 1 ? 's' : ''}` : undefined}
        />
        <ResponsiveList
          rows={staff}
          columns={columns}
          rowKey={m => m._id}
          card={card}
          loading={staffQuery.isLoading}
          empty={staffQuery.isError ? (
            <EmptyState
              icon={RefreshIcon}
              title="La liste n’a pas pu être chargée"
              description={apiErrorMessage(staffQuery.error, 'Vérifiez la connexion, puis réessayez.')}
              action={<Button size="lg" onClick={() => void staffQuery.refetch()} loading={staffQuery.isFetching}>Réessayer</Button>}
            />
          ) : (
            <EmptyState
              icon={UserShield01Icon}
              title="Personne dans l’équipe"
              description="Ajoutez un membre et choisissez ce qu’il peut faire."
            />
          )}
        />
      </Panel>

      <Panel>
        <PanelHeader
          title={(
            <span className="flex items-center gap-2">
              <HugeiconsIcon icon={InformationCircleIcon} size={18} aria-hidden="true" className="text-info" />
              Avant la première connexion
            </span>
          )}
        />
        <PanelBody className="space-y-2 text-sm text-fg-muted">
          <p>
            Un compte de l’équipe ne peut se connecter que si son identifiant figure dans <strong className="font-medium text-fg">ADMIN_ALLOWLIST</strong>,
            la liste des comptes autorisés de la passerelle. Elle est réglée sur le serveur par l’équipe technique.
          </p>
          <p>
            Après avoir enregistré ses droits, copiez son identifiant et envoyez-le à l’équipe technique.
            Un retrait de droit s’applique en moins d’une minute.
          </p>
        </PanelBody>
      </Panel>

      <AddMemberSheet open={adding} onOpenChange={setAdding} onPick={pick} teamIds={teamIds} />

      <RightsEditorSheet
        target={editing}
        modules={staffQuery.data?.modules}
        saving={save.isPending}
        onSave={permissions => editing && save.mutate({ id: editing._id, permissions })}
        onOpenChange={open => { if (!open) setEditing(null); }}
      />

      <Dialog open={!!removing} onOpenChange={open => { if (!open && !revoke.isPending) setRemoving(null); }}>
        {removing && (
          <DialogContent
            size="sm"
            title="Retirer l’accès ?"
            description={`${removing.name || removing.email} redevient un simple membre et ne peut plus ouvrir l’administration (en moins d’une minute).`}
            footer={(
              <>
                <DialogClose asChild>
                  <Button variant="outline" size="lg" disabled={revoke.isPending}>Annuler</Button>
                </DialogClose>
                <Button variant="danger" size="lg" loading={revoke.isPending} onClick={() => revoke.mutate(removing)}>
                  Retirer l’accès
                </Button>
              </>
            )}
          >
            <p className="text-sm text-fg-muted">Pensez aussi à demander le retrait de son identifiant d’ADMIN_ALLOWLIST.</p>
          </DialogContent>
        )}
      </Dialog>
    </div>
  );
}
