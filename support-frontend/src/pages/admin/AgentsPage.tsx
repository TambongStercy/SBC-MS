import { useEffect, useState, type FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { HugeiconsIcon } from '@hugeicons/react';
import {
  Alert02Icon, Globe02Icon, Link01Icon, Logout03Icon, MoreVerticalIcon, UserAdd01Icon, UserBlock01Icon, UserCheck01Icon, UserShield01Icon, UserSettings01Icon,
} from '@hugeicons/core-free-icons';
import { agentsApi } from '../../api/admin';
import { errorMessage } from '../../api/http';
import type { AgentAccount, AgentStatus } from '../../api/types';
import { useAgent } from '../../auth/context';
import { isReauthCancelled, useReauth } from '../../auth/reauth';
import { CopyButton } from '../../components/CopyButton';
import { ErrorState } from '../../components/display/ErrorState';
import { StatusBadge } from '../../components/display/labels';
import { ReasonDialog } from '../../components/ReasonDialog';
import { toast } from '../../components/toast';
import {
  Badge, Button, Checkbox, Dialog, DialogContent, EmptyState, Field, Input, Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger,
  PageHeader, Panel, ResponsiveList, type ListColumn,
} from '../../components/ui';
import { formatNumber, formatRelative } from '../../lib/format';
import { ROLE_LABEL, ROLES, roleLabel } from '../../lib/permissions';

const AGENT_STATUS: Record<AgentStatus, { label: string; tone: 'warning' | 'success' | 'neutral' }> = {
  pending_activation: { label: 'Activation en attente', tone: 'warning' },
  active: { label: 'Actif', tone: 'success' },
  disabled: { label: 'Désactivé', tone: 'neutral' },
};

/** Roles picked with checkboxes; at least one. */
function RolePicker({ value, onChange, lockedRoles = [] }: { value: string[]; onChange: (v: string[]) => void; lockedRoles?: string[] }) {
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-1.5 text-sm font-medium text-fg">Rôles</legend>
      {ROLES.map(r => {
        const locked = lockedRoles.includes(r);
        return (
          <label key={r} className="flex min-h-9 items-center gap-3 text-sm text-fg">
            <Checkbox
              checked={value.includes(r)}
              disabled={locked}
              onCheckedChange={c => onChange(c === true ? [...value, r] : value.filter(x => x !== r))}
              aria-label={ROLE_LABEL[r]}
            />
            <span>{ROLE_LABEL[r]}{locked && <span className="ml-1 text-xs text-fg-muted">(votre propre rôle d’administration)</span>}</span>
          </label>
        );
      })}
    </fieldset>
  );
}

/** The one-time activation link: shown once, kept only in this component's state. */
function ActivationLinkDialog({ link, agentName, onClose }: { link: string | null; agentName: string; onClose: () => void }) {
  return (
    <Dialog open={!!link} onOpenChange={o => { if (!o) onClose(); }}>
      {link && (
        <DialogContent
          title="Lien d’activation"
          description={`À transmettre à ${agentName} par un canal sûr.`}
          footer={<Button variant="primary" onClick={onClose}>J’ai transmis le lien</Button>}
        >
          <div className="flex flex-col gap-3">
            <div role="note" className="flex items-start gap-2 rounded-control border border-warning/30 bg-warning-soft px-3 py-2 text-sm text-fg">
              <HugeiconsIcon icon={Alert02Icon} size={16} className="mt-0.5 shrink-0 text-warning" aria-hidden="true" />
              <p>Ce lien ne sera plus jamais affiché et ne sert qu’une fois. Copiez-le maintenant. S’il se perd, générez-en un nouveau.</p>
            </div>
            <p className="break-all rounded-control border border-line bg-surface-2 px-3 py-2 font-mono text-xs text-fg" data-testid="activation-link">{link}</p>
            <CopyButton text={link} label="Copier le lien" className="self-start" />
          </div>
        </DialogContent>
      )}
    </Dialog>
  );
}

