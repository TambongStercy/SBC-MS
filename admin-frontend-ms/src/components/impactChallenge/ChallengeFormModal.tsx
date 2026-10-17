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
import { FormModal, Notice } from './shared';
import { btn, fieldClass, labelClass } from './styles';

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

    const pickMonth = (m: number, y: number) => {
        setMonth(m);
        setYear(y);
        // The voting period follows the month unless the admin changes it.
        const b = monthBounds(m, y);
        setStartDate(b.start);
        setEndDate(b.end);
    };

    const save = async () => {
        if (!campaignName.trim()) return setError('Donne un nom au challenge.');
        if (!startDate || !endDate) return setError('Indique le début et la fin des votes.');
        if (endDate < startDate) return setError('La fin des votes doit venir après le début.');
        if (!descFr.trim() || !descEn.trim()) return setError('La description est demandée en français et en anglais.');

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
        <FormModal
            title={challenge ? 'Modifier le challenge' : 'Nouveau challenge'}
            onClose={onClose}
            busy={saving}
            footer={
                <>
                    <button onClick={onClose} disabled={saving} className={btn.secondary}>Annuler</button>
                    <button onClick={save} disabled={saving} className={btn.primary}>
                        {saving ? 'Enregistrement…' : challenge ? 'Enregistrer' : 'Créer le challenge'}
                    </button>
                </>
            }
        >
            <div>
                <label className={labelClass}>Nom du challenge</label>
                <input className={fieldClass} value={campaignName} onChange={e => setCampaignName(e.target.value)}
                    placeholder={`ex. Impact Challenge ${monthLabel(month, year)}`} />
            </div>

            {challenge ? (
                <p className="text-sm text-gray-400">
                    Mois : <span className="text-gray-200">{monthLabel(challenge.month, challenge.year)}</span>
                    <span className="block text-xs text-gray-500 mt-0.5">
                        Le mois ne se change pas : la tombola du mois est liée à la création.
                        {challenge.status === 'draft' && ' Pour un autre mois, supprime ce brouillon et crée-en un nouveau.'}
                    </span>
                </p>
            ) : (
                <div className="grid grid-cols-2 gap-3">
                    <div>
                        <label className={labelClass}>Mois</label>
                        <select className={fieldClass} value={month} onChange={e => pickMonth(Number(e.target.value), year)}>
                            {MONTHS_FR.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
                        </select>
                    </div>
                    <div>
                        <label className={labelClass}>Année</label>
                        <select className={fieldClass} value={year} onChange={e => pickMonth(month, Number(e.target.value))}>
                            {years.map(y => <option key={y} value={y}>{y}</option>)}
                        </select>
                    </div>
                </div>
            )}

            <div className="grid grid-cols-2 gap-3">
                <div>
                    <label className={labelClass}>Début des votes</label>
                    <input type="date" className={fieldClass} value={startDate} onChange={e => setStartDate(e.target.value)} />
                </div>
                <div>
                    <label className={labelClass}>Fin des votes (jour inclus)</label>
                    <input type="date" className={fieldClass} value={endDate} onChange={e => setEndDate(e.target.value)} />
                </div>
            </div>
            {challenge?.status === 'active' && (
                <p className="text-xs text-gray-500 -mt-2">
                    Les votes se ferment tout seuls une heure après la fin du dernier jour. Une date de fin déjà passée les ferme presque tout de suite.
                </p>
            )}

            <div>
                <label className={labelClass}>Description (français)</label>
                <textarea className={fieldClass} rows={3} value={descFr} onChange={e => setDescFr(e.target.value)}
                    placeholder="Ce que les membres voient sur la page du challenge." />
            </div>
            <div>
                <label className={labelClass}>Description (anglais)</label>
                <textarea className={fieldClass} rows={3} value={descEn} onChange={e => setDescEn(e.target.value)}
                    placeholder="Same text, in English." />
            </div>

            {!challenge && (
                <p className="text-xs text-gray-500">
                    Le challenge est créé en brouillon, avec la tombola du même mois. Ajoute et approuve les entrepreneurs, puis ouvre les votes.
                </p>
            )}
            {error && <Notice tone="danger">{error}</Notice>}
        </FormModal>
    );
};

export default ChallengeFormModal;
