import { useState, type FormEvent, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { HugeiconsIcon } from '@hugeicons/react';
import { ArrowLeft01Icon, LockIcon, Mail01Icon, PencilEdit01Icon, SmartPhone01Icon } from '@hugeicons/core-free-icons';
import { ApiError, errorMessage } from '../../api/http';
import { membersApi } from '../../api/members';
import type { MemberWithdrawal, Payin, SupportMember, Ticket } from '../../api/types';
import { usePermissions } from '../../auth/context';
import { isReauthCancelled, useReauth } from '../../auth/reauth';
import { CopyButton } from '../../components/CopyButton';
import { ErrorState } from '../../components/display/ErrorState';
import { BUSINESS_STATUS, StatusBadge, TICKET_STATUS } from '../../components/display/labels';
import { toast } from '../../components/toast';
import {
  Badge, Button, Dialog, DialogContent, EmptyState, Field, Input, Metric, Panel, PanelBody, PanelHeader, ResponsiveList, Segmented, Skeleton,
  Tabs, TabsContent, TabsList, TabsTrigger, Textarea, type ListColumn,
} from '../../components/ui';
import { formatDate, formatDateTime, formatMoney, formatRelative } from '../../lib/format';
import { MemberSecurityPanel } from './MemberSecurityPanel';
import { MemberSessionsPanel } from './MemberSessionsPanel';
import { MemberRiskPanel } from './MemberRiskPanel';

/** A member's record (masked per role), with payments, withdrawals and tickets. */
export default function MemberDetailPage() {
  const { id = '' } = useParams();
  const perms = usePermissions();
  const [contactOpen, setContactOpen] = useState(false);
  const q = useQuery({ queryKey: ['members', 'detail', id], queryFn: () => membersApi.get(id) });

  if (q.isLoading) {
    return (
      <div className="space-y-4" aria-busy="true">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }
  if (q.isError || !q.data) return <ErrorState error={q.error} onRetry={() => q.refetch()} retrying={q.isFetching} />;

  const m = q.data.member;
  const masked = m.masked === true || !perms.has('members.read.full');
  const lockedUntil = m.withdrawalLockedUntil && new Date(m.withdrawalLockedUntil).getTime() > Date.now() ? m.withdrawalLockedUntil : null;
  const canRequestContact = perms.has('members.contact.request');

  return (
    <>
      <Link to="/membres" className="mb-3 inline-flex items-center gap-1.5 text-sm text-fg-muted hover:text-fg">
        <HugeiconsIcon icon={ArrowLeft01Icon} size={16} aria-hidden="true" /> Membres
      </Link>
      <header className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <h1 className="break-words text-2xl font-semibold tracking-tight text-fg">{m.name}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {m.isVerified ? <Badge tone="success">Compte vérifié</Badge> : <Badge tone="neutral">Non vérifié</Badge>}
            {m.blocked && <Badge tone="danger">Bloqué</Badge>}
            {m.deleted && <Badge tone="danger">Supprimé</Badge>}
            {m.frozen && <Badge tone="danger"><HugeiconsIcon icon={LockIcon} size={12} aria-hidden="true" /> Argent gelé</Badge>}
            {lockedUntil && <Badge tone="warning"><HugeiconsIcon icon={LockIcon} size={12} aria-hidden="true" /> Retraits bloqués jusqu’au {formatDateTime(lockedUntil)}</Badge>}
            {m.role && <Badge tone="outline">{m.role}</Badge>}
          </div>
        </div>
        {canRequestContact && (
          <Button variant="outline" onClick={() => setContactOpen(true)}>
            <HugeiconsIcon icon={PencilEdit01Icon} size={16} aria-hidden="true" /> Demander un changement de contact
          </Button>
        )}
      </header>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Panel>
          <PanelHeader
            title="Identité"
            actions={masked ? (
              <Badge tone="info"><HugeiconsIcon icon={LockIcon} size={12} aria-hidden="true" /> Masqué selon votre rôle</Badge>
            ) : undefined}
          />
          <PanelBody>
            <dl className="grid grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
              {/* Contact values are shown exactly as the server sends them (masked or not). */}
              <Item label="E-mail" icon={Mail01Icon}><span data-testid="member-email" className="break-all">{m.email || '—'}</span></Item>
              <Item label="Téléphone" icon={SmartPhone01Icon}><span data-testid="member-phone" className="break-all">{m.phoneNumber || '—'}</span></Item>
              <Item label="Pays / ville">{[m.country, m.city].filter(Boolean).join(' · ') || '—'}</Item>
              <Item label="Langue">{m.language ?? '—'}</Item>
              <Item label="Inscrit le">{formatDate(m.createdAt)}</Item>
              <Item label="Dernière connexion">{m.lastLogin ? formatRelative(m.lastLogin) : '—'}</Item>
              <Item label="Parrain">{m.referrerName ?? (m.referrerId ? <span className="font-mono text-xs">{m.referrerId}</span> : '—')}</Item>
              <Item label="Identifiant">
                <span className="flex items-center gap-2"><span className="break-all font-mono text-xs">{m._id}</span><CopyButton text={m._id} label="Copier" variant="ghost" /></span>
              </Item>
            </dl>
          </PanelBody>
        </Panel>

        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-3">
            <Metric label="Solde" value={formatMoney(m.balance)} />
            <Metric label="Solde USD" value={formatMoney(m.usdBalance, 'USD')} />
            <Metric label="Montant réservé" value={formatMoney(m.reservedBalance)} hint="Retraits en cours" />
            <Metric label="Dette" value={formatMoney(m.debt)} tone={m.debt ? 'warning' : 'neutral'} />
          </div>
          <Subscriptions member={m} />
        </div>
      </div>

      <div className="mt-4"><MemberSecurityPanel member={m} /></div>
      {perms.has('risk.read') && <div className="mt-4"><MemberRiskPanel memberId={m._id} /></div>}
      {perms.has('replay.read') && <div className="mt-4"><MemberSessionsPanel memberId={m._id} /></div>}

      <Tabs defaultValue="payins" className="mt-6">
        <TabsList aria-label="Historique du membre">
          <TabsTrigger value="payins">Paiements</TabsTrigger>
          <TabsTrigger value="withdrawals">Retraits</TabsTrigger>
          <TabsTrigger value="tickets">Tickets</TabsTrigger>
        </TabsList>
        {/* Radix mounts only the open tab, so each list loads when it is opened. */}
        <TabsContent value="payins" className="mt-4"><PayinsTab id={m._id} /></TabsContent>
        <TabsContent value="withdrawals" className="mt-4"><WithdrawalsTab id={m._id} /></TabsContent>
        <TabsContent value="tickets" className="mt-4"><TicketsTab id={m._id} /></TabsContent>
      </Tabs>

      {canRequestContact && <ContactChangeDialog open={contactOpen} onOpenChange={setContactOpen} member={m} />}
    </>
  );
}

function Item({ label, icon, children }: { label: string; icon?: typeof Mail01Icon; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <dt className="flex items-center gap-1.5 text-xs text-fg-muted">{icon && <HugeiconsIcon icon={icon} size={12} aria-hidden="true" />}{label}</dt>
      <dd className="min-w-0 text-fg">{children}</dd>
    </div>
  );
}

function Subscriptions({ member }: { member: SupportMember }) {
  const subs = member.subscriptions ?? [];
  return (
    <Panel>
      <PanelHeader title="Abonnements" />
      <PanelBody>
        {subs.length === 0 ? <p className="text-sm text-fg-muted">Aucun abonnement.</p> : (
          <ul className="divide-y divide-line">
            {subs.map((s, i) => (
              <li key={`${s.type}-${i}`} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                <span className="font-medium text-fg">{s.type}{s.category ? <span className="ml-1 text-fg-muted">· {s.category}</span> : null}</span>
                <span className="flex items-center gap-2">
                  <Badge tone={s.status?.toLowerCase() === 'active' ? 'success' : 'neutral'}>{s.status}</Badge>
                  <span className="text-xs text-fg-muted">{s.endDate ? `jusqu’au ${formatDate(s.endDate)}` : 'à vie'}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </PanelBody>
    </Panel>
  );
}

function TabList<T>({ q, columns, rowKey, emptyTitle, onRowClick }: {
  q: { data?: T[]; isLoading: boolean; isError: boolean; error: unknown; refetch: () => unknown; isFetching: boolean };
  columns: ListColumn<T>[];
  rowKey: (r: T) => string;
  emptyTitle: string;
  onRowClick?: (r: T) => void;
}) {
  return (
    <Panel>
      {q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} retrying={q.isFetching} /> : (
        <ResponsiveList rows={q.data ?? []} columns={columns} rowKey={rowKey} loading={q.isLoading} onRowClick={onRowClick} empty={<EmptyState title={emptyTitle} />} />
      )}
    </Panel>
  );
}

const FAILURE_GROUP: Record<string, { label: string; tone: 'danger' | 'warning' | 'neutral' | 'info' }> = {
  sbc_code: { label: 'Code SBC', tone: 'danger' },
  provider_api: { label: 'Prestataire', tone: 'warning' },
  member: { label: 'Côté membre', tone: 'neutral' },
  unknown: { label: 'Inconnue', tone: 'info' },
};

/** Why a payment did not finish, as recorded by payment-service (same groups as the admin « Paiements » page). */
function PayinReason({ p }: { p: Payin }) {
  if (!p.failure) return <span className="text-fg-muted">—</span>;
  const g = FAILURE_GROUP[p.failure.group] ?? FAILURE_GROUP.unknown;
  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-center gap-1">
        <Badge tone={g.tone}>{g.label}</Badge>
        <span className="font-mono text-xs">{p.failure.code}</span>
      </div>
      {p.failure.message && <div className="max-w-xs text-xs text-fg-muted">{p.failure.message}</div>}
      {!!p.earlierFailures && <div className="text-xs text-fg-muted">{p.earlierFailures} tentative(s) échouée(s) avant</div>}
    </div>
  );
}

function PayinsTab({ id }: { id: string }) {
  const q = useQuery({ queryKey: ['members', id, 'payins'], queryFn: () => membersApi.payins(id) });
  const columns: ListColumn<Payin>[] = [
    { key: 'purpose', header: 'Objet', cell: p => <span className="font-medium">{p.purpose ?? 'Paiement'}</span> },
    { key: 'amount', header: 'Montant', numeric: true, cell: p => formatMoney(p.amount, p.currency) },
    { key: 'gateway', header: 'Prestataire', cell: p => p.gateway },
    { key: 'status', header: 'Statut', cell: p => <Badge tone={/succe|complet|confirm/i.test(p.status) ? 'success' : /fail|cancel|expir/i.test(p.status) ? 'danger' : 'neutral'}>{p.status}</Badge> },
    { key: 'reason', header: 'Raison', cell: p => <PayinReason p={p} /> },
    { key: 'session', header: 'Session', cell: p => <span className="break-all font-mono text-xs text-fg-muted">{p.sessionId}</span> },
    { key: 'date', header: 'Date', cell: p => formatDateTime(p.createdAt) },
  ];
  return <TabList q={q} columns={columns} rowKey={p => p.sessionId} emptyTitle="Aucun paiement récent" />;
}

function WithdrawalsTab({ id }: { id: string }) {
  const q = useQuery({ queryKey: ['members', id, 'withdrawals'], queryFn: () => membersApi.withdrawals(id) });
  const columns: ListColumn<MemberWithdrawal>[] = [
    { key: 'amount', header: 'Montant', cell: w => <span className="font-medium tabular-nums">{formatMoney(w.amount, w.currency)}</span> },
    { key: 'status', header: 'Statut', cell: w => <StatusBadge map={BUSINESS_STATUS} value={w.businessStatus} /> },
    { key: 'method', header: 'Moyen', cell: w => w.method ?? '—' },
    { key: 'tx', header: 'Transaction', cell: w => <span className="break-all font-mono text-xs text-fg-muted">{w.transactionId}</span> },
    { key: 'date', header: 'Demandé le', cell: w => formatDateTime(w.createdAt) },
  ];
  return <TabList q={q} columns={columns} rowKey={w => w.transactionId} emptyTitle="Aucun retrait récent" />;
}

function TicketsTab({ id }: { id: string }) {
  const navigate = useNavigate();
  const perms = usePermissions();
  const q = useQuery({ queryKey: ['members', id, 'tickets'], queryFn: () => membersApi.tickets(id) });
  const columns: ListColumn<Ticket>[] = [
    { key: 'subject', header: 'Ticket', cell: t => <span><span className="font-medium">{t.subject}</span> <span className="font-mono text-xs text-fg-muted">{t.number}</span></span> },
    { key: 'status', header: 'Statut', cell: t => <StatusBadge map={TICKET_STATUS} value={t.status} /> },
    { key: 'date', header: 'Ouvert', cell: t => formatRelative(t.createdAt) },
  ];
  return (
    <TabList q={q} columns={columns} rowKey={t => t.id} emptyTitle="Aucun ticket"
      onRowClick={perms.has('tickets.read') ? t => navigate(`/tickets/${encodeURIComponent(t.id)}`) : undefined} />
  );
}

type ContactField = 'email' | 'phoneNumber' | 'momo';

/**
 * Contact change for a member who lost access to their account: a request
 * that needs a reauth code now and a second agent's approval later. After
 * approval, a code goes to the NEW contact before anything changes.
 */
function ContactChangeDialog({ open, onOpenChange, member }: { open: boolean; onOpenChange: (o: boolean) => void; member: SupportMember }) {
  const reauth = useReauth();
  const [field, setField] = useState<ContactField>('email');
  const [value, setValue] = useState('');
  const [operator, setOperator] = useState(member.momoOperator ?? '');
  const [reason, setReason] = useState('');
  const [ticketId, setTicketId] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const reset = () => { setField('email'); setValue(''); setOperator(member.momoOperator ?? ''); setReason(''); setTicketId(''); setError(''); };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    const v = value.trim();
    if (field === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) { setError('Entrez une adresse e-mail valide.'); return; }
    if (field === 'phoneNumber' && v.replace(/\D/g, '').length < 8) { setError('Entrez un numéro complet, avec l’indicatif du pays.'); return; }
    if (field === 'momo' && v.replace(/\D/g, '').length < 8) { setError('Entrez le numéro Mobile Money complet.'); return; }
    if (field === 'momo' && !/^[A-Za-z0-9_]{2,40}$/.test(operator.trim())) { setError('Indiquez le code de l’opérateur (ex. MTN_MOMO_CMR).'); return; }
    if (reason.trim().length < 20) { setError('Expliquez la demande et les preuves vérifiées (20 caractères minimum).'); return; }
    setBusy(true);
    try {
      const token = await reauth({ title: 'Confirmer la demande', description: 'Changement de contact d’un membre : entrez le code de votre application d’authentification.' });
      const extra = ticketId.trim() ? { ticketId: ticketId.trim() } : {};
      await membersApi.requestContactChange(member._id, field === 'momo'
        ? { field, momoNumber: v, momoOperator: operator.trim().toUpperCase(), reason: reason.trim(), ...extra }
        : { field, newValue: v, reason: reason.trim(), ...extra }, token);
      toast.success('Demande envoyée pour double validation.');
      reset();
      onOpenChange(false);
    } catch (err) {
      if (isReauthCancelled(err)) return;
      // CONTACT_UNAVAILABLE: the server's neutral message, never which account uses the value.
      setError(err instanceof ApiError && err.code === 'CONTACT_UNAVAILABLE' ? err.message : errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={o => { if (!o) reset(); onOpenChange(o); }}>
      {open && (
        <DialogContent
          title="Demander un changement de contact"
          description={field === 'momo'
            ? `Pour ${member.name}, qui ne peut pas le faire depuis l’application. Le nouveau numéro est appliqué dès qu’un autre agent approuve ; les retraits sont alors bloqués 48 h et l’e-mail du compte est prévenu.`
            : `Pour ${member.name}, qui n’a plus accès à son compte. Un autre agent devra approuver ; ensuite un code est envoyé au nouveau contact, et les retraits sont bloqués 48 h.`}
        >
          <form onSubmit={submit} className="flex flex-col gap-4">
            <Segmented<ContactField>
              label="Contact à changer"
              value={field}
              onValueChange={f => { setField(f); setValue(''); }}
              options={[{ value: 'email', label: 'E-mail', icon: Mail01Icon }, { value: 'phoneNumber', label: 'Téléphone', icon: SmartPhone01Icon }, { value: 'momo', label: 'Mobile Money', icon: SmartPhone01Icon }]}
              fill
            />
            <Field label={field === 'email' ? 'Nouvelle adresse e-mail' : field === 'momo' ? 'Nouveau numéro Mobile Money' : 'Nouveau numéro (avec indicatif)'} required>
              <Input type={field === 'email' ? 'email' : 'tel'} autoComplete="off" value={value} onChange={e => setValue(e.target.value)} placeholder={field === 'email' ? 'nom@exemple.com' : '+237 6XX XX XX XX'} />
            </Field>
            {field === 'momo' && (
              <Field label="Opérateur" required help="Le code tel qu’enregistré (ex. MTN_MOMO_CMR, ORANGE_CMR).">
                <Input autoComplete="off" value={operator} onChange={e => setOperator(e.target.value.toUpperCase())} placeholder="MTN_MOMO_CMR" />
              </Field>
            )}
            <Field label="Motif et preuves vérifiées" required help="Quelles pièces avez-vous vérifiées ? Au moins deux éléments indépendants.">
              <Textarea rows={3} value={reason} onChange={e => setReason(e.target.value)} />
            </Field>
            <Field label="Ticket lié (facultatif)">
              <Input value={ticketId} onChange={e => setTicketId(e.target.value)} placeholder="Identifiant du ticket" />
            </Field>
            {error && <p role="alert" className="rounded-control border border-danger/30 bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Annuler</Button>
              <Button type="submit" variant="primary" loading={busy}>Envoyer pour validation</Button>
            </div>
          </form>
        </DialogContent>
      )}
    </Dialog>
  );
}
