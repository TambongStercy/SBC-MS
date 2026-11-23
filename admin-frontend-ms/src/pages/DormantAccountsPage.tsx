import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import {
  Badge, Button, Dialog, DialogContent, Field, Input, Metric, PageHeader, Panel, PanelBody, PanelHeader, Select, Skeleton, Table, TBody, TD, Textarea, TH, THead, TR,
} from '../components/ui';
import { formatDate, formatDateTime, formatMoney, formatMonthKey, formatNumber } from '../components/common/format';
import { TimeSeriesChart } from '../components/charts/TimeSeriesChart';
import { usePermission } from '../hooks/usePermission';
import ReactivationPanel from '../components/finance/ReactivationPanel';
import {
  BalanceField, DormancyStatus, DormantExport, DormantFilters, DormantRow, DormantSummary,
  downloadDormantExport, getDormantExport, getDormantList, getDormantSummary, markDormantChecked, requestDormantFreeze, startDormantExport,
} from '../services/adminDormantApi';

/**
 * Comptes dormants (Security plan Phase 7): money held by accounts nobody
 * uses. The headline numbers come from the nightly snapshot; the list is live
 * on the stored statuses, biggest first. Actions: mark checked, ask support to
 * freeze (support decides through an approval), CSV export in the background,
 * and the réactivation message to the filtered list (Phase 7 part 2, ReactivationPanel).
 */

const STATUS_LABEL: Record<DormancyStatus, string> = { active: 'Actif', inactive: 'Inactif', dormant: 'Dormant', long_dormant: 'Dormant > 1 an' };
const STATUS_TONE: Record<DormancyStatus, 'neutral' | 'info' | 'warning' | 'danger'> = { active: 'neutral', inactive: 'info', dormant: 'warning', long_dormant: 'danger' };
const BALANCE_LABEL: Record<BalanceField, string> = {
  balance: 'Solde principal (F)', usdBalance: 'Solde USD', activationBalance: 'Solde d’activation', advertisingBalance: 'Solde publicité',
  eventOrganizerBalance: 'Solde organisateur', sbcLiveBalance: 'Solde SBC Live',
};
const BASIS_LABEL: Record<string, string> = {
  signin: 'connexion', token: 'dernière session', activity: 'activité', ip: 'date d’IP (inscription)', created: 'création du compte', none: 'aucune date',
};

