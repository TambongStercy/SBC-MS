import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { HugeiconsIcon } from '@hugeicons/react';
import { RefreshIcon, UserAdd01Icon } from '@hugeicons/core-free-icons';
import { casesApi } from '../../api/cases';
import { errorMessage } from '../../api/http';
import type { CaseStatus, RecheckResult, SupportCase } from '../../api/types';
import { useAgent, usePermissions } from '../../auth/context';
import { ErrorState } from '../../components/display/ErrorState';
import { CASE_STATUS, CASE_TYPE, SEVERITY, StatusBadge } from '../../components/display/labels';
import { RecheckResultCard } from '../../components/display/RecheckResultCard';
import { ReasonDialog } from '../../components/ReasonDialog';
import { toast } from '../../components/toast';
import { Button, Dialog, Field, Select, SheetContent, Skeleton, Textarea } from '../../components/ui';
import { formatDateTime, formatRelative } from '../../lib/format';
import { ManualActivationDialog } from './ManualActivationDialog';
import { RegularizationDialog, type RegularizationTarget } from './RegularizationDialog';

const STATUS_OPTIONS = (Object.keys(CASE_STATUS) as CaseStatus[]).map(s => ({ value: s, label: CASE_STATUS[s].label }));

function show(v: unknown): string {
  if (v == null || v === '') return '—';
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return String(v);
  return JSON.stringify(v);
}

/** A case and everything an agent can do on it. */
export function CaseDetailSheet({ caseId, onOpenChange }: { caseId: string | null; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog open={!!caseId} onOpenChange={onOpenChange}>
      {caseId && <CaseSheetBody caseId={caseId} />}
    </Dialog>
  );
}

function CaseSheetBody({ caseId }: { caseId: string }) {
  const q = useQuery({ queryKey: ['case', caseId], queryFn: () => casesApi.get(caseId) });
  const c = q.data;
  return (
    <SheetContent
      width="lg"
      title={c ? c.summary : 'Dossier'}
      description={c ? `${CASE_TYPE[c.type] ?? c.type} · ouvert ${formatRelative(c.createdAt)}` : undefined}
    >
      {q.isLoading ? (
        <div className="space-y-3"><Skeleton className="h-6 w-40" /><Skeleton className="h-32 w-full" /></div>
      ) : q.isError || !c ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} retrying={q.isFetching} />
      ) : (
        <CaseBody c={c} />
      )}
    </SheetContent>
  );
}