function CreateAgentDialog({ open, onOpenChange, onCreated }: { open: boolean; onOpenChange: (o: boolean) => void; onCreated: (agent: AgentAccount, link: string) => void }) {
  const reauth = useReauth();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [roles, setRoles] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (open) { setName(''); setEmail(''); setRoles([]); setError(''); } }, [open]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    if (name.trim().length < 2) { setError('Entrez le nom complet de l’agent.'); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) { setError('Entrez une adresse e-mail valide.'); return; }
    if (!roles.length) { setError('Choisissez au moins un rôle.'); return; }
    setBusy(true);
    try {
      const token = await reauth({ title: 'Créer le compte agent' });
      const r = await agentsApi.create({ name: name.trim(), email: email.trim().toLowerCase(), roles }, token);
      onOpenChange(false);
      onCreated(r.agent, r.activationUrl);
    } catch (err) {
      if (!isReauthCancelled(err)) setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title="Nouvel agent" description="Un compte par personne : les comptes partagés sont interdits. L’agent choisira son mot de passe avec le lien d’activation.">
        <form onSubmit={submit} className="flex flex-col gap-4">
          <Field label="Nom complet" required>
            <Input value={name} onChange={e => setName(e.target.value)} autoComplete="off" />
          </Field>
          <Field label="E-mail" required>
            <Input type="email" value={email} onChange={e => setEmail(e.target.value)} autoComplete="off" />
          </Field>
          <RolePicker value={roles} onChange={setRoles} />
          {error && <p role="alert" className="text-sm text-danger">{error}</p>}
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Annuler</Button>
            <Button type="submit" variant="primary" loading={busy}>Créer le compte</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function RolesDialog({ target, isMe, onClose, onSaved }: { target: AgentAccount | null; isMe: boolean; onClose: () => void; onSaved: () => void }) {
  const reauth = useReauth();
  const [roles, setRoles] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (target) { setRoles(target.roles); setError(''); } }, [target]);

  const save = async () => {
    if (!target) return;
    if (!roles.length) { setError('Choisissez au moins un rôle.'); return; }
    setBusy(true);
    setError('');
    try {
      const token = await reauth({ title: `Changer les rôles de ${target.name}` });
      await agentsApi.setRoles(target.id, roles, token);
      toast.success('Rôles mis à jour.');
      onSaved();
      onClose();
    } catch (err) {
      if (!isReauthCancelled(err)) setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={!!target} onOpenChange={o => { if (!o) onClose(); }}>
      {target && (
        <DialogContent
          title={`Rôles de ${target.name}`}
          description="Chaque rôle donne un ensemble de permissions (moindre privilège)."
          footer={<>
            <Button variant="ghost" onClick={onClose}>Annuler</Button>
            <Button variant="primary" onClick={save} loading={busy}>Enregistrer</Button>
          </>}
        >
          <RolePicker value={roles} onChange={setRoles} lockedRoles={isMe ? ['support_admin'] : []} />
          {error && <p role="alert" className="mt-3 text-sm text-danger">{error}</p>}
        </DialogContent>
      )}
    </Dialog>
  );
}

/** Country team: codes typed as "CM, BJ"; empty = every country. */
export function parseCountries(text: string): string[] | null {
  const list = [...new Set(text.split(/[\s,;]+/).map(c => c.trim().toUpperCase()).filter(Boolean))];
  return list.every(c => /^[A-Z]{2}$/.test(c)) ? list : null;
}

