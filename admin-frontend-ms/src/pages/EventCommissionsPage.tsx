import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { InformationCircleIcon } from '@hugeicons/core-free-icons';
import { toast } from 'sonner';
import {
  bustEventCommissionConfigCache, getEventCommissionSettings, updateEventCommissionSettings, type EventCommissionConfig,
} from '../api/event';
import { Can } from '../components/Can';
import { usePermission } from '../hooks/usePermission';
import {
  Button, Dialog, DialogClose, DialogContent, Field, Input, PageHeader, Panel, PanelBody, PanelHeader, Skeleton,
} from '../components/ui';
import { ErrorState, Notice, errorText, formatMoney } from '../components/moduleKit';
import { cn } from '../lib/cn';

// The API stores fractions (0.05); admins think in percent (5). Convert at the edge.
const FIELDS = [
  { key: 'primaryPct', label: 'Commission sur la vente d’un billet', min: 0, max: 50, help: 'Prélevée sur chaque billet vendu par l’organisateur. Entre 0 % et 50 %.' },
  { key: 'resalePct', label: 'Commission sur une revente', min: 0, max: 50, help: 'Prélevée sur chaque revente entre particuliers. Entre 0 % et 50 %.' },
  { key: 'defaultMaxResalePricePct', label: 'Prix de revente maximum', min: 100, max: 300, help: 'Plafond du prix de revente, en % du prix d’origine. Entre 100 % et 300 %.' },
  { key: 'votePct', label: 'Commission sur les votes payants', min: 0, max: 50, help: 'Prélevée sur chaque pack de votes acheté dans un défi (Animation). Entre 0 % et 50 %.' },
] as const;

// votePct is absent on settings-service builds older than the Animation module: show its default (10 %).
const DEFAULT_VOTE_PCT = 0.1;

type FieldKey = typeof FIELDS[number]['key'];
type Form = Record<FieldKey, string>;

const toForm = (c: EventCommissionConfig, fallbackVote?: number): Form => ({
  primaryPct: String(+(c.primaryPct * 100).toFixed(2)),
  resalePct: String(+(c.resalePct * 100).toFixed(2)),
  defaultMaxResalePricePct: String(c.defaultMaxResalePricePct),
  votePct: String(+((c.votePct ?? fallbackVote ?? DEFAULT_VOTE_PCT) * 100).toFixed(2)),
});

/** One line of a worked example. */
function Line({ label, value, minus, total }: { label: string; value: number; minus?: boolean; total?: boolean }) {
  return (
    <div className={total ? 'mt-1 flex justify-between gap-3 border-t border-line pt-2 font-semibold text-fg' : 'flex justify-between gap-3 text-fg-muted'}>
      <span>{label}</span>
      <span className="tabular-nums text-fg">{minus ? '−' : ''}{formatMoney(value)}</span>
    </div>
  );
}

/**
 * SBC Event commission rates (settings-service is the source of truth; the
 * event-service copy is cached 60 s and purged right after saving), with a
 * worked example that follows the form as it is typed.
 */
