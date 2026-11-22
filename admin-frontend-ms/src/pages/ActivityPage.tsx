import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Badge, Button, Metric, PageHeader, Panel, PanelBody, PanelHeader, Segmented, Select, Skeleton, Table, TBody, TD, TH, THead, TR } from '../components/ui';
import { formatDateTime, formatNumber } from '../components/common/format';
import {
  ActivatedItem, ActivityBoard, ActivityRow, ConnectedItem, FailureGroup, ListQuery, Range, SignupItem, Source,
  getActivityBoard, getActivityList,
} from '../services/adminActivityApi';

/**
 * Activité (Security plan Phase 11): the day's numbers per country, opened by
 * default. Members connected, sign-ups (completed / failed with the reason),
 * activations and unfinished payments; each number opens the list behind it.
 * Read-only. The support desk shows the same figures.
 */

const GROUP_LABEL: Record<FailureGroup, string> = { sbc_code: 'Code SBC', provider_api: 'Fournisseur', member: 'Côté membre', unknown: 'Inconnu' };
const GROUP_HINT: Record<FailureGroup, string> = {
  sbc_code: 'Erreur serveur',
  provider_api: 'Code non envoyé (SMS, WhatsApp, email)',
  member: 'Déjà inscrit, code erroné, abandon…',
  unknown: 'Raison non enregistrée',
};
const GROUP_TONE: Record<FailureGroup, 'danger' | 'warning' | 'neutral' | 'info'> = { sbc_code: 'danger', provider_api: 'warning', member: 'neutral', unknown: 'info' };
const GROUPS: FailureGroup[] = ['sbc_code', 'provider_api', 'member', 'unknown'];
const OUTCOME_LABEL: Record<SignupItem['outcome'], string> = { in_progress: 'En cours', completed: 'Terminée', failed: 'Échouée' };
const SOURCE_LABEL: Record<Source, string> = { web: 'Web', app: 'App', api: 'Autre' };

const regionNames = (() => { try { return new Intl.DisplayNames(['fr'], { type: 'region' }); } catch { return null; } })();
const countryName = (c: string) => (c === 'ALL' ? 'Tous les pays' : c === 'XX' ? 'Inconnu' : regionNames?.of(c) ?? c);

const doualaDay = (d: Date) => new Date(d.getTime() + 3600_000).toISOString().slice(0, 10);

function Trend({ value }: { value: number | null }) {
  if (value === null) return null;
  const up = value > 0;
  return (
    <span className={`ml-1.5 text-xs ${value === 0 ? 'text-fg-muted' : up ? 'text-success' : 'text-danger'}`} title="Par rapport à la moyenne des 7 jours précédents">
      {up ? '+' : ''}{value.toLocaleString('fr-FR')} %
    </span>
  );
}

/** A number that opens the list behind it. */
function Num({ value, onOpen, label }: { value: number; onOpen?: () => void; label: string }) {
  if (!onOpen || !value) return <>{formatNumber(value)}</>;
  return (
    <button type="button" onClick={onOpen} aria-label={`${label} : voir la liste`} className="tabular-nums text-primary underline-offset-2 hover:underline">
      {formatNumber(value)}
    </button>
  );
}

type Open = Omit<ListQuery, 'from' | 'to' | 'cursor'> & { title: string };

