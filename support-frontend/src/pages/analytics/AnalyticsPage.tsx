import { useMemo, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { HugeiconsIcon, type IconSvgElement } from '@hugeicons/react';
import {
  Alert02Icon, ArrowDown01Icon, ArrowUp01Icon, BotIcon, Bug01Icon, CheckmarkCircle02Icon, Clock01Icon, InboxIcon,
  InformationCircleIcon, PlayCircleIcon, UserGroupIcon,
} from '@hugeicons/core-free-icons';
import { analyticsApi, type Analytics, type ErrorState, type ErrorTypeRow } from '../../api/analytics';
import { errorMessage } from '../../api/http';
import { useCan } from '../../auth/context';
import { TrendChart } from '../../components/charts/TrendChart';
import { ErrorState as ErrorBox } from '../../components/display/ErrorState';
import { toast } from '../../components/toast';
import { Badge, Button, PageHeader, Panel, PanelBody, PanelHeader, Segmented, Skeleton } from '../../components/ui';
import { cn } from '../../lib/cn';
import { formatDateTime, formatDuration, formatNumber, isoDay } from '../../lib/format';

type Days = '7' | '30' | '90';
const PERIODS: { value: Days; label: string }[] = [{ value: '7', label: '7 j' }, { value: '30', label: '30 j' }, { value: '90', label: '90 j' }];

function periodOf(days: Days, now = new Date()) {
  const from = new Date(now);
  from.setDate(from.getDate() - (Number(days) - 1));
  return { from: isoDay(from), to: isoDay(now) };
}

const fmtNum = (v: number | null | undefined) => (v == null ? '—' : formatNumber(v));
const fmtPct = (v: number | null | undefined) => (v == null ? '—' : `${v.toLocaleString('fr-FR', { maximumFractionDigits: 1 })} %`);
const fmtMin = (m: number | null | undefined) => (m == null ? '—' : formatDuration(Math.round(m * 60)));
const fmtHours = (h: number | null | undefined) => (h == null ? '—' : formatDuration(Math.round(h * 3600)));

/** Change vs the previous period: arrow + sign + words, coloured by whether it is good (never colour alone). */
function Delta({ now, before, better, unit = '%', compact = false }: { now: number | null | undefined; before: number | null | undefined; better: 'up' | 'down'; unit?: '%' | 'pts'; /** In a table: the column says « Évolution ». */ compact?: boolean }) {
  if (now == null || before == null) return <span className="text-fg-subtle">{compact ? '—' : 'pas de comparaison'}</span>;
  const diff = unit === 'pts' ? now - before : before === 0 ? null : ((now - before) / before) * 100;
  if (diff == null) return <span className="whitespace-nowrap text-fg-subtle">{compact ? 'nouveau' : 'nouveau sur la période'}</span>;
  if (Math.abs(diff) < 0.5) return <span className="whitespace-nowrap text-fg-muted">{compact ? 'stable' : 'stable vs période précédente'}</span>;
  const up = diff > 0;
  const good = up === (better === 'up');
  return (
    <span className={cn('inline-flex items-center gap-0.5 whitespace-nowrap', good ? 'text-success' : 'text-danger')}>
      <HugeiconsIcon icon={up ? ArrowUp01Icon : ArrowDown01Icon} size={12} aria-hidden="true" />
      {up ? '+' : '−'}{Math.abs(Math.round(diff * 10) / 10).toLocaleString('fr-FR')}{unit === 'pts' ? ' pt' : ' %'}
      {!compact && <span className="text-fg-muted">&nbsp;vs période préc.</span>}
    </span>
  );
}

function Kpi({ label, value, hint, icon, tone = 'neutral' }: { label: string; value: ReactNode; hint?: ReactNode; icon: IconSvgElement; tone?: 'neutral' | 'primary' | 'success' | 'warning' | 'danger' }) {
  const toneIcon = { neutral: 'bg-surface-3 text-fg-muted', primary: 'bg-primary-soft text-primary', success: 'bg-success-soft text-success', warning: 'bg-warning-soft text-warning', danger: 'bg-danger-soft text-danger' }[tone];
  return (
    <Panel className="p-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs font-medium text-fg-muted">{label}</p>
        <span className={cn('flex h-8 w-8 items-center justify-center rounded-lg', toneIcon)} aria-hidden="true"><HugeiconsIcon icon={icon} size={16} /></span>
      </div>
      <div className="mt-2 text-2xl font-semibold tracking-tight text-fg tabular-nums">{value}</div>
      {hint && <div className="mt-1 text-xs">{hint}</div>}
    </Panel>
  );
}

const INSIGHT_TONE = { good: 'border-success/30 bg-success-soft', warning: 'border-warning/30 bg-warning-soft', critical: 'border-danger/30 bg-danger-soft', info: 'border-line bg-surface-2' } as const;
const INSIGHT_LABEL = { good: 'Bonne nouvelle', warning: 'À surveiller', critical: 'À traiter', info: 'À savoir' } as const;
const STATE: Record<ErrorState, { label: string; tone: 'danger' | 'warning' | 'success' }> = {
  open: { label: 'Ouverte', tone: 'danger' },
  handling: { label: 'En cours de traitement', tone: 'warning' },
  resolved: { label: 'Corrigée', tone: 'success' },
};
const statusLabel = (s: number) => (s === 0 ? 'Injoignable' : String(s));

/** « Analytique »: the support administrator's view of what members report, the errors they hit, and the team's load. */
export default function AnalyticsPage() {
  const [params, setParams] = useSearchParams();
  const days = (PERIODS.some(p => p.value === params.get('p')) ? params.get('p') : '30') as Days;
  const period = useMemo(() => periodOf(days), [days]);
  const q = useQuery({ queryKey: ['analytics', period], queryFn: () => analyticsApi.get(period), staleTime: 60_000 });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Analytique"
        description="Ce que les membres signalent, comment l’équipe y répond, et les erreurs techniques qu’ils rencontrent. Chaque chiffre est comparé à la période précédente de même durée."
        actions={<Segmented label="Période" value={days} onValueChange={v => setParams(p => { p.set('p', v); return p; }, { replace: true })} options={PERIODS} />}
      />
      {q.isError ? <ErrorBox error={q.error} onRetry={() => void q.refetch()} />
        : !q.data ? <Loading /> : <Content data={q.data} />}
    </div>
  );
}