const regionNames = (() => { try { return new Intl.DisplayNames(['fr'], { type: 'region' }); } catch { return null; } })();
const countryName = (c: string) => (c === 'XX' || !c ? 'Inconnu' : /^[A-Z]{2}$/.test(c) ? regionNames?.of(c) ?? c : c);
const pct = (v: number) => `${Math.round(v * 1000) / 10} %`;
/** The API's own message on a refused call, else the fallback. */
const apiMessage = (err: unknown, fallback: string) =>
  (err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? fallback;
const usd = (v: number) => `${v.toLocaleString('fr-FR', { maximumFractionDigits: 2 })} $`;

function Delta({ now, before }: { now: number; before: number }) {
  if (!before) return null;
  const d = Math.round(((now - before) / before) * 1000) / 10;
  return <span className={d === 0 ? 'text-fg-muted' : d > 0 ? 'text-danger' : 'text-success'}>{d > 0 ? '+' : ''}{d.toLocaleString('fr-FR')} % sur un mois</span>;
}

function Breakdown({ title, rows }: { title: string; rows: { key: string; label: string; count?: number; xafEq: number }[] }) {
  const max = Math.max(1, ...rows.map(r => r.xafEq));
  return (
    <Panel>
      <PanelHeader title={title} />
      <PanelBody className="space-y-2">
        {rows.length === 0 && <p className="text-sm text-fg-muted">Rien.</p>}
        {rows.map(r => (
          <div key={r.key}>
            <div className="flex items-baseline justify-between gap-2 text-sm">
              <span className="truncate">{r.label}</span>
              <span className="whitespace-nowrap tabular-nums">{formatMoney(r.xafEq)}{r.count !== undefined && <span className="ml-1.5 text-xs text-fg-muted">{formatNumber(r.count)} comptes</span>}</span>
            </div>
            <div className="mt-1 h-1.5 rounded-full bg-surface-2"><div className="h-1.5 rounded-full bg-primary" style={{ width: `${(r.xafEq / max) * 100}%` }} /></div>
          </div>
        ))}
      </PanelBody>
    </Panel>
  );
}

type Action = { kind: 'check' | 'freeze'; row: DormantRow };

function ActionDialog({ action, onClose, onDone }: { action: Action | null; onClose: () => void; onDone: () => void }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { setText(''); setError(''); }, [action]);
  if (!action) return null;
  const freeze = action.kind === 'freeze';
  const submit = async () => {
    if (freeze && text.trim().length < 10) { setError('Indiquez la raison (10 caractères au moins).'); return; }
    setBusy(true);
    setError('');
    try {
      if (freeze) {
        const r = await requestDormantFreeze(action.row._id, text.trim());
        toast.success(r.caseId ? 'Demande envoyée au support (file « Fraude »).' : 'Demande enregistrée : elle part au support dès qu’il répond.');
      } else {
        await markDormantChecked(action.row._id, text.trim() || undefined);
        toast.success('Compte marqué comme vérifié.');
      }
      onDone();
    } catch (err) {
      setError(apiMessage(err, 'L’action a échoué.'));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open onOpenChange={o => { if (!o) onClose(); }}>
      <DialogContent
        title={freeze ? 'Demander un gel au support' : 'Marquer comme vérifié'}
        description={freeze
          ? `${action.row.name || action.row._id} · ${formatMoney(action.row.heldXaf)}. Le support décide du gel, après une validation par un deuxième responsable. Le membre n’est pas prévenu.`
          : `${action.row.name || action.row._id} · ${formatMoney(action.row.heldXaf)}. Note facultative (ce qui a été vérifié).`}
        footer={<>
          <Button variant="ghost" onClick={onClose} disabled={busy}>Annuler</Button>
          <Button variant={freeze ? 'danger' : 'primary'} onClick={() => void submit()} disabled={busy}>{freeze ? 'Envoyer au support' : 'Marquer vérifié'}</Button>
        </>}
      >
        <Field label={freeze ? 'Raison' : 'Note'} required={freeze} error={error || undefined}>
          <Textarea rows={3} value={text} maxLength={freeze ? 1000 : 500} onChange={e => setText(e.target.value)} />
        </Field>
      </DialogContent>
    </Dialog>
  );
}

function useExport() {
  const [job, setJob] = useState<DormantExport | null>(null);
  const timer = useRef<number | null>(null);
  useEffect(() => () => { if (timer.current) window.clearTimeout(timer.current); }, []);
  const poll = (id: string) => {
    timer.current = window.setTimeout(async () => {
      try {
        const s = await getDormantExport(id);
        setJob(s);
        if (s.status === 'running') poll(id);
        else if (s.status === 'done') toast.success(`Export prêt : ${formatNumber(s.rows)} lignes.`);
        else toast.error('L’export a échoué.');
      } catch { toast.error('Suivi de l’export impossible.'); setJob(null); }
    }, 1500);
  };
  const start = async (filters: DormantFilters) => {
    try {
      const { id } = await startDormantExport(filters);
      setJob({ id, status: 'running', rows: 0, fileName: null, error: null });
      poll(id);
    } catch (err) { toast.error(apiMessage(err, 'L’export n’a pas pu démarrer.')); }
  };
  return { job, start };
}

const DormantAccountsPage: React.FC = () => {
  const canWrite = usePermission('finance') === 'write';
  const [summary, setSummary] = useState<DormantSummary | null>(null);
  const [error, setError] = useState('');
  const [filters, setFilters] = useState<DormantFilters>({});
  const [minInput, setMinInput] = useState('');
  const [rows, setRows] = useState<DormantRow[]>([]);
  const [totals, setTotals] = useState<{ count: number; xafEq: number } | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [action, setAction] = useState<Action | null>(null);
  const exp = useExport();
  /** Loading placeholder, or a dash once the answer says there is nothing yet. */
  const pending = (w: string) => (summary ? '—' : <Skeleton className={`h-7 ${w}`} />);

  useEffect(() => {
    getDormantSummary().then(setSummary).catch(() => setError('Les chiffres n’ont pas pu être chargés.'));
  }, []);

  const load = async (from?: string | null) => {
    setLoading(true);
    try {
      const r = await getDormantList(filters, from);
      setRows(prev => (from ? [...prev, ...r.items] : r.items));
      setCursor(r.nextCursor);
      if (!from) setTotals(r.totals ?? null);
    } catch {
      toast.error('La liste n’a pas pu être chargée.');
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { setRows([]); setCursor(null); void load(); }, [filters]); // eslint-disable-line react-hooks/exhaustive-deps

  const set = (k: keyof DormantFilters, v: string) => setFilters(f => ({ ...f, [k]: v === 'all' || v === '' ? undefined : v }));
  const d = summary?.dormant;
  const th = summary?.thresholds;
  const countries = useMemo(() => (d?.byCountry ?? []).map(c => c.country).filter(c => c !== 'XX'), [d]);
  const trend = useMemo(() => (summary?.trend ?? []).map(t => ({ key: t.month, label: formatMonthKey(t.month), full: `${formatMonthKey(t.month)} (au ${t.day})`, dormant: t.xafEq })), [summary]);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Comptes dormants"
        description={th ? `Argent détenu par les comptes sans activité depuis ${th.inactiveDays} jours ou plus (inactif ${th.inactiveDays}–${th.dormantDays} j, dormant ${th.dormantDays}–${th.longDormantDays} j, dormant > 1 an au-delà).${th.minXaf ? ` Les comptes de moins de ${formatMoney(th.minXaf)} ne sont pas comptés.` : ''}` : 'Argent détenu par les comptes que personne n’utilise.'}
      />
      {error && <p className="text-sm text-danger" role="alert">{error}</p>}
      {summary && !summary.ready && (
        <p className="rounded-control border border-line bg-surface-2 px-3 py-2 text-sm text-fg-muted">Le premier calcul n’a pas encore tourné (chaque nuit à 03:45, et au démarrage du service).</p>
      )}
      {summary?.reliability && summary.reliability.days < 30 && (
        <p className="rounded-control border border-line bg-surface-2 px-3 py-2 text-sm text-fg-muted">
          Les dates de connexion sont enregistrées depuis le {formatDate(summary.reliability.since)} ({summary.reliability.days} j). Avant, seules la dernière session ouverte et la date d’inscription sont connues :
          un membre actif qui s’est déconnecté peut apparaître ici. Les chiffres se fiabilisent après 30 jours ; d’ici là, le retour d’un compte dormant est noté sans bloquer ses retraits.
        </p>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Metric
          label={`Total dormant (${th?.inactiveDays ?? 90} j et plus)`}
          tone="warning"
          value={d ? formatMoney(d.xafEq) : pending('w-28')}
          hint={d ? <>{formatMoney(d.xaf)} + {usd(d.usd)} (à {summary?.xafPerUsd} F/$) · {summary?.previous ? <Delta now={d.xafEq} before={summary.previous.xafEq} /> : 'pas encore de mois précédent'}</> : undefined}
        />
        <Metric label="Part des soldes membres" value={summary?.share !== undefined ? pct(summary.share) : pending('w-16')} hint={summary?.all ? `sur ${formatMoney(summary.all.xafEq)} détenus par ${formatNumber(summary.all.count)} comptes` : undefined} />
        <Metric label="Comptes concernés" value={d ? formatNumber(d.count) : pending('w-16')} hint={d ? `dont ${formatNumber(d.flags.checked.count)} vérifiés${summary?.belowMin?.count && th?.minXaf ? ` · ${formatNumber(summary.belowMin.count)} sous ${formatMoney(th.minXaf)} non comptés` : ''}` : undefined} onClick={d ? () => setFilters({}) : undefined} />
        <Metric
          label="Commissions sans connexion"
          tone={d?.flags.commissionsNoLogin.count ? 'danger' : 'neutral'}
          value={d ? formatNumber(d.flags.commissionsNoLogin.count) : pending('w-16')}
          hint={d ? `${formatMoney(d.flags.commissionsNoLogin.xafEq)} · reçoivent des commissions, ne se connectent pas` : undefined}
          onClick={d?.flags.commissionsNoLogin.count ? () => setFilters({ commissionsNoLogin: 'yes' }) : undefined}
        />
      </div>

      {d && summary?.byStatus && (
        <div className="grid gap-3 lg:grid-cols-2">
          <Breakdown title="Par statut" rows={(['inactive', 'dormant', 'long_dormant'] as DormancyStatus[]).map(s => ({ key: s, label: STATUS_LABEL[s], count: summary.byStatus![s]?.count ?? 0, xafEq: summary.byStatus![s]?.xafEq ?? 0 }))} />
          <Breakdown title="Par solde (en F)" rows={(Object.keys(BALANCE_LABEL) as BalanceField[]).map(f => ({ key: f, label: BALANCE_LABEL[f], xafEq: d.byBalance[f] ?? 0 })).filter(r => r.xafEq > 0)} />
          <Breakdown title="Par pays" rows={d.byCountry.slice(0, 12).map(c => ({ key: c.country, label: countryName(c.country), count: c.count, xafEq: c.xafEq }))} />
          <Breakdown title="Par montant détenu" rows={d.bySize.map(s => ({ key: s.key, label: `${s.label} F`, count: s.count, xafEq: s.xafEq }))} />
        </div>
      )}

      {trend.length > 0 && (
        <Panel>
          <PanelHeader title="Évolution du total dormant" description="Dernier calcul de chaque mois." />
          <PanelBody>
            {trend.length < 2
              ? <p className="text-sm text-fg-muted">La courbe apparaît après un deuxième mois de calcul.</p>
              : <TimeSeriesChart data={trend} series={[{ key: 'dormant', label: 'Total dormant' }]} unit="money" ariaLabel="Total dormant par mois" />}
          </PanelBody>
        </Panel>
      )}

      <Panel>
        <PanelHeader
          title="Liste"
          description={totals ? `${formatNumber(totals.count)} comptes · ${formatMoney(totals.xafEq)} (du plus gros au plus petit)` : 'Du plus gros au plus petit.'}
          actions={
            <div className="flex flex-wrap items-center gap-2">
              {exp.job?.status === 'done' && exp.job.fileName && (
                <Button size="sm" onClick={() => void downloadDormantExport(exp.job!.id, exp.job!.fileName!).catch(() => toast.error('Téléchargement impossible.'))}>Télécharger le CSV ({formatNumber(exp.job.rows)})</Button>
              )}
              <Button size="sm" variant="ghost" disabled={exp.job?.status === 'running'} onClick={() => void exp.start(filters)}>
                {exp.job?.status === 'running' ? 'Export en cours…' : 'Exporter en CSV'}
              </Button>
            </div>
          }
        />
        <PanelBody className="space-y-3">
          <div className="flex flex-wrap items-end gap-2">
            <Select className="w-40" value={filters.status ?? 'all'} onValueChange={v => set('status', v)} options={[{ value: 'all', label: 'Tous statuts' }, { value: 'inactive', label: STATUS_LABEL.inactive }, { value: 'dormant', label: STATUS_LABEL.dormant }, { value: 'long_dormant', label: STATUS_LABEL.long_dormant }]} />
            <Select className="w-40" value={filters.country ?? 'all'} onValueChange={v => set('country', v)} options={[{ value: 'all', label: 'Tous les pays' }, ...countries.map(c => ({ value: c, label: countryName(c) })), { value: 'XX', label: 'Pays inconnu' }]} />
            <form className="flex items-center gap-1" onSubmit={e => { e.preventDefault(); set('minXaf', minInput.replace(/\D/g, '')); }}>
              <Input className="w-32" inputMode="numeric" placeholder="Solde min. (F)" value={minInput} onChange={e => setMinInput(e.target.value)} aria-label="Solde minimum en F" />
              <Button size="sm" type="submit" variant="ghost">OK</Button>
            </form>
            <Select className="w-56" value={filters.authenticator ?? 'all'} onValueChange={v => set('authenticator', v)} options={[{ value: 'all', label: 'Authentificateur : tous' }, { value: 'yes', label: 'Authentificateur activé' }, { value: 'no', label: 'Sans authentificateur' }]} />
            <Select className="w-56" value={filters.withdrawal ?? 'all'} onValueChange={v => set('withdrawal', v)} options={[{ value: 'all', label: 'Dernier retrait : tous' }, { value: 'never', label: 'Aucun retrait' }, { value: 'over_90d', label: 'Retrait il y a 90 j +' }, { value: 'within_90d', label: 'Retrait < 90 j' }]} />
            <Select className="w-36" value={filters.fraud ?? 'all'} onValueChange={v => set('fraud', v)} options={[{ value: 'all', label: 'Fraude : tous' }, { value: 'yes', label: 'Signalés' }, { value: 'no', label: 'Non signalés' }]} />
            <Select className="w-36" value={filters.checked ?? 'all'} onValueChange={v => set('checked', v)} options={[{ value: 'all', label: 'Vérifiés : tous' }, { value: 'yes', label: 'Vérifiés' }, { value: 'no', label: 'Non vérifiés' }]} />
            {Object.values(filters).some(v => v !== undefined) && <Button size="sm" variant="ghost" onClick={() => { setFilters({}); setMinInput(''); }}>Effacer les filtres</Button>}
          </div>
          <p className="text-xs text-fg-muted">« Dernier retrait » vient du registre des soldes (depuis novembre 2026) : un retrait plus ancien n’y figure pas.</p>

          <div className="overflow-x-auto">
            <Table>
              <THead>
                <TR><TH>Membre</TH><TH>Pays</TH><TH>Statut</TH><TH>Dernière activité</TH><TH numeric>Détenu</TH><TH>Signaux</TH><TH>Vérifié</TH>{canWrite && <TH>Actions</TH>}</TR>
              </THead>
              <TBody>
                {rows.map(r => (
                  <TR key={r._id}>
                    <TD className="max-w-[16rem]">
                      <Link className="text-primary underline" to={`/userpage/${r._id}`}>{r.name || r._id.slice(-6)}</Link>
                      <div className="truncate text-xs text-fg-muted" title={[r.phoneNumber, r.email].filter(Boolean).join(' · ')}>{[r.phoneNumber, r.email].filter(Boolean).join(' · ')}</div>
                    </TD>
                    <TD className="whitespace-nowrap">{countryName(r.country)}</TD>
                    <TD>{r.status && <Badge tone={STATUS_TONE[r.status]}>{STATUS_LABEL[r.status]}</Badge>}</TD>
                    <TD className="whitespace-nowrap">{formatDate(r.lastSeenAt)}<div className="text-xs text-fg-muted">{BASIS_LABEL[r.basis ?? 'none'] ?? r.basis}</div></TD>
                    <TD numeric>
                      <span className="whitespace-nowrap">{formatMoney(r.heldXaf)}</span>
                      <div className="max-w-[14rem] text-xs text-fg-muted">
                        {(Object.keys(BALANCE_LABEL) as BalanceField[]).filter(f => r.balances[f] > 0).map(f => (f === 'usdBalance' ? usd(r.balances[f]) : `${BALANCE_LABEL[f].replace(' (F)', '')} ${formatNumber(r.balances[f])}`)).join(' · ')}
                        {r.debt > 0 && ` · dette ${formatNumber(r.debt)}`}
                      </div>
                    </TD>
                    <TD className="text-xs">
                      <div className="flex flex-wrap gap-1">
                        {r.commissionsNoLogin && <Badge tone="danger">Commissions sans connexion</Badge>}
                        {r.fraudFlag && <Badge tone="danger">Fraude</Badge>}
                        {r.frozen && <Badge tone="warning">Gelé</Badge>}
                        {!r.authenticator && <Badge tone="neutral">Sans authentificateur</Badge>}
                      </div>
                      <div className="mt-1 text-fg-muted">Dernier retrait : {r.lastWithdrawalAt ? formatDate(r.lastWithdrawalAt) : 'aucun'}</div>
                    </TD>
                    <TD className="text-xs">{r.checkedAt ? <span title={r.checkedNote ?? undefined}>{formatDateTime(r.checkedAt)}{r.checkedNote && <div className="max-w-[12rem] truncate text-fg-muted">{r.checkedNote}</div>}</span> : '—'}</TD>
                    {canWrite && (
                      <TD>
                        <div className="flex flex-wrap gap-1">
                          <Button size="sm" variant="ghost" onClick={() => setAction({ kind: 'check', row: r })}>{r.checkedAt ? 'Revérifier' : 'Vérifié'}</Button>
                          {!r.frozen && <Button size="sm" variant="ghost" onClick={() => setAction({ kind: 'freeze', row: r })}>Geler…</Button>}
                        </div>
                      </TD>
                    )}
                  </TR>
                ))}
              </TBody>
            </Table>
          </div>
          {!loading && !rows.length && <p className="py-6 text-center text-sm text-fg-muted">Aucun compte pour ces filtres.</p>}
          {loading && <Skeleton className="h-8 w-full" />}
          {cursor && !loading && <div className="text-center"><Button size="sm" onClick={() => void load(cursor)}>Charger plus</Button></div>}
        </PanelBody>
      </Panel>

      <ReactivationPanel filters={filters} />

      {summary?.ready && (
        <p className="text-xs text-fg-muted">
          Calcul du {summary.day} ({formatDateTime(summary.at)}), chaque nuit à 03:45.
          {summary.check && (summary.check.ok ? ' Contrôle : le total correspond à la liste.' : ` Contrôle en écart : total ${formatMoney(summary.check.card.xafEq)}, liste ${formatMoney(summary.check.list.xafEq)}.`)}
          {' '}Retour d’un compte dormant : {summary.reliability?.holdMode === 'on' ? `retraits bloqués ${summary.reliability.holdHours} h` : summary.reliability?.holdMode === 'log' ? 'noté, sans blocage pour l’instant' : 'non suivi'}.
        </p>
      )}

      <ActionDialog action={action} onClose={() => setAction(null)} onDone={() => { setAction(null); void load(); }} />
    </div>
  );
};

export default DormantAccountsPage;
