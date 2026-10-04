import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getModuleConfig, updateModuleConfig, type ModuleConfig } from '../../../services/adminSbcLoveApi';
import { Button, Card, ConfirmSheet, ErrorState, Input, SectionTitle, Select, Skeleton, Switch, notify } from '../../../ui';
import { formatDateTime } from '../../../lib/format';
import { errorMessage } from '../../../lib/hooks';
import { TIMEZONES, WEEKDAYS } from './shared';

type Editable = Pick<ModuleConfig, 'enabled' | 'autoApprove' | 'activeWeekday' | 'openHour' | 'closeHour' | 'timezone' | 'maxInterestsPerWeek' | 'autoSuspendThreshold'>;
const KEYS: Array<keyof Editable> = ['enabled', 'autoApprove', 'activeWeekday', 'openHour', 'closeHour', 'timezone', 'maxInterestsPerWeek', 'autoSuspendThreshold'];
const pick = (c: ModuleConfig): Editable => Object.fromEntries(KEYS.map(k => [k, c[k]])) as Editable;
const HOURS = Array.from({ length: 24 }, (_, h) => h);
const hh = (h: number) => `${String(h).padStart(2, '0')} h`;

function Row({ title, text, children }: { title: string; text: string; children: React.ReactNode }) {
    return (
        <div className="flex items-start justify-between gap-4">
            <div className="min-w-0"><p className="font-semibold">{title}</p><p className="text-sm text-ink-2">{text}</p></div>
            {children}
        </div>
    );
}

/**
 * How SBC Love runs: the on/off switch, the weekly session, quotas. The service
 * accepts any value, so the bounds are checked here.
 */