function CountryTable({ board, onOpen }: { board: ActivityBoard; onOpen: (o: Open) => void }) {
  const line = (r: ActivityRow, total = false) => {
    const country = total ? undefined : r.country;
    const name = countryName(r.country);
    return (
      <TR key={r.country} className={total ? 'bg-surface-2 font-medium' : undefined}>
        <TD className="whitespace-nowrap">{name}{!total && r.country !== 'XX' && <span className="ml-1.5 text-xs text-fg-muted">{r.country}</span>}</TD>
        <TD numeric><Num value={r.connected} label={`Connectés ${name}`} onOpen={() => onOpen({ kind: 'connected', country, title: `Membres connectés · ${name}` })} /><Trend value={r.connectedTrend} /></TD>
        <TD numeric><Num value={r.signups.started} label={`Inscriptions lancées ${name}`} onOpen={() => onOpen({ kind: 'signups', country, title: `Inscriptions lancées · ${name}` })} /></TD>
        <TD numeric><Num value={r.signups.completed} label={`Inscriptions terminées ${name}`} onOpen={() => onOpen({ kind: 'signups', country, outcome: 'completed', title: `Inscriptions terminées · ${name}` })} /><Trend value={r.completedTrend} /></TD>
        <TD numeric><Num value={r.signups.failed} label={`Inscriptions échouées ${name}`} onOpen={() => onOpen({ kind: 'signups', country, outcome: 'failed', title: `Inscriptions échouées · ${name}` })} /></TD>
        <TD numeric><Num value={r.signups.inProgress} label={`Inscriptions en cours ${name}`} onOpen={() => onOpen({ kind: 'signups', country, outcome: 'in_progress', title: `Inscriptions en cours · ${name}` })} /></TD>
        <TD numeric><Num value={r.activated} label={`Activés ${name}`} onOpen={() => onOpen({ kind: 'activated', country, title: `Membres activés · ${name}` })} /><Trend value={r.activatedTrend} /></TD>
        <TD numeric>{formatNumber(r.payments.failed)}</TD>
      </TR>
    );
  };
  if (!board.rows.length) return <p className="py-6 text-center text-sm text-fg-muted">Aucune activité sur la période.</p>;
  return (
    <div className="overflow-x-auto">
      <Table>
        <THead>
          <TR>
            <TH>Pays</TH>
            <TH numeric>{board.range.key === 'today' ? 'Connectés' : 'Connectés / jour'}</TH>
            <TH numeric>Inscriptions lancées</TH>
            <TH numeric>Terminées</TH>
            <TH numeric>Échouées</TH>
            <TH numeric>En cours</TH>
            <TH numeric>Activés</TH>
            <TH numeric>Paiements non aboutis</TH>
          </TR>
        </THead>
        <TBody>
          {line(board.total, true)}
          {board.rows.map(r => line(r))}
        </TBody>
      </Table>
    </div>
  );
}

