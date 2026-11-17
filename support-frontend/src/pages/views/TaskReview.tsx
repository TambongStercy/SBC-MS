import { useEffect, useRef, useState, type FormEvent } from 'react';
import { HugeiconsIcon } from '@hugeicons/react';
import { Alert02Icon, CancelCircleIcon, CheckmarkCircle02Icon, Clock01Icon, Wrench01Icon } from '@hugeicons/core-free-icons';
import { ApiError, errorMessage } from '../../api/http';
import type { ViewDecision, ViewTask } from '../../api/types';
import { viewsApi } from '../../api/views';
import { StatusBadge, VIEW_STATE } from '../../components/display/labels';
import { Button, Checkbox, Field, Input, Panel, Textarea } from '../../components/ui';
import { cn } from '../../lib/cn';
import { formatDateTime, formatNumber } from '../../lib/format';

export const DECISION_LABEL: Record<ViewDecision, string> = {
  approve: 'Validée',
  reject: 'Rejetée',
  review: 'À revoir',
  technical_error: 'Erreur technique',
};

export const REJECT_PRESETS = [
  'Lien absent de la vidéo',
  'Vues illisibles',
  'Vidéo d’un autre jour',
  'Montage ou capture modifiée',
];

export const MIN_REJECT_REASON = 10;
export const MIN_NOTE = 3;

/** Campaign, diffuseur, day, times and the proof video of one task. */
export function ProofPanel({ task, onPlay, className }: { task: ViewTask; onPlay?: () => void; className?: string }) {
  const proof = task.proof;
  const [videoError, setVideoError] = useState(false);

  return (
    <Panel className={cn('overflow-hidden', className)}>
      <div className="flex flex-wrap items-start justify-between gap-2 border-b border-line px-4 py-3">
        <div className="min-w-0">
          <p className="text-xs text-fg-muted">Campagne</p>
          <h2 className="truncate text-base font-semibold text-fg">{proof?.campaign.name ?? `Preuve ${task.sourceId}`}</h2>
        </div>
        <StatusBadge map={VIEW_STATE} value={task.state} />
      </div>

      <div className="bg-black">
        {proof?.videoUrl && !videoError ? (
          <video
            key={proof.videoUrl}
            src={proof.videoUrl}
            controls
            playsInline
            preload="metadata"
            onPlay={onPlay}
            onError={() => setVideoError(true)}
            className="mx-auto block max-h-[60dvh] w-full"
            aria-label={`Vidéo de preuve, jour ${proof.dayIndex}`}
          />
        ) : (
          <div className="flex h-48 items-center justify-center bg-surface-2 px-4 text-center text-sm text-fg-muted" role="status">
            {proof?.videoUrl
              ? 'La vidéo ne se charge pas. Signalez une erreur technique si cela continue.'
              : 'Pas de vidéo pour cette preuve. Signalez une erreur technique.'}
          </div>
        )}
      </div>

      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 px-4 py-4 text-sm sm:grid-cols-3">
        <Item label="Diffuseur" value={proof ? `${proof.diffuseur.name}${proof.diffuseur.country ? ` · ${proof.diffuseur.country}` : ''}` : '—'} />
        <Item label="Jour" value={proof ? `Jour ${proof.dayIndex}` : '—'} />
        <Item label="Objectif de vues" value={proof?.campaign.targetViews != null ? formatNumber(proof.campaign.targetViews) : '—'} />
        <Item label="Soumise" value={formatDateTime(proof?.submittedAt ?? task.submittedAt)} />
        <Item label="Attribuée" value={formatDateTime(task.assignedAt)} />
        <Item label="Commencée" value={formatDateTime(task.startedAt)} />
      </dl>

      {proof?.history && proof.history.length > 0 && (
        <div className="border-t border-line px-4 py-3">
          <p className="mb-2 text-xs font-medium text-fg-muted">Historique</p>
          <ol className="space-y-1 text-sm">
            {proof.history.map((h, i) => (
              <li key={i} className="flex gap-3">
                <span className="shrink-0 text-xs tabular-nums text-fg-subtle">{formatDateTime(h.at)}</span>
                <span className="min-w-0 text-fg">{h.label}</span>
              </li>
            ))}
          </ol>
        </div>
      )}
    </Panel>
  );
}

function Item({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-fg-muted">{label}</dt>
      <dd className="truncate text-fg">{value}</dd>
    </div>
  );
}

const CHOICES: { value: ViewDecision; label: string; icon: typeof Alert02Icon; active: string }[] = [
  { value: 'approve', label: 'Valider', icon: CheckmarkCircle02Icon, active: 'border-success bg-success-soft text-success' },
  { value: 'reject', label: 'Rejeter', icon: CancelCircleIcon, active: 'border-danger bg-danger-soft text-danger' },
  { value: 'review', label: 'À revoir', icon: Clock01Icon, active: 'border-warning bg-warning-soft text-fg' },
  { value: 'technical_error', label: 'Erreur technique', icon: Wrench01Icon, active: 'border-info bg-info-soft text-info' },
];

export const isConflict = (e: unknown) =>
  e instanceof ApiError && (e.status === 409 || e.code === 'ALREADY_DECIDED' || e.code === 'VERSION_CONFLICT');

/**
 * Validate / reject / to review / technical error. Sends the task's version;
 * a 409 means someone else changed it: `onConflict` reloads.
 */
