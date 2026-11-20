import React, { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Badge, Button, Metric, PageHeader, Panel, PanelBody, PanelHeader, Segmented, Skeleton, Table, TBody, TD, TH, THead, TR, Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui';
import { formatDateTime, formatMoney, formatNumber } from '../components/common/format';
import {
  ConversionSummary, FailureGroup, FailureItem, PaymentAlert, Row,
  downloadFailuresCsv, getConversionSummary, getFailures, getPaymentAlerts,
} from '../services/adminConversionApi';

/**
 * Paiements (Security plan Phase 10): how many members who try to pay
 * actually pay, where attempts are lost (funnel, provider, country, product),
 * and why unfinished payments did not finish ("Échecs"). Read-only.
 */

const GROUP_LABEL: Record<FailureGroup, string> = {
  sbc_code: 'Code SBC',
  provider_api: 'Fournisseur',
  member: 'Côté membre',
  unknown: 'Inconnu',
};
const GROUP_WHO: Record<FailureGroup, string> = {
  sbc_code: 'Développeurs',
  provider_api: 'Sterling avec le fournisseur',
  member: 'Personne (textes à améliorer si une raison domine)',
  unknown: 'À revoir, puis ajouter une règle',
};
const GROUP_TONE: Record<FailureGroup, 'danger' | 'warning' | 'neutral' | 'info'> = {
  sbc_code: 'danger', provider_api: 'warning', member: 'neutral', unknown: 'info',
};
const GATEWAY_LABEL: Record<string, string> = {
  moneyfusion: 'MoneyFusion', cinetpay: 'CinetPay', feexpay: 'FeexPay', nowpayments: 'Crypto (NOWPayments)', none: 'Aucun choisi', testing: 'Test', lygos: 'Lygos',
};
const gw = (g: string) => GATEWAY_LABEL[g] || g;
const country = (c: string | null) => (!c || c === 'none' ? 'Pas encore choisi' : c);
const pct = (v: number | null | undefined) => (v === null || v === undefined ? '—' : `${v.toLocaleString('fr-FR')} %`);

type Period = '7' | '30' | '90';
const doualaDay = (d: Date) => new Date(d.getTime() + 3600_000).toISOString().slice(0, 10);
const periodRange = (p: Period) => ({ from: doualaDay(new Date(Date.now() - (Number(p) - 1) * 86400_000)), to: doualaDay(new Date()) });

function Funnel({ t }: { t: ConversionSummary['totals'] }) {
  const steps = [
    { label: 'Paiements créés', value: t.attempts },
    { label: 'Page de paiement ouverte', value: t.opened, note: 'mesuré depuis le 21/11/2026' },
    { label: 'Moyen de paiement choisi', value: t.chosen },
    { label: 'Fournisseur atteint', value: t.reached },
    { label: 'Payé', value: t.succeeded },
    { label: 'Crédité au membre', value: t.credited, note: 'mesuré depuis le 21/11/2026' },
  ];
  const max = Math.max(t.attempts, 1);
  return (
    <ol className="space-y-3">
      {steps.map(s => (
        <li key={s.label}>
          <div className="mb-1 flex items-baseline justify-between gap-3 text-sm">
            <span className="text-fg">{s.label}{s.note && <span className="ml-2 text-xs text-fg-muted">({s.note})</span>}</span>
            <span className="tabular-nums text-fg">{formatNumber(s.value)} <span className="text-fg-muted">· {pct(t.attempts ? Math.round((s.value / t.attempts) * 1000) / 10 : null)}</span></span>
          </div>
          <div className="h-2.5 overflow-hidden rounded-full bg-surface-3" aria-hidden="true">
            <div className="h-full rounded-full bg-primary" style={{ width: `${Math.max((s.value / max) * 100, s.value ? 1 : 0)}%` }} />
          </div>
        </li>
      ))}
    </ol>
  );
}

function RowsTable<T extends Row>({ rows, first, label }: { rows: T[]; first: (r: T) => React.ReactNode; label: string }) {
  if (!rows.length) return <p className="text-sm text-fg-muted">Aucun paiement sur la période.</p>;
  return (
    <div className="overflow-x-auto">
      <Table>
        <THead><TR><TH>{label}</TH><TH numeric>Tentatives</TH><TH numeric>Payés</TH><TH numeric>Réussite</TH><TH numeric>Réussite après le fournisseur</TH><TH numeric>Échecs</TH><TH numeric>En attente</TH></TR></THead>
        <TBody>
          {rows.map((r, i) => (
            <TR key={i}>
              <TD>{first(r)}</TD>
              <TD numeric>{formatNumber(r.attempts)}</TD>
              <TD numeric>{formatNumber(r.succeeded)}</TD>
              <TD numeric>{pct(r.successRate)}</TD>
              <TD numeric>{pct(r.successOfReached)}</TD>
              <TD numeric>{formatNumber(r.failed)}</TD>
              <TD numeric>{formatNumber(r.waiting)}</TD>
            </TR>
          ))}
        </TBody>
      </Table>
    </div>
  );
}

function FailuresTab({ range, summary }: { range: { from: string; to: string }; summary: ConversionSummary | null }) {
  const [group, setGroup] = useState<string>('');
  const [code, setCode] = useState<string>('');
  const [items, setItems] = useState<FailureItem[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const load = async (next?: string | null) => {
    setLoading(true);
    setError('');
    try {
      const r = await getFailures({ ...range, group: group || undefined, code: code || undefined, cursor: next || undefined, limit: 50 });
      setItems(prev => (next ? [...prev, ...r.items] : r.items));
      setCursor(r.nextCursor);
    } catch {
      setError('La liste n’a pas pu être chargée.');
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { void load(null); }, [range.from, range.to, group, code]); // eslint-disable-line react-hooks/exhaustive-deps

  const groups = summary?.failureGroups || {};
  const totalFailed = Object.values(groups).reduce((n, v) => n + (v || 0), 0);

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {(Object.keys(GROUP_LABEL) as FailureGroup[]).map(g => (
          <button key={g} type="button" onClick={() => { setGroup(group === g ? '' : g); setCode(''); }} className={`rounded-panel border bg-surface p-4 text-left ${group === g ? 'border-primary' : 'border-line hover:border-line-strong'}`}>
            <div className="flex items-center justify-between"><Badge tone={GROUP_TONE[g]}>{GROUP_LABEL[g]}</Badge><span className="text-xs text-fg-muted">{pct(totalFailed ? Math.round(((groups[g] || 0) / totalFailed) * 1000) / 10 : null)}</span></div>
            <div className="mt-2 text-2xl font-semibold tabular-nums text-fg">{formatNumber(groups[g] || 0)}</div>
            <div className="mt-1 text-xs text-fg-muted">Qui agit : {GROUP_WHO[g]}</div>
          </button>
        ))}
      </div>

      {summary && summary.topCodes.length > 0 && (
        <Panel>
          <PanelHeader title="Raisons les plus fréquentes" description="Cliquez une raison pour ne voir qu’elle." />
          <PanelBody className="overflow-x-auto">
            <Table>
              <THead><TR><TH>Groupe</TH><TH>Code</TH><TH>Message du fournisseur</TH><TH numeric>Nombre</TH></TR></THead>
              <TBody>
                {summary.topCodes.map(c => (
                  <TR key={`${c.group}-${c.code}`} className="cursor-pointer" onClick={() => { setGroup(c.group); setCode(c.code === 'non_enregistre' ? '' : c.code); }}>
                    <TD><Badge tone={GROUP_TONE[c.group]}>{GROUP_LABEL[c.group]}</Badge></TD>
                    <TD className="font-mono text-xs">{c.code === 'non_enregistre' ? 'non enregistré' : c.code}</TD>
                    <TD className="max-w-[28rem] truncate text-fg-muted">{c.message || '—'}</TD>
                    <TD numeric>{formatNumber(c.count)}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </PanelBody>
        </Panel>
      )}

      <Panel>
        <PanelHeader
          title={`Paiements non aboutis${group ? ` · ${GROUP_LABEL[group as FailureGroup]}` : ''}${code ? ` · ${code}` : ''}`}
          actions={<div className="flex gap-2">
            {(group || code) && <Button size="sm" variant="ghost" onClick={() => { setGroup(''); setCode(''); }}>Tout afficher</Button>}
            <Button size="sm" onClick={() => void downloadFailuresCsv({ ...range, group: group || undefined, code: code || undefined })}>Exporter (CSV)</Button>
          </div>}
        />
        <PanelBody className="overflow-x-auto">
          {error && <p className="text-sm text-danger" role="alert">{error}</p>}
      <AlertsPanel />
          <Table>
            <THead><TR><TH>Date</TH><TH>Membre</TH><TH>Pays</TH><TH>Fournisseur</TH><TH>Produit</TH><TH numeric>Montant</TH><TH>Groupe</TH><TH>Raison</TH><TH numeric>Vérif.</TH></TR></THead>
            <TBody>
              {items.map(x => (
                <TR key={x.sessionId}>
                  <TD className="whitespace-nowrap">{formatDateTime(x.createdAt)}</TD>
                  <TD><a className="text-primary underline" href={`/userpage/${x.userId}`}>{x.userId.slice(-6)}</a></TD>
                  <TD>{country(x.country)}</TD>
                  <TD>{gw(x.gateway)}{x.operator ? ` · ${x.operator}` : ''}</TD>
                  <TD>{x.product}</TD>
                  <TD numeric>{formatMoney(x.amount, x.currency)}</TD>
                  <TD><Badge tone={GROUP_TONE[x.group]}>{GROUP_LABEL[x.group]}</Badge></TD>
                  <TD className="max-w-[24rem]"><span className="font-mono text-xs">{x.code || 'non enregistré'}</span>{x.message && <div className="truncate text-xs text-fg-muted" title={x.message}>{x.message}</div>}</TD>
                  <TD numeric>{x.checks}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
          {!loading && !items.length && <p className="py-6 text-center text-sm text-fg-muted">Aucun paiement non abouti avec ces filtres.</p>}
          {loading && <Skeleton className="mt-3 h-8 w-full" />}
          {cursor && !loading && <div className="mt-3 text-center"><Button size="sm" onClick={() => void load(cursor)}>Charger plus</Button></div>}
        </PanelBody>
      </Panel>
    </div>
  );
}

/** Team alerts (provider drop, error spikes, stuck payments), refreshed every minute. */
function AlertsPanel() {
  const [alerts, setAlerts] = useState<{ open: PaymentAlert[]; recent: PaymentAlert[] } | null>(null);
  const [showRecent, setShowRecent] = useState(false);
  useEffect(() => {
    let alive = true;
    const load = () => getPaymentAlerts().then(a => { if (alive) setAlerts(a); }).catch(() => undefined);
    void load();
    const id = window.setInterval(load, 60_000);
    return () => { alive = false; window.clearInterval(id); };
  }, []);
  if (!alerts) return null;
  return (
    <Panel>
      <PanelHeader
        title={alerts.open.length ? `Alertes en cours (${alerts.open.length})` : 'Aucune alerte en cours'}
        description="Vérifié toutes les 5 minutes : chute d’un fournisseur, pic d’erreurs, paiements bloqués."
        actions={alerts.recent.length ? <Button variant="ghost" size="sm" onClick={() => setShowRecent(v => !v)}>{showRecent ? 'Masquer l’historique' : 'Historique'}</Button> : undefined}
      />
      {(alerts.open.length > 0 || showRecent) && (
        <PanelBody className="space-y-2">
          {alerts.open.map(a => (
            <div key={a.key} className="flex flex-wrap items-center gap-2 text-sm">
              <Badge tone="danger">En cours</Badge>
              <span className="text-fg">{a.title}</span>
              <span className="text-xs text-fg-muted">depuis {formatDateTime(a.openedAt)}</span>
            </div>
          ))}
          {showRecent && alerts.recent.map(a => (
            <div key={`${a.key}-${a.openedAt}`} className="flex flex-wrap items-center gap-2 text-sm text-fg-muted">
              <Badge tone="neutral">Terminée</Badge>
              <span>{a.title}</span>
              <span className="text-xs">{formatDateTime(a.openedAt)} → {a.resolvedAt ? formatDateTime(a.resolvedAt) : '—'}</span>
            </div>
          ))}
        </PanelBody>
      )}
    </Panel>
  );
}

const PaymentConversionPage: React.FC = () => {
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') === 'echecs' ? 'echecs' : 'entonnoir';
  const [period, setPeriod] = useState<Period>('7');
  const range = useMemo(() => periodRange(period), [period]);
  const [summary, setSummary] = useState<ConversionSummary | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    setSummary(null);
    setError('');
    getConversionSummary(range).then(s => { if (alive) setSummary(s); }).catch(() => { if (alive) setError('Les chiffres n’ont pas pu être chargés.'); });
    return () => { alive = false; };
  }, [range]);

  const t = summary?.totals;
  const median = summary?.medianSecondsToSuccess;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Paiements"
        description="Combien de membres qui essaient de payer paient vraiment, où les paiements se perdent et pourquoi."
        actions={<Segmented label="Période" value={period} onValueChange={v => setPeriod(v as Period)} options={[{ value: '7', label: '7 jours' }, { value: '30', label: '30 jours' }, { value: '90', label: '90 jours' }]} />}
      />
      {error && <p className="text-sm text-danger" role="alert">{error}</p>}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Metric label="Membres qui ont payé" value={t ? `${formatNumber(t.payingMembers)} / ${formatNumber(t.members)}` : <Skeleton className="h-7 w-24" />} hint={t ? `Conversion membres : ${pct(t.memberConversion)}` : undefined} tone="primary" />
        <Metric label="Paiements réussis" value={t ? `${formatNumber(t.succeeded)} / ${formatNumber(t.attempts)}` : <Skeleton className="h-7 w-24" />} hint={t ? `Conversion tentatives : ${pct(t.attemptConversion)}` : undefined} tone="success" />
        <Metric label="En attente du fournisseur" value={t ? formatNumber(t.waiting) : <Skeleton className="h-7 w-16" />} hint={summary?.stuckOver24h.length ? `Dont plus de 24 h : ${summary.stuckOver24h.map(s => `${gw(s.gateway)} ${formatNumber(s.count)}`).join(', ')}` : 'Rien de bloqué depuis plus de 24 h'} tone="warning" />
        <Metric label="Délai médian jusqu’au paiement" value={median === null || median === undefined ? '—' : median < 120 ? `${median} s` : `${Math.round(median / 60)} min`} hint={summary ? `Du ${summary.range.from} au ${summary.range.to}` : undefined} />
      </div>

      <Tabs value={tab} onValueChange={v => setParams(p => { p.set('tab', v); return p; }, { replace: true })}>
        <TabsList>
          <TabsTrigger value="entonnoir">Entonnoir</TabsTrigger>
          <TabsTrigger value="echecs">Échecs</TabsTrigger>
        </TabsList>

        <TabsContent value="entonnoir" className="mt-4 space-y-4">
          <Panel>
            <PanelHeader title="Étapes du paiement" description="Sur 100 paiements créés, combien atteignent chaque étape." />
            <PanelBody>{t ? <Funnel t={t} /> : <Skeleton className="h-40 w-full" />}</PanelBody>
          </Panel>
          <Panel>
            <PanelHeader title="Par fournisseur" description="« Réussite après le fournisseur » : parmi les paiements arrivés chez le fournisseur." />
            <PanelBody>{summary ? <RowsTable rows={summary.byGateway} first={r => gw(r.gateway)} label="Fournisseur" /> : <Skeleton className="h-32 w-full" />}</PanelBody>
          </Panel>
          <Panel>
            <PanelHeader title="Par pays" description="Le pays est connu quand le membre choisit son moyen de paiement." />
            <PanelBody>{summary ? <RowsTable rows={summary.byCountry} first={r => country(r.country)} label="Pays" /> : <Skeleton className="h-32 w-full" />}</PanelBody>
          </Panel>
          <Panel>
            <PanelHeader title="Pays × fournisseur" />
            <PanelBody>{summary ? <RowsTable rows={summary.byCountryGateway} first={r => `${country(r.country)} · ${gw(r.gateway)}`} label="Route" /> : <Skeleton className="h-32 w-full" />}</PanelBody>
          </Panel>
          <Panel>
            <PanelHeader title="Par produit" />
            <PanelBody>{summary ? <RowsTable rows={summary.byProduct} first={r => r.product} label="Produit" /> : <Skeleton className="h-32 w-full" />}</PanelBody>
          </Panel>
          {summary && summary.daily.length > 1 && (
            <Panel>
              <PanelHeader title="Par jour" />
              <PanelBody className="overflow-x-auto">
                <Table>
                  <THead><TR><TH>Jour</TH><TH numeric>Tentatives</TH><TH numeric>Payés</TH><TH numeric>Réussite</TH><TH numeric>Échecs</TH></TR></THead>
                  <TBody>{summary.daily.slice().reverse().map(d => (
                    <TR key={d.day}><TD>{d.day}</TD><TD numeric>{formatNumber(d.attempts)}</TD><TD numeric>{formatNumber(d.succeeded)}</TD><TD numeric>{pct(d.attempts ? Math.round((d.succeeded / d.attempts) * 1000) / 10 : null)}</TD><TD numeric>{formatNumber(d.failed)}</TD></TR>
                  ))}</TBody>
                </Table>
              </PanelBody>
            </Panel>
          )}
          {summary && summary.heavyRetriers.members > 0 && (
            <Panel>
              <PanelHeader title={`Membres à plus de 20 tentatives par jour : ${formatNumber(summary.heavyRetriers.members)}`} description="À signaler au moteur de fraude (phase 4). Les 20 plus actifs." />
              <PanelBody className="overflow-x-auto">
                <Table>
                  <THead><TR><TH>Membre</TH><TH numeric>Jours au-dessus de 20</TH><TH numeric>Maximum en un jour</TH><TH numeric>Tentatives ces jours-là</TH></TR></THead>
                  <TBody>{summary.heavyRetriers.top.map(r => (
                    <TR key={r.userId}><TD className="font-mono text-xs">{r.userId}</TD><TD numeric>{formatNumber(r.days)}</TD><TD numeric>{formatNumber(r.maxPerDay)}</TD><TD numeric>{formatNumber(r.attempts)}</TD></TR>
                  ))}</TBody>
                </Table>
              </PanelBody>
            </Panel>
          )}
          {summary && <p className="text-xs text-fg-muted">Chiffres calculés le {formatDateTime(summary.computedAt)} (mis à jour toutes les 10 minutes).</p>}
        </TabsContent>

        <TabsContent value="echecs" className="mt-4">
          <FailuresTab range={range} summary={summary} />
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default PaymentConversionPage;
