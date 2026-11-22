import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { HugeiconsIcon } from '@hugeicons/react';
import { CheckListIcon, CheckmarkCircle02Icon, InformationCircleIcon } from '@hugeicons/core-free-icons';
import { approvalsApi } from '../../api/approvals';
import { membersApi } from '../../api/members';
import { ApiError, errorMessage } from '../../api/http';
import type { Approval, ApprovalType } from '../../api/types';
import { useAgent, usePermissions } from '../../auth/context';
import { isReauthCancelled, useReauth } from '../../auth/reauth';
import { ErrorState } from '../../components/display/ErrorState';
import { APPROVAL_STATUS, APPROVAL_TYPE, StatusBadge } from '../../components/display/labels';
import { ReasonDialog } from '../../components/ReasonDialog';
import { toast } from '../../components/toast';
import { Badge, Button, EmptyState, Input, PageHeader, Panel, Skeleton, Tabs, TabsContent, TabsList, TabsTrigger } from '../../components/ui';
import { formatDateTime, formatRelative } from '../../lib/format';
import type { Permission } from '../../lib/permissions';

/** Who may decide each kind of request (CONTRACT §4). */
export const APPROVER_PERMISSION: Record<ApprovalType, Permission> = {
  contact_change: 'members.contact.approve',
  manual_activation: 'activation.manual.approve',
  regularization: 'finance.regularize.approve',
  authenticator_reset: 'authenticator.reset.approve',
  account_freeze: 'risk.decide',
  risk_release: 'risk.decide',
};

/** The payload in plain words; known keys get French labels. */
const PAYLOAD_LABEL: Record<string, string> = {
  userId: 'Membre', memberName: 'Membre', field: 'Champ', newValue: 'Nouvelle valeur', gateway: 'Prestataire', externalRef: 'Référence prestataire',
  plan: 'Offre', transactionId: 'Retrait', action: 'Action', amount: 'Montant', currency: 'Devise', evidence: 'Preuves', ticketId: 'Ticket', caseId: 'Dossier',
  momoNumber: 'Nouveau numéro Mobile Money', momoOperator: 'Opérateur',
  identityVerification: 'Identité vérifiée (pièce + selfie)', identityCheckedBy: 'Identité vérifiée par',
};
const VALUE_LABEL: Record<string, string> = {
  complete: 'Marquer réussi', fail: 'Marquer échoué', email: 'E-mail', phoneNumber: 'Téléphone', momo: 'Mobile Money',
  freeze: 'Geler l’argent', unfreeze: 'Dégeler l’argent',
};
/** A super manager validates alone with a written reason (Security plan Phase 5). */
const OVERRIDE_REASON_MIN = 20;

function payloadValue(v: unknown): string {
  if (v == null || v === '') return '—';
  if (Array.isArray(v)) return v.map(payloadValue).join('\n');
  if (typeof v === 'string') return VALUE_LABEL[v] ?? v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return JSON.stringify(v);
}

/** Double validation: requests waiting for a second person, and the agent's own requests. */
export default function ApprovalsPage() {
  const perms = usePermissions();
  const canApproveAny = (Object.values(APPROVER_PERMISSION) as Permission[]).some(p => perms.has(p));
  const [tab, setTab] = useState(canApproveAny ? 'a-valider' : 'mes-demandes');

  return (
    <>
      <PageHeader
        title="Approbations"
        description="Les actions sensibles (régularisation, activation manuelle, changement de contact ou de Mobile Money, réinitialisation de l’authentificateur, gel de l’argent) s’exécutent seulement après validation par une deuxième personne."
      />
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList aria-label="Approbations" className="mb-4">
          {canApproveAny && <TabsTrigger value="a-valider">À valider</TabsTrigger>}
          <TabsTrigger value="mes-demandes">Mes demandes</TabsTrigger>
        </TabsList>
        {canApproveAny && <TabsContent value="a-valider"><PendingList /></TabsContent>}
        <TabsContent value="mes-demandes"><MineList /></TabsContent>
      </Tabs>
    </>
  );
}

function PendingList() {
  const perms = usePermissions();
  const q = useQuery({ queryKey: ['approvals', 'pending'], queryFn: () => approvalsApi.list({ status: 'pending' }) });
  if (q.isLoading) return <ListSkeleton />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} retrying={q.isFetching} />;
  const items = (q.data ?? []).filter(a => perms.has(APPROVER_PERMISSION[a.type]));
  if (items.length === 0) return <Panel><EmptyState icon={CheckmarkCircle02Icon} title="Rien à valider" description="Aucune demande n’attend votre validation." /></Panel>;
  return <ul className="flex flex-col gap-3">{items.map(a => <li key={a.id}><ApprovalCard approval={a} decidable /></li>)}</ul>;
}

