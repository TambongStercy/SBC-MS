import { useCallback, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { HugeiconsIcon } from '@hugeicons/react';
import { CheckmarkCircle02Icon, InboxIcon, RefreshIcon, Video01Icon } from '@hugeicons/core-free-icons';
import { errorMessage } from '../../api/http';
import type { ViewDecision, ViewTask } from '../../api/types';
import { viewsApi } from '../../api/views';
import { useCan } from '../../auth/context';
import { ErrorState } from '../../components/display/ErrorState';
import { StatusBadge, VIEW_STATE } from '../../components/display/labels';
import { toast } from '../../components/toast';
import {
  Button, EmptyState, Metric, PageHeader, Panel, PanelBody, PanelHeader, ResponsiveList, Skeleton, Switch, Tabs, TabsContent, TabsList, TabsTrigger,
} from '../../components/ui';
import { formatNumber, formatRelative } from '../../lib/format';
import { DECISION_LABEL, DecisionForm, ProofPanel, useHeartbeat } from './TaskReview';

const CURRENT_KEY = ['views', 'current'] as const;
const MINE_KEY = ['views', 'mine'] as const;

/** The verifier's home: one task at a time, "Tâche suivante", and their own queue. */
export default function VerificationsPage() {
  const [tab, setTab] = useState('current');
  return (
    <>
      <PageHeader title="Vérifications" description="Une preuve vidéo à la fois : regardez, comptez les vues, décidez." />
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="mb-4">
          <TabsTrigger value="current">Tâche en cours</TabsTrigger>
          <TabsTrigger value="mine">Ma file</TabsTrigger>
        </TabsList>
        <TabsContent value="current"><CurrentTask /></TabsContent>
        <TabsContent value="mine"><MyQueue /></TabsContent>
      </Tabs>
    </>
  );
}

function CurrentTask() {
  const qc = useQueryClient();
  const canBan = useCan('views.supervise');
  const current = useQuery({ queryKey: CURRENT_KEY, queryFn: viewsApi.current });
  const mine = useQuery({ queryKey: MINE_KEY, queryFn: viewsApi.myQueue });
  const [empty, setEmpty] = useState(false);
  const [lastDecision, setLastDecision] = useState<ViewDecision | null>(null);
  const inFlight = useRef(false);
  const started = useRef<string | null>(null);

  const task = current.data?.task ?? null;
  useHeartbeat(task?.id, !!task && (task.state === 'assigned' || task.state === 'in_progress'));

  const next = useMutation({
    mutationFn: viewsApi.next,
    onSuccess: r => {
      qc.setQueryData(CURRENT_KEY, { task: r.task });
      setEmpty(!r.task);
      setLastDecision(null);
    },
    onError: e => toast.error(errorMessage(e, 'Impossible d’obtenir une tâche. Réessayez.')),
    onSettled: () => { inFlight.current = false; },
  });

  // One request per tap, even on a double tap before the button disables.
  const takeNext = () => {
    if (inFlight.current) return;
    inFlight.current = true;
    next.mutate();
  };

  const startIfNeeded = useCallback(() => {
    if (!task || task.state !== 'assigned' || started.current === task.id) return;
    started.current = task.id;
    viewsApi.start(task.id)
      .then(t => qc.setQueryData(CURRENT_KEY, { task: { ...task, ...t, proof: t.proof ?? task.proof } }))
      .catch(() => { started.current = null; });
  }, [task, qc]);

  const onDecided = (_t: ViewTask, decision: ViewDecision) => {
    qc.setQueryData(CURRENT_KEY, { task: null });
    setLastDecision(decision);
    setEmpty(false);
    void qc.invalidateQueries({ queryKey: MINE_KEY });
    toast.success(`Décision enregistrée : ${DECISION_LABEL[decision].toLowerCase()}.`);
  };

  if (current.isLoading) {
    return <div className="space-y-3" aria-busy="true"><Skeleton className="h-14 w-full" /><Skeleton className="h-64 w-full" /></div>;
  }
  if (current.isError) return <ErrorState error={current.error} onRetry={() => current.refetch()} retrying={current.isFetching} />;

  if (task) {
    return (
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <ProofPanel task={task} onPlay={startIfNeeded} />
        <Panel>
          <PanelHeader title="Votre décision" description="Comptez les vues visibles dans la vidéo avant de valider." />
          <PanelBody>
            <DecisionForm
              key={`${task.id}-${task.version}`}
              task={task}
              canBan={canBan}
              onTouched={startIfNeeded}
              onDecided={onDecided}
              onConflict={() => void current.refetch()}
            />
          </PanelBody>
        </Panel>
      </div>
    );
  }

  const today = mine.data?.today;
  return (
    <div className="mx-auto flex max-w-xl flex-col gap-4">
      <AvailabilityToggle available={mine.data?.available === true} loading={mine.isLoading} onChanged={() => void qc.invalidateQueries({ queryKey: MINE_KEY })} />
      {lastDecision && (
        <p role="status" className="flex items-center gap-2 rounded-control border border-success/30 bg-success-soft px-3 py-2 text-sm text-fg">
          <HugeiconsIcon icon={CheckmarkCircle02Icon} size={18} className="shrink-0 text-success" aria-hidden="true" />
          Décision enregistrée ({DECISION_LABEL[lastDecision].toLowerCase()}). Passez à la suivante.
        </p>
      )}
      <Button
        type="button"
        variant="primary"
        className="h-16 w-full text-base"
        onClick={takeNext}
        disabled={next.isPending}
        loading={next.isPending}
        autoFocus={!!lastDecision}
      >
        {!next.isPending && <HugeiconsIcon icon={Video01Icon} size={22} aria-hidden="true" />}
        Tâche suivante
      </Button>
      {empty && (
        <Panel>
          <EmptyState
            icon={InboxIcon}
            title="Aucune preuve en attente"
            description="Toutes les preuves sont attribuées ou traitées. Réessayez dans quelques minutes."
            action={<Button onClick={takeNext} loading={next.isPending}><HugeiconsIcon icon={RefreshIcon} size={16} aria-hidden="true" /> Réessayer</Button>}
          />
        </Panel>
      )}
      <div className="grid grid-cols-3 gap-2 sm:gap-3">
        <Metric label="Traitées aujourd’hui" value={mine.isLoading ? <Skeleton className="h-7 w-10" /> : formatNumber(today?.decided)} />
        <Metric label="Validées" value={mine.isLoading ? <Skeleton className="h-7 w-10" /> : formatNumber(today?.approved)} tone="success" />
        <Metric label="Rejetées" value={mine.isLoading ? <Skeleton className="h-7 w-10" /> : formatNumber(today?.rejected)} tone="danger" />
      </div>
    </div>
  );
}

function MyQueue() {
  const mine = useQuery({ queryKey: MINE_KEY, queryFn: viewsApi.myQueue });
  if (mine.isError) return <ErrorState error={mine.error} onRetry={() => mine.refetch()} retrying={mine.isFetching} />;
  return (
    <Panel>
      <PanelHeader title="Mes dernières tâches" description="Ce que vous avez pris et décidé récemment." />
      <ResponsiveList
        loading={mine.isLoading}
        rows={mine.data?.items ?? []}
        rowKey={t => t.id}
        empty={<EmptyState icon={InboxIcon} title="Aucune tâche pour l’instant" description="Les preuves que vous traitez apparaîtront ici." />}
        columns={[
          { key: 'campaign', header: 'Campagne', cell: t => <span className="font-medium">{t.proof?.campaign.name ?? t.sourceId}</span> },
          { key: 'day', header: 'Jour', cell: t => (t.proof ? `Jour ${t.proof.dayIndex}` : '—') },
          { key: 'state', header: 'État', cell: t => <StatusBadge map={VIEW_STATE} value={t.state} /> },
          { key: 'decision', header: 'Décision', cell: t => (t.decision ? DECISION_LABEL[t.decision] : '—') },
          { key: 'views', header: 'Vues observées', numeric: true, cell: t => (t.observedViews != null ? formatNumber(t.observedViews) : '—') },
          { key: 'at', header: 'Quand', cell: t => formatRelative(t.decidedAt ?? t.startedAt ?? t.assignedAt) },
        ]}
      />
    </Panel>
  );
}

/**
 * "Disponible": in round-robin and load modes the server only hands tasks to
 * available verifiers, and the supervisor's board shows them online.
 * "Tâche suivante" works either way.
 */
function AvailabilityToggle({ available, loading, onChanged }: { available: boolean; loading: boolean; onChanged: () => void }) {
  const set = useMutation({
    mutationFn: (v: boolean) => viewsApi.setAvailability(v),
    onSuccess: r => { toast.success(r.available ? 'Vous êtes disponible : des preuves peuvent vous être attribuées.' : 'Vous n’êtes plus disponible pour l’attribution automatique.'); onChanged(); },
    onError: err => toast.error(errorMessage(err)),
  });
  return (
    <label className="flex items-center justify-between gap-3 rounded-control border border-line bg-surface px-3 py-2 text-sm text-fg">
      <span>
        <span className="font-medium">Disponible pour l’attribution automatique</span>
        <span className="block text-xs text-fg-muted">Le superviseur vous voit en ligne et des preuves vous sont envoyées.</span>
      </span>
      <Switch checked={available} disabled={loading || set.isPending} onCheckedChange={v => set.mutate(v)} aria-label="Disponible pour l’attribution automatique" />
    </label>
  );
}