function FailedSignups({ board, country, onOpen }: { board: ActivityBoard; country?: string; onOpen: (o: Open) => void }) {
  const t = board.total.signups;
  const label = (code: string) => board.reasons.find(r => r.code === code)?.label ?? (code === 'none' ? 'Raison non enregistrée' : code);
  const groupOf = (code: string): FailureGroup => board.reasons.find(r => r.code === code)?.group ?? 'unknown';
  const reasons = Object.entries(t.reasons).sort((a, b) => b[1] - a[1]);
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {GROUPS.map(g => (
          <Metric
            key={g}
            label={GROUP_LABEL[g]}
            value={formatNumber(t.failedGroups[g] || 0)}
            hint={GROUP_HINT[g]}
            tone={g === 'sbc_code' && t.failedGroups[g] ? 'danger' : g === 'provider_api' && t.failedGroups[g] ? 'warning' : 'neutral'}
            onClick={t.failedGroups[g] ? () => onOpen({ kind: 'signups', country, group: g, title: `Inscriptions échouées · ${GROUP_LABEL[g]}` }) : undefined}
          />
        ))}
      </div>
      {reasons.length > 0 && (
        <Table>
          <THead><TR><TH>Raison</TH><TH>Groupe</TH><TH numeric>Inscriptions</TH></TR></THead>
          <TBody>
            {reasons.map(([code, n]) => (
              <TR key={code}>
                <TD>{label(code)}</TD>
                <TD><Badge tone={GROUP_TONE[groupOf(code)]}>{GROUP_LABEL[groupOf(code)]}</Badge></TD>
                <TD numeric><Num value={n} label={label(code)} onOpen={code === 'none' ? undefined : () => onOpen({ kind: 'signups', country, reason: code, outcome: 'failed', title: `Inscriptions échouées · ${label(code)}` })} /></TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}
    </div>
  );
}

function ListPanel({ open, range, source, onClose }: { open: Open; range: { from: string; to: string }; source?: Source; onClose: () => void }) {
  const [items, setItems] = useState<unknown[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const query = useMemo<ListQuery>(() => {
    const { title: _title, ...rest } = open;
    void _title;
    return { ...rest, ...range, source: open.kind === 'activated' ? undefined : source };
  }, [open, range, source]);

  const load = async (from?: string) => {
    setLoading(true);
    setError('');
    try {
      const r = await getActivityList({ ...query, cursor: from });
      setItems(prev => (from ? [...prev, ...r.items] : r.items));
      setCursor(r.nextCursor);
    } catch {
      setError('La liste n’a pas pu être chargée.');
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { setItems([]); setCursor(null); void load(); }, [query]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Panel>
      <PanelHeader title={open.title} description={`Du ${range.from} au ${range.to}${source && open.kind !== 'activated' ? ` · ${SOURCE_LABEL[source]}` : ''}`} actions={<Button size="sm" variant="ghost" onClick={onClose}>Fermer</Button>} />
      <PanelBody className="overflow-x-auto">
        {error && <p className="text-sm text-danger" role="alert">{error}</p>}
        {open.kind === 'signups' && (
          <Table>
            <THead><TR><TH>Date</TH><TH>Pays</TH><TH>Source</TH><TH>Résultat</TH><TH>Raison</TH><TH>Contact (masqué)</TH><TH>Parrain</TH><TH>Envoi du code</TH></TR></THead>
            <TBody>
              {(items as SignupItem[]).map(x => (
                <TR key={x.id}>
                  <TD className="whitespace-nowrap">{formatDateTime(x.startedAt)}</TD>
                  <TD>{countryName(x.country)}{x.geoCountry && x.geoCountry !== x.country && <span className="ml-1 text-xs text-fg-muted">(connexion {x.geoCountry})</span>}</TD>
                  <TD>{SOURCE_LABEL[x.source]}</TD>
                  <TD><Badge tone={x.outcome === 'completed' ? 'success' : x.outcome === 'failed' ? 'danger' : 'neutral'}>{OUTCOME_LABEL[x.outcome]}</Badge></TD>
                  <TD className="max-w-[20rem]">
                    {x.reasonLabel ?? '—'}
                    {x.group && <Badge className="ml-1.5" tone={GROUP_TONE[x.group]}>{GROUP_LABEL[x.group]}</Badge>}
                    {x.wrongCodes > 0 && <div className="text-xs text-fg-muted">{x.wrongCodes} code(s) erroné(s)</div>}
                    {x.detail && <div className="truncate font-mono text-xs text-fg-muted" title={x.detail}>{x.detail}</div>}
                  </TD>
                  <TD className="text-xs">{[x.email, x.phone].filter(Boolean).join(' · ') || '—'}{x.userId && <div><Link className="text-primary underline" to={`/userpage/${x.userId}`}>Fiche membre</Link></div>}</TD>
                  <TD className="font-mono text-xs">{x.sponsorCode ?? (x.annonceur ? 'annonceur' : '—')}</TD>
                  <TD className="text-xs">{x.delivery.length ? x.delivery.map((d, i) => <div key={i}>{d.channel} : {d.status}{d.error ? ` (${d.error})` : ''}</div>) : '—'}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
        {open.kind === 'connected' && (
          <Table>
            <THead><TR><TH>Membre</TH><TH>Jour</TH><TH>Pays de connexion</TH><TH numeric>Requêtes</TH><TH numeric>Connexions</TH><TH>Source</TH><TH>Dernière activité</TH></TR></THead>
            <TBody>
              {(items as ConnectedItem[]).map(x => (
                <TR key={x.id}>
                  <TD><Link className="text-primary underline" to={`/userpage/${x.userId}`}>{x.name || x.userId.slice(-6)}</Link></TD>
                  <TD>{x.day}</TD>
                  <TD>{countryName(x.country)}{x.declaredCountry && x.declaredCountry !== x.country && <span className="ml-1 text-xs text-fg-muted">(déclaré {x.declaredCountry})</span>}</TD>
                  <TD numeric>{formatNumber(x.requests)}</TD>
                  <TD numeric>{formatNumber(x.logins)}</TD>
                  <TD className="text-xs">{(['web', 'app', 'api'] as Source[]).filter(s => x.sources?.[s]).map(s => SOURCE_LABEL[s]).join(', ') || '—'}</TD>
                  <TD className="whitespace-nowrap">{formatDateTime(x.lastAt)}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
        {open.kind === 'activated' && (
          <Table>
            <THead><TR><TH>Membre</TH><TH>Pays</TH><TH>Pack</TH><TH>Activé le</TH></TR></THead>
            <TBody>
              {(items as ActivatedItem[]).map(x => (
                <TR key={x.id}>
                  <TD><Link className="text-primary underline" to={`/userpage/${x.userId}`}>{x.name || x.userId.slice(-6)}</Link></TD>
                  <TD>{countryName(x.country)}</TD>
                  <TD>{x.subscriptionType === 'CIBLE' ? 'Ciblé' : 'Classique'}</TD>
                  <TD className="whitespace-nowrap">{formatDateTime(x.createdAt)}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
        {!loading && !items.length && !error && <p className="py-6 text-center text-sm text-fg-muted">Rien à afficher.</p>}
        {loading && <Skeleton className="mt-3 h-8 w-full" />}
        {cursor && !loading && <div className="mt-3 text-center"><Button size="sm" onClick={() => void load(cursor)}>Charger plus</Button></div>}
      </PanelBody>
    </Panel>
  );
}

/** "N refusées : mot de passe erroné 12 · compte inconnu 5" (the two biggest reasons), or nothing. */
function signinHint(t: ActivityRow, labels: { code: string; label: string }[] | undefined): string | undefined {
  const s = t.signins;
  if (!s) return undefined;
  if (!s.failed) return `${formatNumber(s.attempts)} tentative(s)`;
  const label = (c: string) => labels?.find(l => l.code === c)?.label.toLowerCase() ?? c;
  const top = Object.entries(s.reasons).sort((a, b) => b[1] - a[1]).slice(0, 2).map(([c, n]) => `${label(c)} ${formatNumber(n)}`);
  return `${formatNumber(s.failed)} refusées : ${top.join(' · ')}`;
}

const ActivityPage: React.FC = () => {
  const [range, setRange] = useState<Range>('today');
  const [country, setCountry] = useState('');
  const [source, setSource] = useState<'' | Source>('');
  const [board, setBoard] = useState<ActivityBoard | null>(null);
  const [countries, setCountries] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [open, setOpen] = useState<Open | null>(null);

  useEffect(() => {
    let alive = true;
    const load = () => getActivityBoard({ range, country: country || undefined, source: source || undefined })
      .then(b => {
        if (!alive) return;
        setBoard(b);
        setError('');
        if (!country) setCountries(b.rows.map(r => r.country));
      })
      .catch(() => { if (alive) setError('Les chiffres n’ont pas pu être chargés.'); });
    setBoard(null);
    void load();
    const id = window.setInterval(load, 60_000);
    return () => { alive = false; window.clearInterval(id); };
  }, [range, country, source]);

  const listRange = useMemo(() => {
    const to = doualaDay(new Date());
    const days = range === 'today' ? 1 : range === '7d' ? 7 : 30;
    return { from: doualaDay(new Date(Date.now() - (days - 1) * 86400_000)), to };
  }, [range]);
  const openList = (o: Open) => { setOpen({ ...o, country: o.country ?? (country || undefined) }); window.setTimeout(() => document.getElementById('activity-list')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50); };

  const t = board?.total;
  const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 1000) / 10} %` : '—');

  return (
    <div className="space-y-4">
      <PageHeader
        title="Activité"
        description="Membres connectés, inscriptions, activations et paiements, par pays."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Segmented label="Période" value={range} onValueChange={v => { setRange(v); setOpen(null); }} options={[{ value: 'today', label: 'Aujourd’hui' }, { value: '7d', label: '7 jours' }, { value: '30d', label: '30 jours' }]} />
            <Segmented label="Source" value={source || 'all'} onValueChange={v => { setSource(v === 'all' ? '' : (v as Source)); setOpen(null); }} options={[{ value: 'all', label: 'Tout' }, { value: 'web', label: 'Web' }, { value: 'app', label: 'App' }]} />
            <Select
              className="w-44"
              value={country || 'all'}
              onValueChange={v => { setCountry(v === 'all' ? '' : v); setOpen(null); }}
              options={[{ value: 'all', label: 'Tous les pays' }, ...countries.map(c => ({ value: c, label: countryName(c) }))]}
            />
          </div>
        }
      />
      {error && <p className="text-sm text-danger" role="alert">{error}</p>}
      {board && !board.connectedCollecting && (
        <p className="rounded-control border border-line bg-surface-2 px-3 py-2 text-sm text-fg-muted">
          Les membres connectés seront comptés dès que la collecte des signaux (phase 1) sera activée, après validation de la nouvelle politique de confidentialité.
        </p>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
        <Metric label={range === 'today' ? 'Membres connectés' : 'Connectés par jour (moy.)'} value={t ? formatNumber(t.connected) : <Skeleton className="h-7 w-16" />} hint={t ? <>{board?.connectedExact ? 'Compte exact' : 'Compte en direct (±1 %)'}<Trend value={t.connectedTrend} /></> : undefined} tone="primary" onClick={t?.connected ? () => openList({ kind: 'connected', title: 'Membres connectés' }) : undefined} />
        <Metric label="Inscriptions terminées" value={t ? `${formatNumber(t.signups.completed)} / ${formatNumber(t.signups.started)}` : <Skeleton className="h-7 w-24" />} hint={t ? <>Taux : {pct(t.signups.completed, t.signups.started)}<Trend value={t.completedTrend} /></> : undefined} tone="success" onClick={t?.signups.completed ? () => openList({ kind: 'signups', outcome: 'completed', title: 'Inscriptions terminées' }) : undefined} />
        <Metric label="Inscriptions échouées" value={t ? formatNumber(t.signups.failed) : <Skeleton className="h-7 w-16" />} hint={t ? `En cours : ${formatNumber(t.signups.inProgress)}` : undefined} tone={t?.signups.failedGroups.sbc_code ? 'danger' : 'warning'} onClick={t?.signups.failed ? () => openList({ kind: 'signups', outcome: 'failed', title: 'Inscriptions échouées' }) : undefined} />
        <Metric label="Activés (1er paiement)" value={t ? formatNumber(t.activated) : <Skeleton className="h-7 w-16" />} hint={t ? <Trend value={t.activatedTrend} /> : undefined} tone="success" onClick={t?.activated ? () => openList({ kind: 'activated', title: 'Membres activés' }) : undefined} />
        <Metric label="Paiements non aboutis" value={t ? formatNumber(t.payments.failed) : <Skeleton className="h-7 w-16" />} hint={t ? `${GROUPS.map(g => `${GROUP_LABEL[g]} ${formatNumber(t.payments.groups[g] || 0)}`).join(' · ')}` : undefined} />
        {/* Security plan Phase 1: every sign-in attempt, success or not. */}
        <Metric
          label="Connexions réussies"
          value={t ? formatNumber(t.signins?.signedIn ?? 0) : <Skeleton className="h-7 w-16" />}
          hint={t ? signinHint(t, board?.signinReasons) : undefined}
          tone={t?.signins && t.signins.failed > t.signins.signedIn ? 'warning' : 'neutral'}
        />
      </div>

      <Panel>
        <PanelHeader
          title="Par pays"
          description={`Trié par membres connectés. Tendance : par rapport à la moyenne des 7 jours précédents.${source ? ' ' + (board?.notes.paymentsSource ?? '') : ''}`}
        />
        <PanelBody>{board ? <CountryTable board={board} onOpen={openList} /> : <Skeleton className="h-40 w-full" />}</PanelBody>
      </Panel>

      {open && <div id="activity-list"><ListPanel open={open} range={listRange} source={source || undefined} onClose={() => setOpen(null)} /></div>}

      <Panel>
        <PanelHeader title="Inscriptions échouées : pourquoi" description="Mêmes groupes que les paiements. « Code non reçu » est prouvé par l’envoi enregistré, pas deviné." />
        <PanelBody>{board ? <FailedSignups board={board} country={country || undefined} onOpen={openList} /> : <Skeleton className="h-32 w-full" />}</PanelBody>
      </Panel>

      <Panel>
        <PanelHeader title="Paiements non aboutis" description="Par groupe d’échec, sur la période (détail dans Paiements)." actions={<Button asChild size="sm" variant="ghost"><Link to="/paiements?tab=echecs">Ouvrir Paiements</Link></Button>} />
        <PanelBody>
          {t ? (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
              {GROUPS.map(g => <Metric key={g} label={GROUP_LABEL[g]} value={formatNumber(t.payments.groups[g] || 0)} />)}
              <Metric label="Chez le fournisseur" value={formatNumber(t.payments.waiting)} hint="Sans réponse finale" />
              <Metric label="Jamais envoyés" value={formatNumber(t.payments.abandoned)} hint="Aucun moyen de paiement choisi" />
            </div>
          ) : <Skeleton className="h-20 w-full" />}
        </PanelBody>
      </Panel>

      {board && (
        <Panel>
          <PanelHeader title="Par jour" description="La période et les 7 jours qui la précèdent." />
          <PanelBody className="overflow-x-auto">
            <Table>
              <THead><TR><TH>Jour</TH><TH numeric>Connectés</TH><TH numeric>Inscriptions</TH><TH numeric>Terminées</TH><TH numeric>Échouées</TH><TH numeric>Activés</TH><TH numeric>Paiements non aboutis</TH><TH numeric>Connexions</TH><TH numeric>Refusées</TH></TR></THead>
              <TBody>
                {board.daily.slice().reverse().map(d => (
                  <TR key={d.day} className={d.current ? undefined : 'text-fg-muted'}>
                    <TD>{d.day}{!d.current && <span className="ml-1.5 text-xs">(référence)</span>}</TD>
                    <TD numeric>{formatNumber(d.connected)}</TD>
                    <TD numeric>{formatNumber(d.started)}</TD>
                    <TD numeric>{formatNumber(d.completed)}</TD>
                    <TD numeric>{formatNumber(d.failed)}</TD>
                    <TD numeric>{formatNumber(d.activated)}</TD>
                    <TD numeric>{formatNumber(d.paymentsFailed)}</TD>
                    <TD numeric>{formatNumber(d.signedIn ?? 0)}</TD>
                    <TD numeric>{formatNumber(d.signinsFailed ?? 0)}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </PanelBody>
        </Panel>
      )}
      {board && <p className="text-xs text-fg-muted">Chiffres mis à jour {board.updatedAt ? `le ${formatDateTime(board.updatedAt)}` : '—'} (toutes les minutes ; activations et paiements toutes les 5 minutes).</p>}
    </div>
  );
};

export default ActivityPage;
