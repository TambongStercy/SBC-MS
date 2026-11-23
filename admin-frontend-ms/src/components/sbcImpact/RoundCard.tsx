import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button, Field, Input } from '../ui';
import { DetailList, formatDateTime, type ConfirmOptions } from '../moduleKit';
import {
    ROUND_EDITION_STATUS, ROUND_LABELS, ROUND_STAGE, closeRoundNow, fromLocalInput, impactErrorMessage, openRoundNow, readImpactError,
    roundOf, scheduleRound, toLocalInput, type Edition, type RoundKey,
} from '../../services/impactV2Api';
import { RoundStatusBadge } from './shared';


/** One vote round: its dates (editable while scheduled), open now, close now. */
export default function RoundCard({ edition, k, canWrite, onChanged, ask }: {
    edition: Edition;
    k: RoundKey;
    canWrite: boolean;
    onChanged: (e?: Edition) => void;
    ask: (o: ConfirmOptions) => void;
}) {
    const r = roundOf(edition, k);
    const savedOpens = toLocalInput(r.opensAt);
    const savedCloses = toLocalInput(r.closesAt);
    const [opensAt, setOpensAt] = useState(savedOpens);
    const [closesAt, setClosesAt] = useState(savedCloses);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<{ field: string | null; message: string } | null>(null);
    useEffect(() => { setOpensAt(savedOpens); setClosesAt(savedCloses); }, [savedOpens, savedCloses]);

    /** "pendant la semaine 2" / "… 3" / "pendant la finale en direct". */
    const when = ROUND_STAGE[k] === 'WEEK2' ? 'pendant la semaine 2' : ROUND_STAGE[k] === 'WEEK3' ? 'pendant la semaine 3' : 'pendant la finale en direct';
    // Weeks 2–3 are planned until the TOP 3; the final vote until the result (backend scheduleRound).
    const editionOpen = edition.status !== 'FINISHED' && edition.status !== 'CANCELLED' && (k === 'FINAL' || edition.status !== 'FINAL');
    const scheduled = r.status === 'SCHEDULED';
    const dirty = opensAt !== savedOpens || closesAt !== savedCloses;
    const inItsWeek = edition.status === ROUND_EDITION_STATUS[k] && edition.stage === ROUND_STAGE[k];
    const endPassed = !!r.closesAt && new Date(r.closesAt).getTime() <= Date.now();

    const save = async () => {
        if (!opensAt || !closesAt) { setError({ field: null, message: 'Indiquez l’ouverture et la fin du vote.' }); return; }
        if (closesAt <= opensAt) { setError({ field: 'closesAt', message: 'Le vote doit se terminer après son ouverture.' }); return; }
        setSaving(true);
        setError(null);
        try {
            const e = await scheduleRound(edition._id, k, { opensAt: fromLocalInput(opensAt), closesAt: fromLocalInput(closesAt) });
            toast.success(`${ROUND_LABELS[k]} : dates enregistrées.`);
            onChanged(e);
        } catch (err) {
            const x = readImpactError(err, 'Les dates du vote n’ont pas pu être enregistrées.');
            setError({ field: x.fields[0]?.split('.').pop() ?? null, message: x.message });
        } finally {
            setSaving(false);
        }
    };

    const askOpen = () => ask({
        title: `Ouvrir le ${ROUND_LABELS[k].toLowerCase()} maintenant ?`,
        tone: 'primary',
        confirmLabel: 'Ouvrir maintenant',
        description: `Les membres peuvent voter tout de suite, jusqu’au ${formatDateTime(r.closesAt)}. Les candidats en course sont prévenus.`,
        onConfirm: async () => {
            try {
                onChanged(await openRoundNow(edition._id, k));
                toast.success(`${ROUND_LABELS[k]} ouvert.`);
            } catch (err) {
                const x = readImpactError(err, 'Le vote n’a pas pu être ouvert.');
                // The end date has passed: point at it in the form.
                if (x.code === 'INVALID_SCHEDULE') {
                    setError({ field: x.fields[0]?.split('.').pop() ?? 'closesAt', message: x.message });
                    toast.error(x.message);
                    return;
                }
                // Opened or closed meanwhile (the job, another admin): show the round as it is.
                if (x.code === 'ROUND_STARTED') {
                    toast.error(x.message);
                    onChanged();
                    return;
                }
                throw new Error(x.message);
            }
        },
    });
    const askClose = () => ask({
        title: `Clore le ${ROUND_LABELS[k].toLowerCase()} maintenant ?`,
        confirmLabel: 'Clore le vote',
        description: `Plus aucun vote n’est accepté à partir de maintenant, au lieu du ${formatDateTime(r.closesAt)}. Un vote clos ne se rouvre jamais.`
            + (k === 'PAID' ? ' Les paiements lancés avant la clôture comptent encore s’ils sont confirmés dans le délai prévu.' : ''),
        reason: { label: 'Raison', required: true, minLength: 5 },
        onConfirm: async (reason: string) => {
            try {
                onChanged(await closeRoundNow(edition._id, k, reason));
                toast.success(`${ROUND_LABELS[k]} clos.`);
            } catch (err) {
                throw new Error(impactErrorMessage(err, 'Le vote n’a pas pu être clos.'));
            }
        },
    });

    const fieldError = (f: 'opensAt' | 'closesAt') => (error && (error.field === f || (!error.field && f === 'closesAt')) ? error.message : undefined);

    return (
        <div className="space-y-3 rounded-panel border border-line p-4" data-testid={`round-${k}`}>
            <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                    <p className="font-medium text-fg">{ROUND_LABELS[k]}</p>
                    <p className="text-xs text-fg-muted">
                        {k === 'PAID' ? 'Packs payants' : k === 'FINAL' ? 'Gratuit, 1 compte = 1 vote, résultats cachés jusqu’au résultat' : '1 compte = 1 vote'}, {when}
                    </p>
                </div>
                <RoundStatusBadge status={r.status} />
            </div>

            <DetailList items={[
                ['Ouverture prévue', r.opensAt ? formatDateTime(r.opensAt) : '—'],
                ['Fin prévue', r.closesAt ? formatDateTime(r.closesAt) : '—'],
                r.openedAt ? ['Ouvert le', formatDateTime(r.openedAt)] : null,
                r.closedAt ? ['Clos le', formatDateTime(r.closedAt)] : null,
            ]} />

            {scheduled && canWrite && editionOpen && (
                <div className="space-y-3">
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <Field label="Ouverture" error={fieldError('opensAt')}>
                            <Input type="datetime-local" className="h-11 sm:h-9" value={opensAt} onChange={e => setOpensAt(e.target.value)} />
                        </Field>
                        <Field label="Fin" error={fieldError('closesAt')}>
                            <Input type="datetime-local" className="h-11 sm:h-9" value={closesAt} onChange={e => setClosesAt(e.target.value)} />
                        </Field>
                    </div>
                    <p className="text-xs text-fg-muted">Heures de votre appareil. Le vote s’ouvre tout seul à sa date {when}, et se clôt tout seul à sa fin.</p>
                    <div className="flex flex-col gap-2 sm:flex-row">
                        <Button variant="outline" size="lg" onClick={() => void save()} loading={saving} disabled={!dirty}>Enregistrer les dates</Button>
                        {inItsWeek && (
                            <Button variant="primary" size="lg" onClick={askOpen} disabled={dirty || !r.closesAt || endPassed}
                                title={dirty ? 'Enregistrez d’abord les dates.' : !r.closesAt ? 'Enregistrez d’abord la fin du vote.' : undefined}>
                                Ouvrir maintenant
                            </Button>
                        )}
                    </div>
                    {inItsWeek && (!r.closesAt || endPassed) && (
                        <p className="text-xs text-fg-muted">Pour ouvrir maintenant, enregistrez d’abord une date de fin à venir.</p>
                    )}
                </div>
            )}

            {r.status === 'OPEN' && canWrite && (
                <Button variant="danger-ghost" size="lg" onClick={askClose}>Clore maintenant</Button>
            )}
        </div>
    );
}