function CountriesDialog({ target, onClose, onSaved }: { target: AgentAccount | null; onClose: () => void; onSaved: () => void }) {
  const reauth = useReauth();
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (target) { setText((target.countries ?? []).join(', ')); setError(''); } }, [target]);

  const save = async () => {
    if (!target) return;
    const countries = parseCountries(text);
    if (!countries) { setError('Codes pays à deux lettres, séparés par des virgules (CM, BJ).'); return; }
    setBusy(true);
    setError('');
    try {
      const token = await reauth({ title: `Changer les pays de ${target.name}` });
      await agentsApi.setCountries(target.id, countries, token);
      toast.success('Pays mis à jour.');
      onSaved();
      onClose();
    } catch (err) {
      if (!isReauthCancelled(err)) setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={!!target} onOpenChange={o => { if (!o) onClose(); }}>
      {target && (
        <DialogContent
          title={`Pays de ${target.name}`}
          description="L’agent ne voit l’activité que de ces pays. Laissez vide pour tous les pays."
          footer={<>
            <Button variant="ghost" onClick={onClose}>Annuler</Button>
            <Button variant="primary" onClick={save} loading={busy}>Enregistrer</Button>
          </>}
        >
          <Field label="Codes pays" help="Exemple : CM, BJ, CI">
            <Input value={text} onChange={e => setText(e.target.value)} placeholder="Tous les pays" autoCapitalize="characters" />
          </Field>
          {error && <p role="alert" className="mt-3 text-sm text-danger">{error}</p>}
        </DialogContent>
      )}
    </Dialog>
  );
}

/** The agent's own SBC member account: they will never act on it or its referral tree (Phase 5). */
function MemberAccountDialog({ target, onClose, onSaved }: { target: AgentAccount | null; onClose: () => void; onSaved: () => void }) {
  const reauth = useReauth();
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (target) { setText(target.memberUserId ?? ''); setError(''); } }, [target]);

  const save = async () => {
    if (!target) return;
    const v = text.trim();
    if (v && !/^[a-f0-9]{24}$/i.test(v)) { setError('Identifiant de membre à 24 caractères (fiche membre → Identifiant).'); return; }
    setBusy(true);
    setError('');
    try {
      const token = await reauth({ title: `Compte membre de ${target.name}` });
      await agentsApi.setMemberAccount(target.id, v || null, token);
      toast.success('Compte membre enregistré.');
      onSaved();
      onClose();
    } catch (err) {
      if (!isReauthCancelled(err)) setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={!!target} onOpenChange={o => { if (!o) onClose(); }}>
      {target && (
        <DialogContent
          title={`Compte membre de ${target.name}`}
          description="Si cet agent a un compte SBC, indiquez-le : il ne pourra jamais demander, valider ni traiter quoi que ce soit sur ce compte ou son parrainage. Laissez vide s’il n’en a pas."
          footer={<>
            <Button variant="ghost" onClick={onClose}>Annuler</Button>
            <Button variant="primary" onClick={save} loading={busy}>Enregistrer</Button>
          </>}
        >
          <Field label="Identifiant du membre" help="Sur la fiche du membre, rubrique « Identifiant ».">
            <Input value={text} onChange={e => setText(e.target.value)} placeholder="Aucun compte membre" className="font-mono" />
          </Field>
          {error && <p role="alert" className="mt-3 text-sm text-danger">{error}</p>}
        </DialogContent>
      )}
    </Dialog>
  );
}

type Pending = { kind: 'disable' | 'revoke'; agent: AgentAccount } | null;