function MineList() {
  const q = useQuery({ queryKey: ['approvals', 'mine'], queryFn: () => approvalsApi.list({ mine: true }) });
  if (q.isLoading) return <ListSkeleton />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} retrying={q.isFetching} />;
  const items = [...(q.data ?? [])].sort((a, b) => b.requestedAt.localeCompare(a.requestedAt));
  if (items.length === 0) return <Panel><EmptyState icon={CheckListIcon} title="Aucune demande" description="Vos demandes de validation apparaîtront ici." /></Panel>;
  return <ul className="flex flex-col gap-3">{items.map(a => <li key={a.id}><ApprovalCard approval={a} /></li>)}</ul>;
}

function ListSkeleton() {
  return <div className="flex flex-col gap-3" aria-busy="true">{[0, 1].map(i => <Skeleton key={i} className="h-40 w-full" />)}</div>;
}

function ApprovalCard({ approval: a, decidable = false }: { approval: Approval; decidable?: boolean }) {
  const agent = useAgent();
  const reauth = useReauth();
  const qc = useQueryClient();
  const [mode, setMode] = useState<'approve' | 'reject' | null>(null);
  const own = a.requestedBy.id === agent.id;
  const perms = usePermissions();
  // A super manager decides alone, own requests included (Phase 5); everyone else needs a second person.
  const alone = perms.has('approvals.override');
  const payload = Object.entries(a.payload ?? {});

  const decide = async (kind: 'approve' | 'reject', text: string) => {
    const token = await reauth({
      title: kind === 'approve' ? 'Valider la demande' : 'Refuser la demande',
      description: 'Entrez le code de votre application pour confirmer votre décision.',
    });
    try {
      if (kind === 'approve') await approvalsApi.approve(a.id, text || undefined, token);
      else await approvalsApi.reject(a.id, text, token);
      toast.success(kind === 'approve' ? 'Demande validée.' : 'Demande refusée.');
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        toast.info('Cette demande a déjà été traitée. La liste est mise à jour.');
        void qc.invalidateQueries({ queryKey: ['approvals'] });
        return;
      }
      throw e;
    }
    void qc.invalidateQueries({ queryKey: ['approvals'] });
  };

  return (
    <Panel className="p-4" aria-label={`${APPROVAL_TYPE[a.type] ?? a.type} : ${a.summary}`} role="article">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="primary">{APPROVAL_TYPE[a.type] ?? a.type}</Badge>
            <StatusBadge map={APPROVAL_STATUS} value={a.status} />
          </div>
          <p className="mt-2 text-sm font-medium text-fg">{a.summary}</p>
        </div>
        <p className="text-xs text-fg-muted" title={formatDateTime(a.requestedAt)}>
          Demandé par <span className="font-medium text-fg">{own ? 'vous' : a.requestedBy.name}</span> · {formatRelative(a.requestedAt)}
        </p>
      </div>

      <div className="mt-3 rounded-control border border-line bg-surface-2 px-3 py-2">
        <p className="text-xs text-fg-muted">Motif</p>
        <p className="whitespace-pre-wrap text-sm text-fg">{a.reason}</p>
      </div>

      {payload.length > 0 && (
        <dl className="mt-3 grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
          {payload.map(([k, v]) => (
            <div key={k} className="min-w-0">
              <dt className="text-xs text-fg-muted">{PAYLOAD_LABEL[k] ?? k}</dt>
              <dd className="whitespace-pre-wrap break-all text-fg">{payloadValue(v)}</dd>
            </div>
          ))}
        </dl>
      )}

      {a.decidedBy && (
        <p className="mt-3 text-xs text-fg-muted">
          Décision de {a.decidedBy.name}{a.decidedAt ? ` · ${formatDateTime(a.decidedAt)}` : ''}{a.decisionNote ? ` : ${a.decisionNote}` : ''}
        </p>
      )}

      {a.type === 'contact_change' && a.status === 'approved' && a.payload?.field !== 'momo' && <ContactChangeSteps approval={a} />}

      {decidable && a.status === 'pending' && (
        <div className="mt-4 flex flex-col gap-2 border-t border-line pt-3 sm:flex-row sm:items-center sm:justify-between">
          {own && !alone ? (
            <p className="flex items-center gap-2 text-sm text-fg-muted">
              <HugeiconsIcon icon={InformationCircleIcon} size={16} className="shrink-0 text-info" aria-hidden="true" />
              Vous avez fait cette demande : une autre personne doit la valider.
            </p>
          ) : alone ? (
            <p className="flex items-center gap-2 text-sm text-fg-muted">
              <HugeiconsIcon icon={InformationCircleIcon} size={16} className="shrink-0 text-warning" aria-hidden="true" />
              Super responsable : vous validez seul. Les autres responsables sont prévenus aussitôt.
            </p>
          ) : <span />}
          <div className="flex flex-col-reverse gap-2 sm:flex-row">
            <Button variant="danger-ghost" disabled={own} onClick={() => setMode('reject')}>Refuser</Button>
            <Button variant="primary" disabled={own && !alone} onClick={() => setMode('approve')}>{alone ? 'Valider seul' : 'Valider'}</Button>
          </div>
        </div>
      )}

      <ReasonDialog
        open={mode === 'approve'}
        onOpenChange={o => { if (!o) setMode(null); }}
        title={alone ? 'Valider seul (super responsable)' : 'Valider la demande'}
        description={alone ? `${a.summary}. Votre motif est envoyé aux autres responsables.` : a.summary}
        label={alone ? 'Motif (obligatoire)' : 'Note (facultative)'}
        required={alone}
        minLength={alone ? OVERRIDE_REASON_MIN : undefined}
        confirmLabel={alone ? 'Valider seul' : 'Valider'}
        onConfirm={text => decide('approve', text)}
      />
      <ReasonDialog
        open={mode === 'reject'}
        onOpenChange={o => { if (!o) setMode(null); }}
        title="Refuser la demande"
        description={a.summary}
        label="Motif du refus"
        confirmLabel="Refuser"
        tone="danger"
        onConfirm={text => decide('reject', text)}
      />
    </Panel>
  );
}

