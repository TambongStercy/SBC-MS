import { useEffect, useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { HugeiconsIcon } from '@hugeicons/react';
import { Alert02Icon, CheckListIcon, InboxIcon, UserSwitchIcon } from '@hugeicons/core-free-icons';
import { errorMessage } from '../../api/http';
import type { AssignmentMode, QaItem, ViewAgentStatus, ViewDecision, ViewSettings, ViewTask } from '../../api/types';
import { viewsApi } from '../../api/views';
import { useAgent } from '../../auth/context';
import { ErrorState } from '../../components/display/ErrorState';
import { StatusBadge, VIEW_STATE } from '../../components/display/labels';
import { ReasonDialog } from '../../components/ReasonDialog';
import { toast } from '../../components/toast';
import {
  Badge, Button, Dialog, DialogContent, EmptyState, Field, Input, Metric, PageHeader, Panel, PanelBody, PanelHeader, ResponsiveList,
  Segmented, Select, SheetContent, Skeleton, Tabs, TabsContent, TabsList, TabsTrigger, Textarea,
} from '../../components/ui';
import { cn } from '../../lib/cn';
import { formatDateTime, formatNumber, formatRelative } from '../../lib/format';
import { DECISION_LABEL, DecisionForm, isConflict, MIN_REJECT_REASON, ProofPanel } from './TaskReview';

const TABS = ['equipe', 'a-revoir', 'qualite', 'reglages'] as const;
type Tab = (typeof TABS)[number];

/** Supervisor's board: team and alerts, tasks to review, quality control, assignment settings. */
export default function SupervisionPage() {
  const [params, setParams] = useSearchParams();
  const raw = params.get('tab');
  const tab: Tab = (TABS as readonly string[]).includes(raw ?? '') ? (raw as Tab) : 'equipe';
  return (
    <>
      <PageHeader title="Supervision des vérifications" description="Suivez l’équipe, réaffectez les tâches bloquées, contrôlez la qualité." />
      <Tabs value={tab} onValueChange={v => setParams(v === 'equipe' ? {} : { tab: v }, { replace: true })}>
        <TabsList className="mb-4">
          <TabsTrigger value="equipe">Équipe</TabsTrigger>
          <TabsTrigger value="a-revoir">À revoir</TabsTrigger>
          <TabsTrigger value="qualite">Contrôle qualité</TabsTrigger>
          <TabsTrigger value="reglages">Réglages</TabsTrigger>
        </TabsList>
        <TabsContent value="equipe"><TeamTab /></TabsContent>
        <TabsContent value="a-revoir"><ReviewTab /></TabsContent>
        <TabsContent value="qualite"><QaTab /></TabsContent>
        <TabsContent value="reglages"><SettingsTab /></TabsContent>
      </Tabs>
    </>
  );
}

// ── Équipe ──────────────────────────────────────────────────────────────

const QUEUE_VALUE = '__queue';

/** Reassign a task to another verifier, or back to the queue, with a mandatory reason. */
export function ReassignDialog({ taskId, currentAgentId, open, onOpenChange }: {
  taskId: string | null;
  currentAgentId?: string;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const qc = useQueryClient();
  const verifiers = useQuery({ queryKey: ['views', 'verifiers'], queryFn: viewsApi.verifiers, enabled: open });
  const [target, setTarget] = useState(QUEUE_VALUE);
  useEffect(() => { if (open) setTarget(QUEUE_VALUE); }, [open]);

  const options = [
    { value: QUEUE_VALUE, label: 'Remettre dans la file' },
    ...(verifiers.data ?? []).filter(v => v.id !== currentAgentId).map(v => ({ value: v.id, label: v.name })),
  ];

  return (
    <ReasonDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Réaffecter la tâche"
      description="La réaffectation est tracée dans l’historique de la tâche avec votre motif."
      confirmLabel="Réaffecter"
      placeholder="Ex. : vérificateur inactif depuis 20 minutes"
      onConfirm={async reason => {
        if (!taskId) return;
        await viewsApi.reassign(taskId, target === QUEUE_VALUE ? null : target, reason);
        toast.success('Tâche réaffectée.');
        void qc.invalidateQueries({ queryKey: ['views'] });
      }}
    >
      <Field label="Nouvelle destination">
        <Select value={target} onValueChange={setTarget} options={options} />
      </Field>
    </ReasonDialog>
  );
}

function OnlineDot({ online }: { online: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-fg-muted">
      <span className={cn('h-2 w-2 rounded-full', online ? 'bg-success' : 'bg-line-strong')} aria-hidden="true" />
      {online ? 'En ligne' : 'Hors ligne'}
    </span>
  );
}

function TeamTab() {
  const board = useQuery({ queryKey: ['views', 'board'], queryFn: viewsApi.board, refetchInterval: 15_000 });
  const [reassign, setReassign] = useState<{ taskId: string; agentId?: string } | null>(null);

  if (board.isError) return <ErrorState error={board.error} onRetry={() => board.refetch()} retrying={board.isFetching} />;
  const c = board.data?.counts;
  const v = (n: number | undefined) => (board.isLoading ? <Skeleton className="h-7 w-10" /> : formatNumber(n));
  const alerts = board.data?.alerts ?? [];

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Metric label="Disponibles" value={v(c?.available)} hint="En attente d’un vérificateur" />
        <Metric label="Attribuées" value={v(c?.assigned)} hint="Pas encore commencées" tone="primary" />
        <Metric label="En cours" value={v(c?.in_progress)} tone="primary" />
        <Metric label="À revoir" value={v(c?.to_review)} tone={c?.to_review ? 'warning' : 'neutral'} />
      </div>

      {alerts.length > 0 && (
        <Panel className="border-danger/40">
          <PanelHeader title="Alertes" description="Tâches sans activité : rien n’est réaffecté automatiquement." />
          <ul className="divide-y divide-line">
            {alerts.map(a => (
              <li key={a.taskId} className="flex flex-col gap-2 px-5 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex min-w-0 items-start gap-3">
                  <HugeiconsIcon icon={Alert02Icon} size={18} className="mt-0.5 shrink-0 text-danger" aria-hidden="true" />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-fg">{a.agentName}</p>
                    <Badge tone="danger">
                      {a.kind === 'unstarted' ? `Pas commencée depuis ${a.idleMinutes} min` : `Inactif depuis ${a.idleMinutes} min`}
                    </Badge>
                  </div>
                </div>
                <Button size="sm" onClick={() => setReassign({ taskId: a.taskId, agentId: a.agentId })}>
                  <HugeiconsIcon icon={UserSwitchIcon} size={14} aria-hidden="true" /> Réaffecter
                </Button>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      <Panel>
        <PanelHeader title="Vérificateurs" description="Actualisé toutes les 15 secondes." />
        <ResponsiveList<ViewAgentStatus>
          loading={board.isLoading}
          rows={board.data?.agents ?? []}
          rowKey={a => a.id}
          empty={<EmptyState icon={InboxIcon} title="Aucun vérificateur" />}
          columns={[
            { key: 'name', header: 'Vérificateur', cell: a => (
              <span className="flex flex-col gap-0.5"><span className="font-medium text-fg">{a.name}</span><OnlineDot online={a.online} /></span>
            ) },
            { key: 'task', header: 'Tâche en cours', cell: a => (a.current ? (
              <span className="inline-flex flex-wrap items-center gap-2">
                <StatusBadge map={VIEW_STATE} value={a.current.state} />
                <span className={cn('text-xs tabular-nums', a.current.idleMinutes >= 15 ? 'text-danger' : 'text-fg-muted')}>
                  {a.current.idleMinutes} min sans activité
                </span>
              </span>
            ) : <span className="text-fg-subtle">Aucune</span>) },
            { key: 'decided', header: 'Traitées', numeric: true, cell: a => formatNumber(a.todayDecided) },
            { key: 'approved', header: 'Validées', numeric: true, cell: a => formatNumber(a.todayApproved) },
            { key: 'rejected', header: 'Rejetées', numeric: true, cell: a => formatNumber(a.todayRejected) },
            { key: 'actions', header: <span className="sr-only">Actions</span>, cell: a => (a.current ? (
              <Button size="sm" variant="ghost" onClick={() => setReassign({ taskId: a.current!.taskId, agentId: a.id })}>
                <HugeiconsIcon icon={UserSwitchIcon} size={14} aria-hidden="true" /> Réaffecter
              </Button>
            ) : null) },
          ]}
        />
      </Panel>

      <ReassignDialog taskId={reassign?.taskId ?? null} currentAgentId={reassign?.agentId} open={!!reassign} onOpenChange={o => { if (!o) setReassign(null); }} />
    </div>
  );
}

// ── À revoir ────────────────────────────────────────────────────────────

function ReviewTab() {
  const agent = useAgent();
  const qc = useQueryClient();
  const tasks = useQuery({ queryKey: ['views', 'tasks', 'to_review'], queryFn: () => viewsApi.tasks('to_review') });
  const [selected, setSelected] = useState<ViewTask | null>(null);

  if (tasks.isError) return <ErrorState error={tasks.error} onRetry={() => tasks.refetch()} retrying={tasks.isFetching} />;

  return (
    <Panel>
      <PanelHeader title="Preuves à revoir" description="Mises de côté par un vérificateur. Vous pouvez valider, rejeter ou bannir." />
      <ResponsiveList<ViewTask>
        loading={tasks.isLoading}
        rows={tasks.data ?? []}
        rowKey={t => t.id}
        onRowClick={setSelected}
        empty={<EmptyState icon={CheckListIcon} title="Rien à revoir" description="Aucune preuve n’attend un second avis." />}
        columns={[
          { key: 'campaign', header: 'Campagne', cell: t => <span className="font-medium">{t.proof?.campaign.name ?? t.sourceId}</span> },
          { key: 'diffuseur', header: 'Diffuseur', cell: t => t.proof?.diffuseur.name ?? '—' },
          { key: 'day', header: 'Jour', cell: t => (t.proof ? `Jour ${t.proof.dayIndex}` : '—') },
          { key: 'by', header: 'Mise de côté par', cell: t => t.assignee?.name ?? '—' },
          { key: 'note', header: 'Note', cell: t => <span className="line-clamp-2 text-fg-muted">{t.reason || '—'}</span> },
          { key: 'at', header: 'Quand', cell: t => formatRelative(t.decidedAt ?? t.lastActivityAt ?? t.submittedAt) },
        ]}
      />
      <Dialog open={!!selected} onOpenChange={o => { if (!o) setSelected(null); }}>
        {selected && (
          <SheetContent width="xl" title={selected.proof?.campaign.name ?? 'Preuve à revoir'} description={selected.reason ? `Note : ${selected.reason}` : undefined}>
            <div className="flex flex-col gap-4">
              <ProofPanel task={selected} />
              <DecisionForm
                key={`${selected.id}-${selected.version}`}
                task={selected}
                canBan
                takeOverAs={agent.id}
                onDecided={(_t, d) => {
                  toast.success(`Décision enregistrée : ${DECISION_LABEL[d].toLowerCase()}.`);
                  setSelected(null);
                  void qc.invalidateQueries({ queryKey: ['views'] });
                }}
                onConflict={() => { setSelected(null); void tasks.refetch(); }}
              />
            </div>
          </SheetContent>
        )}
      </Dialog>
    </Panel>
  );
}

// ── Contrôle qualité ────────────────────────────────────────────────────

function QaTab() {
  const qa = useQuery({ queryKey: ['views', 'qa'], queryFn: viewsApi.qa });
  const [selected, setSelected] = useState<QaItem | null>(null);

  if (qa.isError) return <ErrorState error={qa.error} onRetry={() => qa.refetch()} retrying={qa.isFetching} />;

  return (
    <Panel>
      <PanelHeader title="Échantillon à contrôler" description="Décisions tirées au hasard selon le taux réglé. Une correction est tracée." />
      <ResponsiveList<QaItem>
        loading={qa.isLoading}
        rows={qa.data ?? []}
        rowKey={i => i.task.id}
        onRowClick={setSelected}
        empty={<EmptyState icon={CheckListIcon} title="Rien à contrôler" description="L’échantillon du moment est vide." />}
        columns={[
          { key: 'campaign', header: 'Campagne', cell: i => <span className="font-medium">{i.task.proof?.campaign.name ?? i.task.sourceId}</span> },
          { key: 'agent', header: 'Vérificateur', cell: i => i.task.assignee?.name ?? '—' },
          { key: 'decision', header: 'Décision', cell: i => (i.task.decision ? DECISION_LABEL[i.task.decision] : '—') },
          { key: 'views', header: 'Vues observées', numeric: true, cell: i => (i.task.observedViews != null ? formatNumber(i.task.observedViews) : '—') },
          { key: 'verdict', header: 'Contrôle', cell: i => (i.verdict === 'confirmed' ? <Badge tone="success">Confirmée</Badge>
            : i.verdict === 'corrected' ? <Badge tone="warning">Corrigée</Badge> : <Badge tone="outline">À contrôler</Badge>) },
          { key: 'at', header: 'Décidée', cell: i => formatDateTime(i.task.decidedAt) },
        ]}
      />
      <Dialog open={!!selected} onOpenChange={o => { if (!o) setSelected(null); }}>
        {selected && (
          <SheetContent width="xl" title="Contrôle qualité" description={selected.task.proof?.campaign.name}>
            <div className="flex flex-col gap-4">
              <ProofPanel task={selected.task} />
              <QaForm item={selected} onDone={() => { setSelected(null); void qa.refetch(); }} />
            </div>
          </SheetContent>
        )}
      </Dialog>
    </Panel>
  );
}

const DECISION_OPTIONS = (['approve', 'reject', 'review', 'technical_error'] as ViewDecision[]).map(d => ({ value: d, label: DECISION_LABEL[d] }));

function QaForm({ item, onDone }: { item: QaItem; onDone: () => void }) {
  const [verdict, setVerdict] = useState<'confirmed' | 'corrected'>('confirmed');
  const [decision, setDecision] = useState<ViewDecision>(item.task.decision ?? 'approve');
  const [views, setViews] = useState(item.task.observedViews != null ? String(item.task.observedViews) : '');
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    const note = reason.trim();
    const body: { verdict: 'confirmed' | 'corrected'; decision?: ViewDecision; observedViews?: number; reason: string } = { verdict, reason: note };
    if (verdict === 'corrected') {
      if (note.length < MIN_REJECT_REASON) { setError(`Expliquez la correction (au moins ${MIN_REJECT_REASON} caractères).`); return; }
      body.decision = decision;
      if (decision === 'approve') {
        if (!/^\d+$/.test(views.trim())) { setError('Entrez le nombre de vues observé.'); return; }
        body.observedViews = Number(views.trim());
      }
    }
    setBusy(true);
    try {
      await viewsApi.qaVerdict(item.task.id, body);
      toast.success(verdict === 'confirmed' ? 'Décision confirmée.' : 'Décision corrigée.');
      onDone();
    } catch (err) {
      setError(isConflict(err) ? 'Cette décision a déjà été contrôlée.' : errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form noValidate onSubmit={submit} className="flex flex-col gap-4" aria-label="Contrôle qualité">
      <div className="rounded-control border border-line bg-surface-2 px-3 py-2 text-sm text-fg">
        Décision d’origine : <strong className="font-semibold">{item.task.decision ? DECISION_LABEL[item.task.decision] : '—'}</strong>
        {item.task.observedViews != null && <> · {formatNumber(item.task.observedViews)} vues</>}
        {item.task.reason && <p className="mt-1 text-fg-muted">{item.task.reason}</p>}
      </div>
      <Segmented
        label="Verdict"
        value={verdict}
        onValueChange={setVerdict}
        fill
        size="lg"
        options={[{ value: 'confirmed', label: 'Confirmer' }, { value: 'corrected', label: 'Corriger' }]}
      />
      {verdict === 'corrected' && (
        <>
          <Field label="Décision corrigée">
            <Select value={decision} onValueChange={v => setDecision(v as ViewDecision)} options={DECISION_OPTIONS} />
          </Field>
          {decision === 'approve' && (
            <Field label="Vues observées" required>
              <Input inputMode="numeric" value={views} onChange={e => setViews(e.target.value.replace(/[^\d]/g, ''))} />
            </Field>
          )}
        </>
      )}
      <Field label={verdict === 'corrected' ? 'Motif de la correction' : 'Commentaire (facultatif)'} required={verdict === 'corrected'}>
        <Textarea rows={3} value={reason} onChange={e => setReason(e.target.value)} />
      </Field>
      {error && <p role="alert" className="rounded-control border border-danger/30 bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
      <Button type="submit" variant="primary" size="lg" loading={busy}>{verdict === 'confirmed' ? 'Confirmer la décision' : 'Enregistrer la correction'}</Button>
    </form>
  );
}

// ── Réglages ────────────────────────────────────────────────────────────

const MODE_OPTIONS: { value: AssignmentMode; label: string }[] = [
  { value: 'round_robin', label: 'Tourniquet' },
  { value: 'load', label: 'Selon la charge' },
  { value: 'manual', label: 'Manuel' },
];

const MODE_HELP: Record<AssignmentMode, string> = {
  round_robin: 'Chaque vérificateur reçoit la tâche suivante à tour de rôle.',
  load: 'La tâche va au vérificateur qui en a le moins en cours.',
  manual: 'Les vérificateurs prennent eux-mêmes la tâche suivante ; rien n’est attribué d’office.',
};

const RANGES = {
  unstartedRequeueMinutes: { min: 1, max: 240, label: 'Remise en file d’une tâche non commencée', unit: 'minutes' },
  idleAlertMinutes: { min: 1, max: 240, label: 'Alerte d’inactivité', unit: 'minutes' },
  qaSamplePercent: { min: 0, max: 100, label: 'Taux de contrôle qualité', unit: '%' },
} as const;
type NumKey = keyof typeof RANGES;

function SettingsTab() {
  const qc = useQueryClient();
  const settings = useQuery({ queryKey: ['views', 'settings'], queryFn: viewsApi.settings });
  const [form, setForm] = useState<Record<NumKey, string> & { assignmentMode: AssignmentMode } | null>(null);
  const [errors, setErrors] = useState<Partial<Record<NumKey, string>>>({});
  const [confirm, setConfirm] = useState<ViewSettings | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (settings.data && !form) {
      const s = settings.data;
      setForm({
        assignmentMode: s.assignmentMode,
        unstartedRequeueMinutes: String(s.unstartedRequeueMinutes),
        idleAlertMinutes: String(s.idleAlertMinutes),
        qaSamplePercent: String(s.qaSamplePercent),
      });
    }
  }, [settings.data, form]);

  if (settings.isError) return <ErrorState error={settings.error} onRetry={() => settings.refetch()} retrying={settings.isFetching} />;
  if (!form) return <Skeleton className="h-72 w-full" />;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const errs: Partial<Record<NumKey, string>> = {};
    const values = {} as Record<NumKey, number>;
    for (const key of Object.keys(RANGES) as NumKey[]) {
      const r = RANGES[key];
      const n = Number(form[key]);
      if (form[key].trim() === '' || !Number.isInteger(n) || n < r.min || n > r.max) errs[key] = `Entre ${r.min} et ${r.max}.`;
      values[key] = n;
    }
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setConfirm({ assignmentMode: form.assignmentMode, ...values });
  };

  const save = async () => {
    if (!confirm) return;
    setBusy(true);
    try {
      const saved = await viewsApi.saveSettings(confirm);
      qc.setQueryData(['views', 'settings'], saved);
      toast.success('Réglages enregistrés.');
      setConfirm(null);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel>
      <PanelHeader title="Affectation et délais" description="S’applique aux prochaines tâches. Chaque changement est journalisé." />
      <PanelBody>
        <form noValidate onSubmit={submit} className="flex max-w-xl flex-col gap-5">
          <div className="flex flex-col gap-2">
            <span className="text-sm font-medium text-fg">Mode d’affectation</span>
            <Segmented label="Mode d’affectation" value={form.assignmentMode} onValueChange={m => setForm({ ...form, assignmentMode: m })} options={MODE_OPTIONS} fill size="lg" />
            <p className="text-xs text-fg-muted">{MODE_HELP[form.assignmentMode]}</p>
          </div>
          {(Object.keys(RANGES) as NumKey[]).map(key => (
            <Field key={key} label={`${RANGES[key].label} (${RANGES[key].unit})`} error={errors[key]} help={`Entre ${RANGES[key].min} et ${RANGES[key].max}.`}>
              <Input inputMode="numeric" className="max-w-40 tabular-nums" value={form[key]} onChange={e => setForm({ ...form, [key]: e.target.value.replace(/[^\d]/g, '') })} />
            </Field>
          ))}
          <Button type="submit" variant="primary" className="self-start">Enregistrer</Button>
        </form>
      </PanelBody>
      <Dialog open={!!confirm} onOpenChange={o => { if (!o) setConfirm(null); }}>
        {confirm && (
          <DialogContent
            size="sm"
            title="Enregistrer les réglages ?"
            description="Les vérificateurs seront affectés selon ces règles dès maintenant."
            footer={<>
              <Button variant="ghost" onClick={() => setConfirm(null)}>Annuler</Button>
              <Button variant="primary" loading={busy} onClick={save}>Confirmer</Button>
            </>}
          >
            <dl className="space-y-1 text-sm">
              <div className="flex justify-between gap-3"><dt className="text-fg-muted">Mode</dt><dd className="text-fg">{MODE_OPTIONS.find(m => m.value === confirm.assignmentMode)?.label}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-fg-muted">Remise en file</dt><dd className="tabular-nums text-fg">{confirm.unstartedRequeueMinutes} min</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-fg-muted">Alerte d’inactivité</dt><dd className="tabular-nums text-fg">{confirm.idleAlertMinutes} min</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-fg-muted">Contrôle qualité</dt><dd className="tabular-nums text-fg">{confirm.qaSamplePercent} %</dd></div>
            </dl>
          </DialogContent>
        )}
      </Dialog>
    </Panel>
  );
}
