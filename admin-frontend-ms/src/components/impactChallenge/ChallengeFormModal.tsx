import React, { useState } from 'react';
import {
    ImpactChallenge,
    MONTHS_FR,
    apiErrorMessage,
    createChallenge,
    endOfDayIso,
    monthLabel,
    startOfDayIso,
    toDateInput,
    updateChallenge,
} from '../../services/impactChallengeApi';
import { Button, Field, Input, Select, Textarea } from '../ui';
import { FormSheet, Notice } from './shared';

const pad = (n: number) => String(n).padStart(2, '0');
const monthBounds = (month: number, year: number) => ({
    start: `${year}-${pad(month)}-01`,
    end: `${year}-${pad(month)}-${pad(new Date(year, month, 0).getDate())}`,
});

/**
 * Create a challenge, or edit an existing one.
 *
 * Month and year are only chosen at creation: the month's tombola is created
 * and linked at that moment, and the service does not re-link it when the
 * month changes later. To change the month of a draft, delete it and create it again.
 * An edit sends only the name, the voting dates and the description.
 */
const ChallengeFormModal: React.FC<{
    challenge?: ImpactChallenge;
    onClose: () => void;
    onSaved: (challenge: ImpactChallenge) => void;
}> = ({ challenge, onClose, onSaved }) => {
    const now = new Date();
    const initialMonth = challenge?.month ?? now.getMonth() + 1;
    const initialYear = challenge?.year ?? now.getFullYear();
    const initialBounds = monthBounds(initialMonth, initialYear);

    const [campaignName, setCampaignName] = useState(challenge?.campaignName ?? '');
    const [month, setMonth] = useState(initialMonth);
    const [year, setYear] = useState(initialYear);
    const [startDate, setStartDate] = useState(challenge ? toDateInput(challenge.startDate) : initialBounds.start);
    const [endDate, setEndDate] = useState(challenge ? toDateInput(challenge.endDate) : initialBounds.end);
    const [descFr, setDescFr] = useState(challenge?.description?.fr ?? '');
    const [descEn, setDescEn] = useState(challenge?.description?.en ?? '');
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [fieldErrors, setFieldErrors] = useState<Partial<Record<'name' | 'dates' | 'fr' | 'en', string>>>({});

    const pickMonth = (m: number, y: number) => {
        setMonth(m);
        setYear(y);
        // The voting period follows the month unless the admin changes it.
        const b = monthBounds(m, y);
        setStartDate(b.start);
        setEndDate(b.end);
    };

    const save = async () => {
        const errs: typeof fieldErrors = {};
        if (!campaignName.trim()) errs.name = 'Donne un nom au challenge.';
        if (!startDate || !endDate) errs.dates = 'Indique le début et la fin des votes.';
        else if (endDate < startDate) errs.dates = 'La fin des votes doit venir après le début.';
        if (!descFr.trim()) errs.fr = 'La description est demandée en français.';
        if (!descEn.trim()) errs.en = 'La description est demandée en anglais.';
        setFieldErrors(errs);
        if (Object.keys(errs).length) return;

        const common = {
            campaignName: campaignName.trim(),
            startDate: startOfDayIso(startDate),
            endDate: endOfDayIso(endDate),
            description: { fr: descFr.trim(), en: descEn.trim() },
        };
        setSaving(true);
        setError(null);
        try {
            const saved = challenge
                ? await updateChallenge(challenge._id, common)
                : await createChallenge({ ...common, month, year });
            onSaved(saved);
        } catch (err) {
            setError(apiErrorMessage(err, challenge ? 'Le challenge n’a pas pu être modifié.' : 'Le challenge n’a pas pu être créé.'));
        } finally {
            setSaving(false);
        }
    };

    const years = [now.getFullYear(), now.getFullYear() + 1];

    return (
        <FormSheet
            title={challenge ? 'Modifier le challenge' : 'Nouveau challenge'}
            description={challenge ? monthLabel(challenge.month, challenge.year) : 'Créé en brouillon, avec la tombola du même mois.'}
            onClose={onClose}
            busy={saving}
            footer={
                <>
                    <Button variant="outline" size="lg" onClick={onClose} disabled={saving}>Annuler</Button>
                    <Button variant="primary" size="lg" onClick={save} loading={saving}>
                        {challenge ? 'Enregistrer' : 'Créer le challenge'}
                    </Button>
                </>
            }
        >
            <Field label="Nom du challenge" required error={fieldErrors.name}>
                <Input className="h-11 sm:h-9" value={campaignName} onChange={e => setCampaignName(e.target.value)}
                    placeholder={`ex. Impact Challenge ${monthLabel(month, year)}`} />
            </Field>

            {challenge ? (
                <div className="rounded-panel border border-line bg-surface-2 px-4 py-3 text-sm">
                    <p className="text-fg-muted">Mois : <span className="font-medium text-fg">{monthLabel(challenge.month, challenge.year)}</span></p>
                    <p className="mt-0.5 text-xs text-fg-muted">
                        Le mois ne se change pas : la tombola du mois est liée à la création.
                        {challenge.status === 'draft' && ' Pour un autre mois, supprime ce brouillon et crée-en un nouveau.'}
                    </p>
                </div>
            ) : (
                <div className="grid grid-cols-2 gap-3">
                    <Field label="Mois">
                        <Select
                            className="h-11 sm:h-9"
                            value={String(month)}
                            onValueChange={v => pickMonth(Number(v), year)}
                            options={MONTHS_FR.map((m, i) => ({ value: String(i + 1), label: m.charAt(0).toUpperCase() + m.slice(1) }))}
                        />
                    </Field>
                    <Field label="Année">
                        <Select
                            className="h-11 sm:h-9"
                            value={String(year)}
                            onValueChange={v => pickMonth(month, Number(v))}
                            options={years.map(y => ({ value: String(y), label: String(y) }))}
                        />
                    </Field>
                </div>
            )}

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Field label="Début des votes" required error={fieldErrors.dates}>
                    <Input type="date" className="h-11 sm:h-9" value={startDate} onChange={e => setStartDate(e.target.value)} />
                </Field>
                <Field label="Fin des votes (jour inclus)" required
                    help={challenge?.status === 'active' ? 'Les votes se ferment tout seuls une heure après la fin du dernier jour. Une date déjà passée les ferme presque tout de suite.' : undefined}>
                    <Input type="date" className="h-11 sm:h-9" value={endDate} onChange={e => setEndDate(e.target.value)} />
                </Field>
            </div>

            <Field label="Description (français)" required error={fieldErrors.fr} help="Ce que les membres voient sur la page du challenge.">
                <Textarea rows={3} value={descFr} onChange={e => setDescFr(e.target.value)} />
            </Field>
            <Field label="Description (anglais)" required error={fieldErrors.en} help="Le même texte, en anglais.">
                <Textarea rows={3} value={descEn} onChange={e => setDescEn(e.target.value)} />
            </Field>

            {!challenge && (
                <p className="text-xs text-fg-muted">
                    Ensuite : ajoute et approuve les entrepreneurs, puis ouvre les votes.
                </p>
            )}
            {error && <Notice tone="danger">{error}</Notice>}
        </FormSheet>
    );
};

export default ChallengeFormModal;