/** Agent accounts: create (activation link shown once), roles, disable, sessions. */
export default function AgentsPage() {
  const me = useAgent();
  const reauth = useReauth();
  const queryClient = useQueryClient();
  const agents = useQuery({ queryKey: ['agents'], queryFn: agentsApi.list });
  const [createOpen, setCreateOpen] = useState(false);
  const [link, setLink] = useState<{ url: string; name: string } | null>(null);
  const [rolesFor, setRolesFor] = useState<AgentAccount | null>(null);
  const [countriesFor, setCountriesFor] = useState<AgentAccount | null>(null);
  const [memberFor, setMemberFor] = useState<AgentAccount | null>(null);
  const [pending, setPending] = useState<Pending>(null);

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['agents'] });

  const run = async (title: string, fn: (token: string) => Promise<unknown>, success: string) => {
    try {
      const token = await reauth({ title });
      await fn(token);
      toast.success(success);
      void refresh();
    } catch (err) {
      if (!isReauthCancelled(err)) toast.error(errorMessage(err));
    }
  };

  const newLink = async (a: AgentAccount) => {
    try {
      const token = await reauth({ title: `Nouveau lien pour ${a.name}` });
      const r = await agentsApi.newActivationLink(a.id, token);
      setLink({ url: r.activationUrl, name: a.name });
    } catch (err) {
      if (!isReauthCancelled(err)) toast.error(errorMessage(err));
    }
  };

  const actions = (a: AgentAccount) => {
    const isMe = a.id === me.id;
    return (
      <Menu>
        <MenuTrigger asChild>
          <Button variant="ghost" size="icon-sm" aria-label={`Actions pour ${a.name}`} onClick={e => e.stopPropagation()}>
            <HugeiconsIcon icon={MoreVerticalIcon} size={16} aria-hidden="true" />
          </Button>
        </MenuTrigger>
        <MenuContent>
          <MenuItem onSelect={() => setRolesFor(a)}>
            <HugeiconsIcon icon={UserSettings01Icon} size={16} aria-hidden="true" /> Changer les rôles
          </MenuItem>
          <MenuItem onSelect={() => setCountriesFor(a)}>
            <HugeiconsIcon icon={Globe02Icon} size={16} aria-hidden="true" /> Pays suivis
          </MenuItem>
          <MenuItem onSelect={() => setMemberFor(a)}>
            <HugeiconsIcon icon={UserShield01Icon} size={16} aria-hidden="true" /> Compte membre lié
          </MenuItem>
          {a.status === 'pending_activation' && (
            <MenuItem onSelect={() => void newLink(a)}>
              <HugeiconsIcon icon={Link01Icon} size={16} aria-hidden="true" /> Nouveau lien d’activation
            </MenuItem>
          )}
          <MenuItem disabled={a.activeSessions === 0} onSelect={() => setPending({ kind: 'revoke', agent: a })}>
            <HugeiconsIcon icon={Logout03Icon} size={16} aria-hidden="true" /> Fermer ses sessions
          </MenuItem>
          <MenuSeparator />
          {a.status === 'disabled' ? (
            <MenuItem onSelect={() => void run(`Réactiver ${a.name}`, t => agentsApi.enable(a.id, t), 'Compte réactivé.')}>
              <HugeiconsIcon icon={UserCheck01Icon} size={16} aria-hidden="true" /> Réactiver
            </MenuItem>
          ) : (
            <MenuItem destructive disabled={isMe} onSelect={() => setPending({ kind: 'disable', agent: a })}>
              <HugeiconsIcon icon={UserBlock01Icon} size={16} aria-hidden="true" />
              {isMe ? 'Désactiver (impossible sur votre compte)' : 'Désactiver'}
            </MenuItem>
          )}
        </MenuContent>
      </Menu>
    );
  };

  const columns: ListColumn<AgentAccount>[] = [
    {
      key: 'name', header: 'Agent',
      cell: a => (
        <div className="flex min-w-0 items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate font-medium text-fg">{a.name}{a.id === me.id && <span className="ml-1.5 text-xs font-normal text-fg-muted">(vous)</span>}</p>
            <p className="truncate text-xs text-fg-muted">{a.email}</p>
          </div>
          <div className="md:hidden">{actions(a)}</div>
        </div>
      ),
    },
    { key: 'roles', header: 'Rôles', cell: a => <div className="flex flex-wrap justify-end gap-1 md:justify-start">{a.roles.map(r => <Badge key={r} tone="outline">{roleLabel(r)}</Badge>)}</div> },
    { key: 'countries', header: 'Pays', cell: a => (a.countries?.length ? a.countries.join(', ') : <span className="text-fg-muted">Tous</span>) },
    { key: 'status', header: 'Statut', cell: a => <StatusBadge map={AGENT_STATUS} value={a.status} /> },
    { key: 'totp', header: 'Application 2FA', cell: a => (a.totpEnrolled ? <Badge tone="success">Configurée</Badge> : <Badge tone="warning">Pas encore</Badge>) },
    { key: 'login', header: 'Dernière connexion', cell: a => (a.lastLoginAt ? formatRelative(a.lastLoginAt) : 'Jamais') },
    { key: 'sessions', header: 'Sessions', numeric: true, cell: a => formatNumber(a.activeSessions) },
    { key: 'actions', header: <span className="sr-only">Actions</span>, hideOnCard: true, className: 'w-12', cell: a => actions(a) },
  ];

  return (
    <>
      <PageHeader
        title="Agents"
        description="Comptes du support. Chaque compte est créé ici et activé par un lien à usage unique."
        actions={<Button variant="primary" onClick={() => setCreateOpen(true)}><HugeiconsIcon icon={UserAdd01Icon} size={16} aria-hidden="true" /> Nouvel agent</Button>}
      />
      <Panel>
        {agents.isError ? (
          <ErrorState error={agents.error} onRetry={() => agents.refetch()} retrying={agents.isFetching} />
        ) : (
          <ResponsiveList
            rows={agents.data ?? []}
            columns={columns}
            rowKey={a => a.id}
            loading={agents.isLoading}
            empty={<EmptyState icon={UserShield01Icon} title="Aucun agent" description="Créez le premier compte agent." />}
          />
        )}
      </Panel>

      <CreateAgentDialog open={createOpen} onOpenChange={setCreateOpen} onCreated={(a, url) => { setLink({ url, name: a.name }); void refresh(); }} />
      <ActivationLinkDialog link={link?.url ?? null} agentName={link?.name ?? ''} onClose={() => setLink(null)} />
      <MemberAccountDialog target={memberFor} onClose={() => setMemberFor(null)} onSaved={() => void refresh()} />
      <CountriesDialog target={countriesFor} onClose={() => setCountriesFor(null)} onSaved={() => void refresh()} />
      <RolesDialog target={rolesFor} isMe={rolesFor?.id === me.id} onClose={() => setRolesFor(null)} onSaved={() => void refresh()} />

      <ReasonDialog
        open={pending?.kind === 'disable'}
        onOpenChange={o => { if (!o) setPending(null); }}
        title={`Désactiver ${pending?.agent.name ?? ''}`}
        description="L’agent ne pourra plus se connecter et ses sessions sont fermées. Le compte reste dans le journal."
        confirmLabel="Désactiver"
        tone="danger"
        onConfirm={async reason => {
          const a = pending!.agent;
          const token = await reauth({ title: `Désactiver ${a.name}` });
          await agentsApi.disable(a.id, reason, token);
          toast.success('Compte désactivé.');
          void refresh();
        }}
      />
      <Dialog open={pending?.kind === 'revoke'} onOpenChange={o => { if (!o) setPending(null); }}>
        {pending?.kind === 'revoke' && (
          <DialogContent
            size="sm"
            title={`Fermer les sessions de ${pending.agent.name}`}
            description="Toutes ses connexions en cours sont fermées ; il devra se reconnecter avec son code."
            footer={<>
              <Button variant="ghost" onClick={() => setPending(null)}>Annuler</Button>
              <Button variant="danger" onClick={() => {
                const a = pending.agent;
                setPending(null);
                void run(`Fermer les sessions de ${a.name}`, t => agentsApi.revokeSessions(a.id, t), 'Sessions fermées.');
              }}>Fermer les sessions</Button>
            </>}
          />
        )}
      </Dialog>
    </>
  );
}