export function DecisionForm({ task, canBan, onTouched, onDecided, onConflict }: {
  task: ViewTask;
  canBan: boolean;
  /** First interaction with the form (starts an 'assigned' task). */
  onTouched?: () => void;
  onDecided: (task: ViewTask, decision: ViewDecision) => void;
  onConflict?: () => void;
}) {
  const [decision, setDecision] = useState<ViewDecision | null>(null);
  const [views, setViews] = useState('');
  const [reason, setReason] = useState('');
  const [ban, setBan] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const target = task.proof?.campaign.targetViews;

  const choose = (d: ViewDecision) => {
    setDecision(d);
    setError('');
    if (d !== 'reject') setBan(false);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    if (!decision) { setError('Choisissez une décision.'); return; }
    const note = reason.trim();
    const body: { decision: ViewDecision; observedViews?: number; reason?: string; ban?: boolean; version: number } = { decision, version: task.version };
    if (decision === 'approve') {
      if (!/^\d+$/.test(views.trim())) { setError('Entrez le nombre de vues observé (un nombre entier).'); return; }
      body.observedViews = Number(views.trim());
      if (note) body.reason = note;
    } else if (decision === 'reject') {
      if (note.length < MIN_REJECT_REASON) { setError(`Le motif du rejet est obligatoire (au moins ${MIN_REJECT_REASON} caractères).`); return; }
      body.reason = note;
      if (canBan && ban) body.ban = true;
    } else {
      if (note.length < MIN_NOTE) { setError('Ajoutez une courte note pour expliquer.'); return; }
      body.reason = note;
    }
    setBusy(true);
    try {
      const updated = await viewsApi.decide(task.id, body);
      onDecided(updated, decision);
    } catch (err) {
      if (isConflict(err)) {
        setError('Cette preuve a déjà été traitée ou a changé entre-temps. La tâche est rechargée.');
        onConflict?.();
      } else {
        setError(errorMessage(err));
      }
    } finally {
      setBusy(false);
    }
  };

  const reasonLabel = decision === 'reject' ? 'Motif du rejet' : decision === 'approve' ? 'Commentaire (facultatif)' : 'Note';

  return (
    <form noValidate onSubmit={submit} onPointerDownCapture={onTouched} onFocusCapture={onTouched} className="flex flex-col gap-4" aria-label="Décision">
      <fieldset>
        <legend className="mb-2 text-sm font-medium text-fg">Décision</legend>
        <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
          {CHOICES.map(c => {
            const on = decision === c.value;
            return (
              <button
                key={c.value}
                type="button"
                aria-pressed={on}
                onClick={() => choose(c.value)}
                className={cn(
                  'flex h-12 items-center justify-center gap-2 rounded-control border px-2 text-sm font-medium transition-colors',
                  on ? c.active : 'border-line-strong bg-surface text-fg hover:bg-surface-2',
                )}
              >
                <HugeiconsIcon icon={c.icon} size={18} aria-hidden="true" />
                {c.label}
              </button>
            );
          })}
        </div>
      </fieldset>

      {decision === 'approve' && (
        <Field label="Vues observées" required help={target != null ? `Objectif de la campagne : ${formatNumber(target)} vues.` : undefined}>
          <Input inputMode="numeric" pattern="[0-9]*" className="h-11 text-base tabular-nums md:text-sm" value={views}
            onChange={e => setViews(e.target.value.replace(/[^\d]/g, ''))} placeholder="0" />
        </Field>
      )}

      {decision === 'reject' && (
        <div className="flex flex-wrap gap-2" aria-label="Motifs fréquents">
          {REJECT_PRESETS.map(p => (
            <button key={p} type="button" onClick={() => setReason(p)}
              className="rounded-full border border-line-strong px-3 py-1.5 text-xs text-fg-muted hover:bg-surface-2 hover:text-fg">
              {p}
            </button>
          ))}
        </div>
      )}

      {decision && (
        <Field label={reasonLabel} required={decision !== 'approve'}>
          <Textarea rows={3} value={reason} onChange={e => setReason(e.target.value)}
            placeholder={decision === 'technical_error' ? 'Ex. : la vidéo ne se lance pas, écran noir…' : undefined} />
        </Field>
      )}

      {decision === 'reject' && canBan && (
        <label className="flex items-start gap-3 text-sm text-fg">
          <Checkbox checked={ban} onCheckedChange={v => setBan(v === true)} className="mt-0.5" aria-label="Bannir le diffuseur" />
          <span>Bannir le diffuseur de cette campagne (fraude avérée).</span>
        </label>
      )}

      {error && <p role="alert" className="rounded-control border border-danger/30 bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}

      <Button type="submit" variant="primary" size="lg" className="w-full" loading={busy} disabled={!decision}>
        Enregistrer la décision
      </Button>
    </form>
  );
}

/** Tells the server every minute that the verifier is still on the task (only while the page is visible). */
export function useHeartbeat(taskId: string | null | undefined, active: boolean) {
  const idRef = useRef(taskId);
  idRef.current = taskId;
  useEffect(() => {
    if (!taskId || !active) return;
    const beat = () => {
      if (document.visibilityState !== 'visible' || !idRef.current) return;
      viewsApi.heartbeat(idRef.current).catch(() => { /* next beat retries */ });
    };
    const timer = window.setInterval(beat, 60_000);
    return () => window.clearInterval(timer);
  }, [taskId, active]);
}