function Loading() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Chargement">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{Array.from({ length: 8 }, (_, i) => <Skeleton key={i} className="h-28" />)}</div>
      <div className="grid gap-4 lg:grid-cols-2"><Skeleton className="h-72" /><Skeleton className="h-72" /></div>
    </div>
  );
}

function Content({ data }: { data: Analytics }) {
  const k = data.kpis;
  const t = k.tickets;
  const series = data.series as unknown as ({ date: string } & Record<string, number | string | null>)[];
  return (
    <>
      {data.insights.length > 0 && (
        <section aria-labelledby="insights-t">
          <h2 id="insights-t" className="sr-only">À retenir</h2>
          <ul className="grid gap-2 lg:grid-cols-2">
            {data.insights.map((i, n) => (
              <li key={n} className={cn('flex items-start gap-2 rounded-xl border px-3 py-2 text-sm text-fg', INSIGHT_TONE[i.tone])}>
                <HugeiconsIcon icon={i.tone === 'good' ? CheckmarkCircle02Icon : i.tone === 'info' ? InformationCircleIcon : Alert02Icon} size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
                <span><span className="font-medium">{INSIGHT_LABEL[i.tone]} · </span>{i.text}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section aria-labelledby="requests-t" className="space-y-3">
        <h2 id="requests-t" className="text-base font-semibold text-fg">Demandes des membres</h2>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Kpi label="Demandes reçues" value={fmtNum(t.created)} icon={InboxIcon} tone="primary" hint={<Delta now={t.created} before={t.prev.created} better="down" />} />
          <Kpi label="Demandes traitées" value={fmtNum(t.handled)} icon={CheckmarkCircle02Icon} tone="success"
            hint={<><span className="text-fg-muted">{fmtPct(t.handledOfCreatedRate)} des reçues déjà réglées · </span><Delta now={t.handled} before={t.prev.handled} better="up" /></>} />
          <Kpi label="1re réponse (médiane)" value={fmtMin(t.firstResponseMedianMin)} icon={Clock01Icon}
            hint={<><span className="text-fg-muted">9 sur 10 sous {fmtMin(t.firstResponseP90Min)} · </span><Delta now={t.firstResponseMedianMin} before={t.prev.firstResponseMedianMin} better="down" /></>} />
          <Kpi label="Résolution (médiane)" value={fmtHours(t.resolutionMedianHours)} icon={Clock01Icon}
            hint={<><span className="text-fg-muted">9 sur 10 sous {fmtHours(t.resolutionP90Hours)} · </span><Delta now={t.resolutionMedianHours} before={t.prev.resolutionMedianHours} better="down" /></>} />
          <Kpi label="Délais dépassés (SLA)" value={fmtPct(t.slaBreachRate)} icon={Alert02Icon} tone={(t.slaBreachRate ?? 0) >= 25 ? 'danger' : (t.slaBreachRate ?? 0) >= 10 ? 'warning' : 'neutral'}
            hint={<Delta now={t.slaBreachRate} before={t.prev.slaBreachRate} better="down" unit="pts" />} />
          <Kpi label="En attente maintenant" value={fmtNum(k.backlog.now)} icon={InboxIcon} tone={k.backlog.unassigned > 0 ? 'warning' : 'neutral'}
            hint={<span className="text-fg-muted">{fmtNum(k.backlog.unassigned)} sans agent · {fmtNum(k.backlog.urgent)} haute priorité · la plus ancienne : {fmtHours(k.backlog.oldestOpenHours)}</span>} />
          <Kpi label="Rouvertes par le membre" value={fmtNum(k.reopened.count)} icon={Alert02Icon} tone={(k.reopened.rate ?? 0) >= 10 ? 'warning' : 'neutral'}
            hint={<><span className="text-fg-muted">{fmtPct(k.reopened.rate)} des traitées · </span><Delta now={k.reopened.count} before={k.reopened.prev} better="down" /></>} />
          <Kpi label="Réglées par l’assistant" value={fmtPct(k.assistant.settledWithoutAgentRate)} icon={BotIcon}
            hint={<><span className="text-fg-muted">{fmtNum(k.assistant.conversations - k.assistant.escalated)} sur {fmtNum(k.assistant.conversations)} questions · </span><Delta now={k.assistant.settledWithoutAgentRate} before={k.assistant.prevSettledWithoutAgentRate} better="up" unit="pts" /></>} />
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          <Panel className="p-4"><TrendChart kind="line" title="Demandes reçues et traitées, par jour" data={series}
            series={[{ key: 'created', label: 'Reçues', color: 1 }, { key: 'handled', label: 'Traitées', color: 2 }]}
            description="Quand la courbe des reçues reste au-dessus de celle des traitées, le stock grossit." /></Panel>
          <Panel className="p-4"><TrendChart kind="area" title="Demandes en attente, en fin de journée" data={series}
            series={[{ key: 'backlog', label: 'En attente', color: 1 }]} description="Le stock à traiter : il doit rester bas et stable." /></Panel>
          <Panel className="p-4 lg:col-span-2"><TrendChart kind="line" title="Délais médians, par jour (heures)" data={series}
            series={[{ key: 'firstResponseMedianHours', label: '1re réponse', color: 1 }, { key: 'resolutionMedianHours', label: 'Résolution', color: 3 }]}
            format={fmtHours} description="1re réponse selon le jour d’arrivée de la demande ; résolution selon le jour où elle a été réglée." /></Panel>
        </div>
        <Categories data={data} />
      </section>

      <Errors data={data} series={series} />

      <section aria-labelledby="team-t" className="space-y-3">
        <h2 id="team-t" className="text-base font-semibold text-fg">Équipe et dossiers</h2>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Kpi label="Dossiers finance ouverts" value={fmtNum(k.cases.openNow)} icon={Alert02Icon} tone={k.cases.criticalOpen > 0 ? 'danger' : 'neutral'}
            hint={<span className="text-fg-muted">{fmtNum(k.cases.criticalOpen)} critiques · {fmtNum(k.cases.opened)} ouverts et {fmtNum(k.cases.resolved)} résolus sur la période</span>} />
          <Kpi label="Approbations en attente" value={fmtNum(k.approvalsPending)} icon={Clock01Icon} tone={k.approvalsPending > 0 ? 'warning' : 'neutral'}
            hint={<span className="text-fg-muted">Elles bloquent un retrait, une activation ou un changement de contact.</span>} />
          <Kpi label="Sans compte" value={fmtNum(data.sources.find(s => s.key === 'public')?.count ?? 0)} icon={UserGroupIcon}
            hint={<span className="text-fg-muted">demandes de personnes qui n’arrivaient pas à se connecter</span>} />
          <Kpi label="Via l’assistant" value={fmtNum(data.sources.find(s => s.key === 'assistant')?.count ?? 0)} icon={BotIcon}
            hint={<span className="text-fg-muted">questions que l’assistant a passées à un agent</span>} />
        </div>
        <Agents data={data} />
      </section>
    </>
  );
}

function Categories({ data }: { data: Analytics }) {
  return (
    <Panel>
      <PanelHeader title="Problèmes qui reviennent" description="Par sujet de demande : à traiter à la source (article d’aide, correctif, règle) quand un sujet grossit." />
      <PanelBody className="overflow-x-auto p-0">
        {data.categories.length === 0 ? <p className="p-4 text-sm text-fg-muted">Aucune demande sur la période.</p> : (
          <table className="w-full text-sm" aria-label="Problèmes qui reviennent">
            <thead className="bg-surface-2 text-left text-xs text-fg-muted">
              <tr>
                <th scope="col" className="px-4 py-2 font-medium">Sujet</th>
                <th scope="col" className="px-4 py-2 text-right font-medium">Demandes</th>
                <th scope="col" className="px-4 py-2 font-medium">Part</th>
                <th scope="col" className="px-4 py-2 text-right font-medium">Évolution</th>
                <th scope="col" className="px-4 py-2 text-right font-medium">Résolution (médiane)</th>
                <th scope="col" className="px-4 py-2 text-right font-medium">Délais dépassés</th>
                <th scope="col" className="px-4 py-2 text-right font-medium">Encore ouvertes</th>
              </tr>
            </thead>
            <tbody>
              {data.categories.map(c => (
                <tr key={c.key} className="border-t border-line">
                  <th scope="row" className="px-4 py-2 text-left font-medium text-fg">{c.label}</th>
                  <td className="px-4 py-2 text-right tabular-nums">{fmtNum(c.count)}</td>
                  <td className="px-4 py-2">
                    <div className="flex items-center gap-2">
                      <div className="h-1.5 w-16 shrink-0 overflow-hidden rounded-full bg-surface-3" aria-hidden="true">
                        <div className="h-full rounded-full" style={{ width: `${c.share ?? 0}%`, background: 'var(--chart-1)' }} />
                      </div>
                      <span className="whitespace-nowrap tabular-nums text-fg-muted">{fmtPct(c.share)}</span>
                    </div>
                  </td>
                  <td className="px-4 py-2 text-right text-xs"><Delta compact now={c.count} before={c.prevCount} better="down" /></td>
                  <td className="px-4 py-2 text-right tabular-nums">{fmtHours(c.resolutionMedianHours)}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{fmtPct(c.slaBreachRate)}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{fmtNum(c.open)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </PanelBody>
    </Panel>
  );
}

function Errors({ data, series }: { data: Analytics; series: ({ date: string } & Record<string, number | string | null>)[] }) {
  const e = data.kpis.errors;
  return (
    <section aria-labelledby="errors-t" className="space-y-3">
      <h2 id="errors-t" className="text-base font-semibold text-fg">Erreurs techniques dans l’app des membres</h2>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="Erreurs rencontrées" value={fmtNum(e.total)} icon={Bug01Icon} tone={e.total > 0 ? 'danger' : 'neutral'} hint={<Delta now={e.total} before={e.prevTotal} better="down" />} />
        <Kpi label="Membres touchés" value={fmtNum(e.membersAffected)} icon={UserGroupIcon} tone={e.membersAffected > 0 ? 'warning' : 'neutral'} hint={<Delta now={e.membersAffected} before={e.prevMembersAffected} better="down" />} />
        <Kpi label="Types d’erreur à traiter" value={fmtNum(e.typesOpen)} icon={Alert02Icon} tone={e.typesOpen > 0 ? 'danger' : 'success'}
          hint={<span className="text-fg-muted">{fmtNum(e.typesHandling)} en cours de traitement · {fmtNum(e.typesResolvedInPeriod)} corrigés sur la période</span>} />
        <Kpi label="Revenues après correction" value={fmtNum(e.regressions)} icon={Alert02Icon} tone={e.regressions > 0 ? 'danger' : 'neutral'}
          hint={<span className="text-fg-muted">erreurs marquées « corrigées » qui sont réapparues</span>} />
      </div>
      <Panel className="p-4">
        <TrendChart kind="area" stacked title="Erreurs par jour, selon leur nature" data={series}
          series={[{ key: 'errorsServer', label: 'Serveur (5xx)', color: 1 }, { key: 'errorsClient', label: 'Refusées (4xx)', color: 2 }, { key: 'errorsNetwork', label: 'Serveur injoignable', color: 3 }]}
          description="Serveur : une panne de notre côté. Refusées : une demande que le serveur a rejetée (souvent un bug d’écran ou un cas mal expliqué). Injoignable : le service ne répondait pas." />
      </Panel>
      <ErrorTypes rows={data.errorTypes} />
    </section>
  );
}

function ErrorTypes({ rows }: { rows: ErrorTypeRow[] }) {
  const canManage = useCan('errors.manage');
  const qc = useQueryClient();
  const [busy, setBusy] = useState<string | null>(null);
  const setState = useMutation({
    mutationFn: ({ id, state }: { id: string; state: ErrorState }) => analyticsApi.setErrorState(id, state),
    onSuccess: (_r, v) => { toast.success(v.state === 'resolved' ? 'Erreur marquée corrigée.' : v.state === 'handling' ? 'Erreur prise en charge.' : 'Erreur rouverte.'); void qc.invalidateQueries({ queryKey: ['analytics'] }); },
    onError: e => toast.error(errorMessage(e)),
  });
  const openReplay = async (id: string) => {
    const tab = window.open('', '_blank');
    if (tab) tab.opener = null;
    setBusy(id);
    try {
      const { url } = await analyticsApi.errorReplayUrl(id);
      if (tab) tab.location.href = url; else window.location.assign(url);
    } catch (e) {
      tab?.close();
      toast.error(errorMessage(e, 'Impossible d’ouvrir l’enregistrement.'));
    } finally {
      setBusy(null);
    }
  };
  return (
    <Panel>
      <PanelHeader title="Erreurs qui reviennent" description="Classées par nombre de membres touchés. « En cours » = quelqu’un s’en occupe ; « Corrigée » = le correctif est en ligne (si elle revient, elle est rouverte et signalée)." />
      <PanelBody className="overflow-x-auto p-0">
        {rows.length === 0 ? <p className="p-4 text-sm text-fg-muted">Aucune erreur sur la période.</p> : (
          <table className="w-full text-sm" aria-label="Erreurs qui reviennent">
            <thead className="bg-surface-2 text-left text-xs text-fg-muted">
              <tr>
                <th scope="col" className="px-4 py-2 font-medium">Appel</th>
                <th scope="col" className="px-4 py-2 text-right font-medium">Fois</th>
                <th scope="col" className="px-4 py-2 text-right font-medium">Membres</th>
                <th scope="col" className="px-4 py-2 font-medium">Dernière fois</th>
                <th scope="col" className="px-4 py-2 font-medium">État</th>
                <th scope="col" className="px-4 py-2 font-medium"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.id} className="border-t border-line align-top">
                  <td className="px-4 py-2">
                    <p className="font-mono text-xs text-fg"><span className="font-semibold">{r.method}</span> {r.route} <Badge tone={r.status === 0 || r.status >= 500 ? 'danger' : 'warning'}>{statusLabel(r.status)}</Badge>{r.code && <span className="ml-1 text-fg-muted">{r.code}</span>}</p>
                    {r.message && <p className="mt-0.5 text-xs text-fg-muted">« {r.message} »</p>}
                    {r.regressions > 0 && <p className="mt-0.5 text-xs text-danger">Revenue {r.regressions} fois après correction</p>}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums">{fmtNum(r.count)}<div className="text-xs"><Delta compact now={r.count} before={r.prevCount} better="down" /></div></td>
                  <td className="px-4 py-2 text-right tabular-nums">{fmtNum(r.members)}</td>
                  <td className="px-4 py-2 text-xs text-fg-muted">{formatDateTime(r.lastSeen)}</td>
                  <td className="px-4 py-2"><Badge tone={STATE[r.state].tone}>{STATE[r.state].label}</Badge>{r.stateBy && <p className="mt-0.5 text-xs text-fg-muted">par {r.stateBy}</p>}</td>
                  <td className="px-4 py-2">
                    <div className="flex flex-wrap justify-end gap-1.5">
                      {r.hasReplay && (
                        <Button size="sm" variant="outline" loading={busy === r.id} onClick={() => void openReplay(r.id)}>
                          <HugeiconsIcon icon={PlayCircleIcon} size={14} aria-hidden="true" />Voir une session
                        </Button>
                      )}
                      {canManage && r.state !== 'handling' && r.state !== 'resolved' && (
                        <Button size="sm" variant="outline" disabled={setState.isPending} onClick={() => setState.mutate({ id: r.id, state: 'handling' })}>Je m’en occupe</Button>
                      )}
                      {canManage && r.state !== 'resolved' && (
                        <Button size="sm" variant="outline" disabled={setState.isPending} onClick={() => setState.mutate({ id: r.id, state: 'resolved' })}>Corrigée</Button>
                      )}
                      {canManage && r.state === 'resolved' && (
                        <Button size="sm" variant="ghost" disabled={setState.isPending} onClick={() => setState.mutate({ id: r.id, state: 'open' })}>Rouvrir</Button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </PanelBody>
    </Panel>
  );
}

function Agents({ data }: { data: Analytics }) {
  return (
    <Panel>
      <PanelHeader title="Charge par agent" description="Demandes réglées sur la période, demandes ouvertes qu’il suit, et sa vitesse de 1re réponse." />
      <PanelBody className="overflow-x-auto p-0">
        {data.agents.length === 0 ? <p className="p-4 text-sm text-fg-muted">Aucune demande traitée par un agent sur la période.</p> : (
          <table className="w-full text-sm" aria-label="Charge par agent">
            <thead className="bg-surface-2 text-left text-xs text-fg-muted">
              <tr>
                <th scope="col" className="px-4 py-2 font-medium">Agent</th>
                <th scope="col" className="px-4 py-2 text-right font-medium">Réglées</th>
                <th scope="col" className="px-4 py-2 text-right font-medium">Ouvertes suivies</th>
                <th scope="col" className="px-4 py-2 text-right font-medium">1re réponse (médiane)</th>
              </tr>
            </thead>
            <tbody>
              {data.agents.map(a => (
                <tr key={a.id} className="border-t border-line">
                  <th scope="row" className="px-4 py-2 text-left font-medium text-fg">{a.name}</th>
                  <td className="px-4 py-2 text-right tabular-nums">{fmtNum(a.handled)}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{fmtNum(a.open)}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{fmtMin(a.firstResponseMedianMin)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </PanelBody>
    </Panel>
  );
}
