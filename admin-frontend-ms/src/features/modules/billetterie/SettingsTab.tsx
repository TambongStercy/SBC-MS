import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { bustEventCommissionConfigCache, getEventCommissionSettings, updateEventCommissionSettings } from '../../../api/event';
import { Button, Card, ConfirmSheet, Input, KeyValue, SectionTitle, Skeleton, notify } from '../../../ui';
import { formatMoney } from '../../../lib/format';

// The API stores fractions (0.05); admins think in percent (5).
const FIELDS = [
    { key: 'primaryPct', label: 'Commission sur les ventes', min: 0, max: 50, help: 'Prélevée sur chaque billet vendu par l’organisateur (0 à 50 %).' },
    { key: 'resalePct', label: 'Commission sur les reventes', min: 0, max: 50, help: 'Prélevée sur chaque revente entre membres (0 à 50 %).' },
    { key: 'defaultMaxResalePricePct', label: 'Prix de revente maximum', min: 100, max: 300, help: 'En % du prix d’origine (100 à 300 %).' },
    { key: 'votePct', label: 'Commission sur les votes payants', min: 0, max: 50, help: 'Prélevée sur chaque pack de votes acheté dans un défi (module Animation), 0 à 50 %.' },
] as const;
type Key = typeof FIELDS[number]['key'];

/** Commission rates and resale cap. Applies to new sales and vote packs only; paid ones keep their rate. */
export function SettingsTab() {
    const qc = useQueryClient();
    const q = useQuery({ queryKey: ['events', 'commissions'], queryFn: getEventCommissionSettings });
    const [form, setForm] = useState<Record<Key, string>>({ primaryPct: '', resalePct: '', defaultMaxResalePricePct: '', votePct: '' });
    const [price, setPrice] = useState('10000');
    const [confirm, setConfirm] = useState(false);
    // votePct is absent on settings-service builds older than the Animation module: show its default (10 %).
    const saved = useMemo(() => q.data ? {
        primaryPct: String(+(q.data.primaryPct * 100).toFixed(2)), resalePct: String(+(q.data.resalePct * 100).toFixed(2)),
        defaultMaxResalePricePct: String(q.data.defaultMaxResalePricePct), votePct: String(+((q.data.votePct ?? 0.1) * 100).toFixed(2)),
    } : null, [q.data]);
    useEffect(() => { if (saved) setForm(saved); }, [saved]);
    const errors = Object.fromEntries(FIELDS.map(f => { const n = Number(form[f.key]); return [f.key, form[f.key] === '' || !Number.isFinite(n) ? 'Valeur requise.' : n < f.min || n > f.max ? `Entre ${f.min} et ${f.max} %.` : '']; })) as Record<Key, string>;
    const valid = FIELDS.every(f => !errors[f.key]);
    const dirty = !!saved && FIELDS.some(f => form[f.key] !== saved[f.key]);
    const p = Math.max(0, Number(price) || 0), primary = (Number(form.primaryPct) || 0) / 100, resale = (Number(form.resalePct) || 0) / 100, cap = Number(form.defaultMaxResalePricePct) || 0;
    const vote = (Number(form.votePct) || 0) / 100;
    const resalePrice = p * cap / 100;

    if (q.isLoading) return <Skeleton className="h-80 rounded-card" />;
    return (
        <div className="space-y-4 max-w-2xl">
            <Card className="space-y-4">
                <p className="text-sm text-ink-2">S’appliquent à toutes les nouvelles ventes de billets et de packs de votes. Ce qui est déjà payé garde le taux du moment de l’achat.</p>
                {FIELDS.map(f => (
                    <Input key={f.key} label={`${f.label} (%)`} type="number" inputMode="decimal" step="0.1" value={form[f.key]}
                        onChange={e => setForm(x => ({ ...x, [f.key]: e.target.value }))} error={errors[f.key] || undefined} hint={f.help} />
                ))}
                <div className="flex items-center justify-between gap-3">
                    {dirty ? <span className="text-sm text-warning">Modifications non enregistrées.</span> : <span />}
                    <Button disabled={!dirty || !valid} onClick={() => setConfirm(true)}>Enregistrer</Button>
                </div>
            </Card>
            <Card className="space-y-3">
                <SectionTitle>Exemple</SectionTitle>
                <Input label="Prix d’un billet (FCFA)" inputMode="numeric" value={price} onChange={e => setPrice(e.target.value)} />
                <KeyValue items={[
                    ['Commission SBC sur la vente', formatMoney(p * primary)], ['L’organisateur reçoit', formatMoney(p * (1 - primary))],
                    ['Revente au prix maximum', formatMoney(resalePrice)], ['Commission SBC sur la revente', formatMoney(resalePrice * resale)], ['Le revendeur reçoit', formatMoney(resalePrice * (1 - resale))],
                    ['Pack de votes au même prix : commission SBC', formatMoney(p * vote)], ['L’organisateur reçoit', formatMoney(p * (1 - vote))],
                ]} />
            </Card>
            <ConfirmSheet open={confirm} onClose={() => setConfirm(false)} title="Changer les commissions ?"
                message={<p>Les nouvelles ventes appliqueront ces taux dès maintenant.</p>} confirmLabel="Enregistrer"
                onConfirm={async () => {
                    await updateEventCommissionSettings({
                        primaryPct: Number(form.primaryPct) / 100, resalePct: Number(form.resalePct) / 100,
                        defaultMaxResalePricePct: Number(form.defaultMaxResalePricePct), votePct: Number(form.votePct) / 100,
                    });
                    // event-service caches the rates for 60 s: clear it so they apply at once.
                    try { await bustEventCommissionConfigCache(); notify.success('Taux enregistrés et appliqués.'); }
                    catch { notify.success('Taux enregistrés. Ils s’appliquent dans moins d’une minute.'); }
                    qc.invalidateQueries({ queryKey: ['events', 'commissions'] });
                }} />
        </div>
    );
}