export default function EventCommissionsPage() {
  const canWrite = usePermission('events') === 'write';
  const settings = useQuery({ queryKey: ['event', 'commissions'], queryFn: getEventCommissionSettings });
  const [form, setForm] = useState<Form>({ primaryPct: '', resalePct: '', defaultMaxResalePricePct: '', votePct: '' });
  const [saved, setSaved] = useState<Form | null>(null);
  const [examplePrice, setExamplePrice] = useState('10000');
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (settings.data && saved === null) {
      const next = toForm(settings.data);
      setForm(next);
      setSaved(next);
    }
  }, [settings.data, saved]);

  const errors = useMemo(() => {
    const out: Partial<Record<FieldKey, string>> = {};
    for (const f of FIELDS) {
      const n = Number(form[f.key]);
      if (form[f.key].trim() === '' || !Number.isFinite(n)) out[f.key] = 'Valeur requise.';
      else if (n < f.min || n > f.max) out[f.key] = `Doit être entre ${f.min} % et ${f.max} %.`;
    }
    return out;
  }, [form]);

  const dirty = saved !== null && FIELDS.some(f => form[f.key] !== saved[f.key]);
  const canSave = Object.keys(errors).length === 0 && dirty && !saving;

  // Worked example, live as the admin types.
  const ex = useMemo(() => {
    const price = Math.max(0, Number(examplePrice) || 0);
    const primary = (Number(form.primaryPct) || 0) / 100;
    const resale = (Number(form.resalePct) || 0) / 100;
    const resalePrice = price * (Number(form.defaultMaxResalePricePct) || 0) / 100;
    const vote = (Number(form.votePct) || 0) / 100;
    return {
      price, primaryFee: price * primary, organizerNet: price * (1 - primary),
      resalePrice, resaleFee: resalePrice * resale, sellerNet: resalePrice * (1 - resale),
      voteFee: price * vote, voteOrganizerNet: price * (1 - vote),
    };
  }, [examplePrice, form]);

  const doSave = async () => {
    setSaving(true);
    try {
      const updated = await updateEventCommissionSettings({
        primaryPct: Number(form.primaryPct) / 100,
        resalePct: Number(form.resalePct) / 100,
        defaultMaxResalePricePct: Number(form.defaultMaxResalePricePct),
        votePct: Number(form.votePct) / 100,
      });
      const next = toForm(updated, Number(form.votePct) / 100);
      setSaved(next);
      setForm(next);
      setConfirmOpen(false);
      // event-service keeps a 60 s cached copy: purge it now.
      try {
        await bustEventCommissionConfigCache();
        toast.success('Taux enregistrés et appliqués immédiatement.');
      } catch {
        toast.success('Taux enregistrés. Ils seront appliqués dans moins de 60 secondes.');
      }
    } catch (e) {
      toast.error(errorText(e, 'Enregistrement impossible.'));
      setConfirmOpen(false);
    } finally { setSaving(false); }
  };

  return (
    <div className={cn('space-y-6', dirty && 'max-md:pb-20')}>
      <PageHeader
        title="Commissions SBC Event"
        description="Les taux prélevés par SBC sur les billets, les reventes et les votes payants."
      />

      {settings.isError && !settings.data ? (
        <Panel><ErrorState error={settings.error} onRetry={() => void settings.refetch()} retrying={settings.isFetching} /></Panel>
      ) : (
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <Panel>
            <PanelHeader title="Taux" description="S’appliquent à toutes les nouvelles ventes. Ce qui est déjà payé garde le taux en vigueur au moment de l’achat." />
            <PanelBody className="space-y-5">
              {settings.isLoading ? Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-16 w-full" />) : FIELDS.map(f => (
                <Field key={f.key} label={`${f.label} (en %)`} help={f.help} error={errors[f.key]}>
                  <Input
                    type="number" inputMode="decimal" step="0.1" min={f.min} max={f.max}
                    value={form[f.key]} disabled={!canWrite}
                    onChange={e => setForm({ ...form, [f.key]: e.target.value })}
                    className="h-11 w-full tabular-nums sm:h-9 sm:w-40"
                  />
                </Field>
              ))}
              {!canWrite && <Notice icon={InformationCircleIcon}>Lecture seule : vous pouvez consulter les taux, pas les modifier.</Notice>}
            </PanelBody>
            <Can module="events" write>
              {/* Phones: once something changed, the save bar stays above the bottom menu (the shell's scroll area defeats `sticky`). */}
              <div className={cn(
                'flex items-center justify-between gap-3 rounded-b-panel border-t border-line bg-surface px-4 py-3 sm:px-5',
                dirty && 'max-md:fixed max-md:inset-x-0 max-md:bottom-[calc(3.5rem+1px+env(safe-area-inset-bottom))] max-md:z-20 max-md:rounded-none',
              )}>
                <span className="text-xs text-fg-muted">{dirty ? 'Modifications non enregistrées.' : 'Aucune modification.'}</span>
                <div className="flex gap-2">
                  {dirty && <Button variant="ghost" size="lg" onClick={() => saved && setForm(saved)}>Annuler</Button>}
                  <Button variant="primary" size="lg" disabled={!canSave} onClick={() => setConfirmOpen(true)}>Enregistrer</Button>
                </div>
              </div>
            </Can>
          </Panel>

          <Panel>
            <PanelHeader title="Exemple" description="Ce que donnent ces taux pour un prix donné." />
            <PanelBody className="space-y-4">
              <Field label="Prix du billet ou du pack de votes (en F)">
                <Input type="number" inputMode="numeric" min={0} step={500} value={examplePrice} onChange={e => setExamplePrice(e.target.value)} className="h-11 w-full tabular-nums sm:h-9 sm:w-48" />
              </Field>
              <div className="grid gap-3 text-sm md:grid-cols-3 xl:grid-cols-1 2xl:grid-cols-3">
                <div className="space-y-1 rounded-panel border border-line p-4">
                  <p className="mb-2 font-medium text-fg">Vente d’un billet</p>
                  <Line label="Prix du billet" value={ex.price} />
                  <Line label={`Commission SBC (${form.primaryPct || 0} %)`} value={ex.primaryFee} minus />
                  <Line label="Reversé à l’organisateur" value={ex.organizerNet} total />
                </div>
                <div className="space-y-1 rounded-panel border border-line p-4">
                  <p className="mb-2 font-medium text-fg">Revente au prix maximum</p>
                  <Line label={`Prix max (${form.defaultMaxResalePricePct || 0} %)`} value={ex.resalePrice} />
                  <Line label={`Commission SBC (${form.resalePct || 0} %)`} value={ex.resaleFee} minus />
                  <Line label="Reversé au revendeur" value={ex.sellerNet} total />
                </div>
                <div className="space-y-1 rounded-panel border border-line p-4">
                  <p className="mb-2 font-medium text-fg">Pack de votes au même prix</p>
                  <Line label="Prix du pack" value={ex.price} />
                  <Line label={`Commission SBC (${form.votePct || 0} %)`} value={ex.voteFee} minus />
                  <Line label="Reversé à l’organisateur" value={ex.voteOrganizerNet} total />
                </div>
              </div>
            </PanelBody>
          </Panel>
        </div>
      )}

      <Dialog open={confirmOpen} onOpenChange={o => { if (!saving) setConfirmOpen(o); }}>
        <DialogContent
          size="sm"
          title="Modifier les taux de commission ?"
          description="Ils s’appliqueront à toutes les nouvelles ventes de billets et de packs de votes."
          footer={(
            <>
              <DialogClose asChild><Button variant="outline" size="lg" disabled={saving}>Annuler</Button></DialogClose>
              <Button variant="primary" size="lg" loading={saving} onClick={() => void doSave()}>Enregistrer</Button>
            </>
          )}
        >
          <ul className="space-y-1 text-sm text-fg">
            <li>Vente d’un billet : <strong className="tabular-nums">{form.primaryPct} %</strong></li>
            <li>Revente : <strong className="tabular-nums">{form.resalePct} %</strong></li>
            <li>Prix de revente maximum : <strong className="tabular-nums">{form.defaultMaxResalePricePct} %</strong></li>
            <li>Votes payants : <strong className="tabular-nums">{form.votePct} %</strong></li>
          </ul>
        </DialogContent>
      </Dialog>
    </div>
  );
}