export function SettingsTab() {
    const qc = useQueryClient();
    const q = useQuery({ queryKey: ['sbclove', 'module'], queryFn: getModuleConfig });
    const [draft, setDraft] = useState<Editable | null>(null);
    useEffect(() => { if (q.data) setDraft(pick(q.data)); }, [q.data]);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [confirm, setConfirm] = useState(false);

    if (q.isError) return <ErrorState onRetry={() => q.refetch()} />;
    if (!q.data || !draft) return <Skeleton className="h-96" />;
    const saved = pick(q.data);
    const set = <K extends keyof Editable>(k: K, v: Editable[K]) => { setDraft({ ...draft, [k]: v }); setError(null); };
    const dirty = KEYS.some(k => draft[k] !== saved[k]);

    const problem = (): string | null => {
        if (draft.closeHour <= draft.openHour) return 'L’heure de fermeture doit venir après l’heure d’ouverture, le même jour.';
        if (!Number.isInteger(draft.maxInterestsPerWeek) || draft.maxInterestsPerWeek < 1 || draft.maxInterestsPerWeek > 100) return 'Intérêts par session : un nombre de 1 à 100.';
        if (!Number.isInteger(draft.autoSuspendThreshold) || draft.autoSuspendThreshold < 1 || draft.autoSuspendThreshold > 50) return 'Seuil de suspension : un nombre de 1 à 50.';
        return null;
    };
    // Turning the module off, or letting profiles through unchecked, is asked about first.
    const risky = (saved.enabled && !draft.enabled) || (!saved.autoApprove && draft.autoApprove);

    const save = async () => {
        const p = problem();
        if (p) { setError(p); return; }
        setSaving(true);
        try {
            const changed = Object.fromEntries(KEYS.filter(k => draft[k] !== saved[k]).map(k => [k, draft[k]]));
            await updateModuleConfig(changed);
            await qc.invalidateQueries({ queryKey: ['sbclove', 'module'] });
            notify.success('Réglages enregistrés. Ils s’appliquent d’ici 30 secondes.');
        } catch (e) {
            setError(errorMessage(e));
        } finally {
            setSaving(false);
        }
    };

    const zones = TIMEZONES.some(([z]) => z === draft.timezone) ? TIMEZONES : [[draft.timezone, draft.timezone] as [string, string], ...TIMEZONES];

    return (
        <div className="max-w-2xl space-y-4">
            <Card className="space-y-4">
                <Row title="SBC Love ouvert" text={draft.enabled ? 'Les membres peuvent parcourir les profils et manifester leur intérêt pendant la session.' : 'Fermé pour tous : plus de navigation ni d’intérêts. Les membres peuvent toujours préparer leur profil.'}>
                    <Switch checked={draft.enabled} onChange={v => set('enabled', v)} label="SBC Love ouvert" />
                </Row>
                <Row title="Publier sans validation" text={draft.autoApprove ? 'Un profil avec assez de photos est publié tout de suite, sans passer par la validation.' : 'Chaque profil attend ta validation avant d’être publié.'}>
                    <Switch checked={draft.autoApprove} onChange={v => set('autoApprove', v)} label="Publier sans validation" />
                </Row>
            </Card>

            <Card className="space-y-4">
                <SectionTitle className="mb-0">Session de la semaine</SectionTitle>
                <p className="text-sm text-ink-2 -mt-2">En dehors de ce créneau, on ne peut ni parcourir les profils ni manifester son intérêt.</p>
                <Select label="Jour" value={draft.activeWeekday} onChange={e => set('activeWeekday', Number(e.target.value))}>
                    {WEEKDAYS.map((d, i) => <option key={d} value={i}>{d}</option>)}
                </Select>
                <div className="grid grid-cols-2 gap-3">
                    <Select label="Ouverture" value={draft.openHour} onChange={e => set('openHour', Number(e.target.value))}>
                        {HOURS.map(h => <option key={h} value={h}>{hh(h)}</option>)}
                    </Select>
                    <Select label="Fermeture" value={draft.closeHour} onChange={e => set('closeHour', Number(e.target.value))}>
                        {HOURS.map(h => <option key={h} value={h}>{hh(h)}</option>)}
                    </Select>
                </div>
                <Select label="Fuseau horaire" value={draft.timezone} onChange={e => set('timezone', e.target.value)}>
                    {zones.map(([z, l]) => <option key={z} value={z}>{l}</option>)}
                </Select>
                <p className="text-sm text-ink-2">
                    Ouvert le <b className="text-ink">{WEEKDAYS[draft.activeWeekday]?.toLowerCase()}</b> de <b className="text-ink">{hh(draft.openHour)}</b> à <b className="text-ink">{hh(draft.closeHour)}</b>.
                </p>
            </Card>

            <Card className="space-y-4">
                <SectionTitle className="mb-0">Limites</SectionTitle>
                <Input label="Intérêts par membre et par session" type="number" inputMode="numeric" min={1} max={100}
                    value={Number.isNaN(draft.maxInterestsPerWeek) ? '' : draft.maxInterestsPerWeek} onChange={e => set('maxInterestsPerWeek', parseInt(e.target.value, 10))} />
                <Input label="Suspension automatique après" type="number" inputMode="numeric" min={1} max={50}
                    value={Number.isNaN(draft.autoSuspendThreshold) ? '' : draft.autoSuspendThreshold} onChange={e => set('autoSuspendThreshold', parseInt(e.target.value, 10))}
                    hint="signalements reçus par un même profil." />
            </Card>

            {error && <p className="text-sm text-danger bg-danger-soft rounded-tile px-3 py-2" role="alert">{error}</p>}
            <div className="flex items-center justify-between gap-3">
                <p className="text-xs text-ink-3">{q.data.updatedAt ? `Modifié ${formatDateTime(q.data.updatedAt)}` : ''}</p>
                <Button onClick={() => (risky ? setConfirm(true) : save())} loading={saving} disabled={!dirty}>Enregistrer</Button>
            </div>

            <ConfirmSheet open={confirm} onClose={() => setConfirm(false)} tone="danger" title="Enregistrer ces réglages ?"
                message={<>
                    {saved.enabled && !draft.enabled && <p>SBC Love se ferme pour tous les membres : plus de navigation ni d’intérêts jusqu’à la réouverture.</p>}
                    {!saved.autoApprove && draft.autoApprove && <p>Les profils seront publiés sans que personne ne regarde les photos ni la description.</p>}
                </>}
                confirmLabel="Enregistrer" onConfirm={save} />
        </div>
    );
}