/**
 * An approved email/phone change is not applied yet: a code goes to the NEW
 * contact, the member reads it to the agent, and the agent applies it (with
 * their authenticator code). Until then the member's account is unchanged.
 */
function ContactChangeSteps({ approval }: { approval: Approval }) {
  const qc = useQueryClient();
  const reauth = useReauth();
  const [sent, setSent] = useState(Boolean((approval.payload as { codeSentAt?: string } | undefined)?.codeSentAt));
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState<'send' | 'apply' | null>(null);
  const [error, setError] = useState('');

  const send = async () => {
    setBusy('send'); setError('');
    try {
      await membersApi.sendContactCode(approval.id);
      setSent(true);
      toast.success('Code envoyé au nouveau contact. Demandez-le au membre.');
    } catch (e) { setError(errorMessage(e)); } finally { setBusy(null); }
  };
  const apply = async () => {
    const c = code.trim();
    if (!/^[A-Za-z0-9]{4,10}$/.test(c)) { setError('Entrez le code reçu par le membre.'); return; }
    setBusy('apply'); setError('');
    try {
      const token = await reauth({ title: 'Appliquer le changement', description: 'Changement de contact d’un membre : entrez le code de votre application d’authentification.' });
      await membersApi.applyContactChange(approval.id, c, token);
      toast.success('Changement appliqué. Les retraits du membre sont bloqués 48 h par sécurité.');
      void qc.invalidateQueries({ queryKey: ['approvals'] });
    } catch (e) {
      if (!isReauthCancelled(e)) setError(errorMessage(e));
    } finally { setBusy(null); }
  };

  return (
    <div className="mt-4 flex flex-col gap-3 border-t border-line pt-3" aria-label="Appliquer le changement de contact">
      <p className="text-sm text-fg">Demande validée : le changement n’est pas encore appliqué.</p>
      <ol className="list-decimal space-y-3 pl-5 text-sm text-fg">
        <li>
          <span className="block">Envoyez un code de confirmation au nouveau contact.</span>
          <Button className="mt-2" variant={sent ? 'outline' : 'primary'} onClick={send} loading={busy === 'send'} disabled={busy !== null}>
            {sent ? 'Renvoyer le code' : 'Envoyer le code au nouveau contact'}
          </Button>
        </li>
        <li>
          <label htmlFor={`code-${approval.id}`} className="block">Saisissez le code que le membre a reçu, puis appliquez.</label>
          <div className="mt-2 flex flex-col gap-2 sm:flex-row">
            <Input id={`code-${approval.id}`} value={code} onChange={e => setCode(e.target.value)} autoComplete="off" className="sm:w-48" disabled={!sent} />
            <Button variant="primary" onClick={apply} loading={busy === 'apply'} disabled={!sent || busy !== null}>Appliquer le changement</Button>
          </div>
        </li>
      </ol>
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
    </div>
  );
}