function CaseBody({ c }: { c: SupportCase }) {
  const agent = useAgent();
  const perms = usePermissions();
  const qc = useQueryClient();
  const isActivation = c.type === 'activation';
  const canWork = isActivation ? perms.has('activation.check') : perms.has('cases.work');
  const canRecheck = isActivation ? perms.has('activation.check') : perms.has('finance.recheck');
  const canManual = isActivation && perms.has('activation.manual.request');
  const canRegularize = !isActivation && !!c.subject.transactionId && perms.has('finance.regularize.request');
  const closed = c.status === 'closed' || c.status === 'resolved';

  const [lastCheck, setLastCheck] = useState<RecheckResult | null>(null);
  const [comment, setComment] = useState('');
  const [nextStatus, setNextStatus] = useState<CaseStatus | ''>('');
  const [manualOpen, setManualOpen] = useState(false);
  const [regTarget, setRegTarget] = useState<RegularizationTarget | null>(null);

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['case', c.id] });
    void qc.invalidateQueries({ queryKey: ['cases'] });
  };

  const recheck = useMutation({
    mutationFn: () => casesApi.recheck(c.id),
    onSuccess: r => { setLastCheck(r); refresh(); },
    onError: e => toast.error(errorMessage(e)),
  });
  const assign = useMutation({
    mutationFn: () => casesApi.assign(c.id, agent.id),
    onSuccess: () => { toast.success('Dossier pris en charge.'); refresh(); },
    onError: e => toast.error(errorMessage(e)),
  });
  const addComment = useMutation({
    mutationFn: (body: string) => casesApi.comment(c.id, body),
    onSuccess: () => { setComment(''); refresh(); },
    onError: e => toast.error(errorMessage(e)),
  });

  const submitComment = (e: FormEvent) => {
    e.preventDefault();
    if (comment.trim()) addComment.mutate(comment.trim());
  };

  const details = Object.entries(c.details ?? {});
  const checks = [...(c.checks ?? [])].sort((a, b) => b.checkedAt.localeCompare(a.checkedAt));
  const comments = c.comments ?? [];

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge map={CASE_STATUS} value={c.status} />
        <StatusBadge map={SEVERITY} value={c.severity} />
        <span className="text-xs text-fg-muted">
          {c.assignee ? `Suivi par ${c.assignee.name}` : 'Personne ne suit ce dossier'} · mis à jour {formatRelative(c.updatedAt)}
        </span>
      </div>

      {canWork && (
        <div className="flex flex-wrap gap-2">
          {canRecheck && (
            <Button size="sm" variant="primary" onClick={() => recheck.mutate()} loading={recheck.isPending}>
              <HugeiconsIcon icon={RefreshIcon} size={14} aria-hidden="true" /> Revérifier
            </Button>
          )}
          {c.assignee?.id !== agent.id && !closed && (
            <Button size="sm" onClick={() => assign.mutate()} loading={assign.isPending}>
              <HugeiconsIcon icon={UserAdd01Icon} size={14} aria-hidden="true" /> Prendre le dossier
            </Button>
          )}
          {canManual && <Button size="sm" onClick={() => setManualOpen(true)}>Demander une activation manuelle</Button>}
          {canRegularize && (
            <Button size="sm" onClick={() => setRegTarget({ transactionId: c.subject.transactionId!, memberName: c.subject.memberName, caseId: c.id })}>
              Demander une régularisation
            </Button>
          )}
        </div>
      )}

      {lastCheck && <RecheckResultCard result={lastCheck} />}

      <section>
        <h3 className="mb-2 text-sm font-semibold text-fg">Objet</h3>
        <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
          <div className="min-w-0">
            <dt className="text-xs text-fg-muted">Membre</dt>
            <dd className="text-fg">
              {c.subject.userId && perms.has('members.read')
                ? <Link className="text-primary underline-offset-4 hover:underline" to={`/membres/${encodeURIComponent(c.subject.userId)}`}>{c.subject.memberName || c.subject.userId}</Link>
                : c.subject.memberName || c.subject.userId || '—'}
            </dd>
          </div>
          <KV label="Prestataire" value={c.subject.gateway} />
          <KV label="Transaction" value={c.subject.transactionId} mono />
          <KV label="Session de paiement" value={c.subject.sessionId} mono />
        </dl>
      </section>

      {details.length > 0 && (
        <section>
          <h3 className="mb-2 text-sm font-semibold text-fg">Détails</h3>
          <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
            {details.map(([k, v]) => <KV key={k} label={k} value={show(v)} mono />)}
          </dl>
        </section>
      )}

      <section>
        <h3 className="mb-2 text-sm font-semibold text-fg">Vérifications chez le prestataire</h3>
        {checks.length === 0
          ? <p className="text-sm text-fg-muted">Aucune vérification enregistrée.</p>
          : <div className="space-y-3">{checks.map(r => <RecheckResultCard key={r.requestId + r.checkedAt} result={r} />)}</div>}
      </section>

      <section>
        <h3 className="mb-2 text-sm font-semibold text-fg">Commentaires</h3>
        {comments.length === 0 ? <p className="text-sm text-fg-muted">Aucun commentaire.</p> : (
          <ul className="space-y-3">
            {comments.map(cm => (
              <li key={cm.id} className="rounded-control border border-line bg-surface-2 px-3 py-2">
                <p className="text-xs text-fg-muted">{cm.author.name} · {formatDateTime(cm.createdAt)}</p>
                <p className="mt-1 whitespace-pre-wrap text-sm text-fg">{cm.body}</p>
              </li>
            ))}
          </ul>
        )}
        {canWork && (
          <form onSubmit={submitComment} className="mt-3 flex flex-col gap-2">
            <Field label="Ajouter un commentaire">
              <Textarea value={comment} onChange={e => setComment(e.target.value)} rows={2} />
            </Field>
            <Button type="submit" size="sm" className="self-end" loading={addComment.isPending} disabled={!comment.trim()}>Publier</Button>
          </form>
        )}
      </section>

      {canWork && (
        <section>
          <h3 className="mb-2 text-sm font-semibold text-fg">Changer le statut</h3>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Select
              value={nextStatus}
              onValueChange={v => setNextStatus(v as CaseStatus)}
              placeholder="Nouveau statut"
              options={STATUS_OPTIONS.filter(o => o.value !== c.status)}
              className="sm:w-60"
            />
          </div>
        </section>
      )}

      <ReasonDialog
        open={!!nextStatus}
        onOpenChange={o => { if (!o) setNextStatus(''); }}
        title={nextStatus ? `Passer le dossier en « ${CASE_STATUS[nextStatus].label} »` : ''}
        description="Le motif est enregistré dans l’historique du dossier."
        confirmLabel="Changer le statut"
        onConfirm={async reason => {
          await casesApi.setStatus(c.id, nextStatus as CaseStatus, reason);
          toast.success('Statut mis à jour.');
          refresh();
        }}
      />
      <ManualActivationDialog
        open={manualOpen}
        onOpenChange={setManualOpen}
        defaults={{ userId: c.subject.userId, gateway: c.subject.gateway, caseId: c.id }}
      />
      <RegularizationDialog target={regTarget} onOpenChange={o => { if (!o) setRegTarget(null); }} />
    </div>
  );
}

function KV({ label, value, mono }: { label: string; value?: string | null; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-fg-muted">{label}</dt>
      <dd className={mono ? 'break-all font-mono text-xs text-fg' : 'text-fg'}>{value || '—'}</dd>
    </div>
  );
}
