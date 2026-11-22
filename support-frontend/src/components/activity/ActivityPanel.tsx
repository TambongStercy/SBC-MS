import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { activityApi, type ActivityRow, type FailureGroup } from '../../api/activity';
import { Metric, Panel, PanelBody, PanelHeader, Segmented, Skeleton, Table, TBody, TD, TH, THead, TR } from '../ui';
import { formatNumber } from '../../lib/format';
import { ErrorState } from '../display/ErrorState';

/**
 * Security plan Phase 11: the day's activity on the desk home (members
 * connected, sign-ups completed and failed with why, activations, unfinished
 * payments), per country. Same figures as the admin "Activité" page, filtered
 * by the server to the agent's countries.
 */
type Range = 'today' | '7d' | '30d';
const GROUP_LABEL: Record<FailureGroup, string> = { sbc_code: 'Code SBC', provider_api: 'Fournisseur', member: 'Côté membre', unknown: 'Inconnu' };
const GROUPS: FailureGroup[] = ['sbc_code', 'provider_api', 'member', 'unknown'];

const regionNames = (() => { try { return new Intl.DisplayNames(['fr'], { type: 'region' }); } catch { return null; } })();
export const countryName = (c: string) => (c === 'ALL' ? 'Total' : c === 'XX' ? 'Inconnu' : regionNames?.of(c) ?? c);

function Trend({ value }: { value: number | null }) {
  if (value === null) return null;
  return (
    <span className={`ml-1.5 text-xs ${value > 0 ? 'text-success' : value < 0 ? 'text-danger' : 'text-fg-muted'}`} title="Par rapport à la moyenne des 7 jours précédents">
      {value > 0 ? '+' : ''}{value.toLocaleString('fr-FR')} %
    </span>
  );
}

/** "N refusées : mot de passe erroné 12 · compte inconnu 5", the two biggest reasons. */
function signinHint(t: ActivityRow, labels: { code: string; label: string }[] | undefined): string | undefined {
  const s = t.signins;
  if (!s || !s.failed) return undefined;
  const label = (c: string) => labels?.find(l => l.code === c)?.label.toLowerCase() ?? c;
  const top = Object.entries(s.reasons).sort((a, b) => b[1] - a[1]).slice(0, 2).map(([c, n]) => `${label(c)} ${formatNumber(n)}`);
  return `${formatNumber(s.failed)} refusées : ${top.join(' · ')}`;
}

export function ActivityPanel() {
  const [range, setRange] = useState<Range>('today');
  const q = useQuery({ queryKey: ['activity', range], queryFn: () => activityApi.board({ range }), refetchInterval: 60_000 });
  const board = q.data?.board;
  const team = q.data?.team ?? [];
  const t = board?.total;

  const row = (r: ActivityRow, total = false) => (
    <TR key={r.country} className={total ? 'bg-surface-2 font-medium' : undefined}>
      <TD className="whitespace-nowrap">{countryName(r.country)}</TD>
      <TD numeric>{formatNumber(r.connected)}<Trend value={r.connectedTrend} /></TD>
      <TD numeric>{formatNumber(r.signups.started)}</TD>
      <TD numeric>{formatNumber(r.signups.completed)}<Trend value={r.completedTrend} /></TD>
      <TD numeric>{formatNumber(r.signups.failed)}</TD>
      <TD numeric>{formatNumber(r.activated)}</TD>
      <TD numeric>{formatNumber(r.payments.failed)}</TD>
      <TD numeric>{formatNumber(r.signins?.signedIn ?? 0)} <span className="text-xs text-fg-muted">/ {formatNumber(r.signins?.failed ?? 0)} refusées</span></TD>
    </TR>
  );

  return (
    <Panel className="mt-6">
      <PanelHeader
        title="Activité"
        description={team.length ? `Vos pays : ${team.map(countryName).join(', ')}` : 'Tous les pays'}
        actions={<Segmented label="Période" size="sm" value={range} onValueChange={setRange} options={[{ value: 'today', label: 'Aujourd’hui' }, { value: '7d', label: '7 jours' }, { value: '30d', label: '30 jours' }]} />}
      />
      <PanelBody className="space-y-4">
        {q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} retrying={q.isFetching} /> : (
          <>
            {board && !board.connectedCollecting && (
              <p className="text-xs text-fg-muted">Les membres connectés seront comptés dès que la collecte des signaux sera activée.</p>
            )}
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
              <Metric label={range === 'today' ? 'Membres connectés' : 'Connectés / jour'} value={t ? formatNumber(t.connected) : <Skeleton className="h-7 w-12" />} tone="primary" />
              <Metric label="Inscriptions terminées" value={t ? `${formatNumber(t.signups.completed)} / ${formatNumber(t.signups.started)}` : <Skeleton className="h-7 w-16" />} tone="success" />
              <Metric
                label="Inscriptions échouées"
                value={t ? formatNumber(t.signups.failed) : <Skeleton className="h-7 w-12" />}
                hint={t ? GROUPS.filter(g => t.signups.failedGroups[g]).map(g => `${GROUP_LABEL[g]} ${formatNumber(t.signups.failedGroups[g])}`).join(' · ') || undefined : undefined}
                tone={t?.signups.failedGroups.sbc_code || t?.signups.failedGroups.provider_api ? 'warning' : 'neutral'}
              />
              <Metric label="Activés" value={t ? formatNumber(t.activated) : <Skeleton className="h-7 w-12" />} hint={t ? `Paiements non aboutis : ${formatNumber(t.payments.failed)}` : undefined} />
              <Metric
                label="Connexions réussies"
                value={t ? formatNumber(t.signins?.signedIn ?? 0) : <Skeleton className="h-7 w-12" />}
                hint={t ? signinHint(t, board?.signinReasons) : undefined}
                tone={t?.signins && t.signins.failed > t.signins.signedIn ? 'warning' : 'neutral'}
              />
            </div>
            {board ? (
              board.rows.length ? (
                <Table>
                  <THead>
                    <TR><TH>Pays</TH><TH numeric>Connectés</TH><TH numeric>Inscriptions</TH><TH numeric>Terminées</TH><TH numeric>Échouées</TH><TH numeric>Activés</TH><TH numeric>Paiements non aboutis</TH><TH numeric>Connexions</TH></TR>
                  </THead>
                  <TBody>
                    {row(board.total, true)}
                    {board.rows.map(r => row(r))}
                  </TBody>
                </Table>
              ) : <p className="py-4 text-center text-sm text-fg-muted">Aucune activité sur la période.</p>
            ) : q.isLoading ? <Skeleton className="h-32 w-full" /> : null}
          </>
        )}
      </PanelBody>
    </Panel>
  );
}
