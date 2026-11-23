import { useState } from 'react';
import { Button, Field, Input, Textarea } from '../ui';
import { Notice } from '../moduleKit';
import { FormSheet } from '../impactChallenge/shared';
import {
    createEdition, fromLocalInput, readImpactError, type Edition,
} from '../../services/impactV2Api';

type Key = 'name' | 'qualificationOpensAt' | 'qualificationClosesAt' | 'competitionStartsAt' | 'finalAt';

/**
 * Creates an edition in DRAFT with the basics only. The settings take the
 * server's defaults (spec §19 + Rufus's answers); rules and settings are
 * written afterwards on the edition's « Règles et paramètres » tab.
 * Dates are typed in the admin's local time and sent as ISO.
 */
export default function NewEditionSheet({ onClose, onCreated }: { onClose: () => void; onCreated: (e: Edition) => void }) {
    const [name, setName] = useState('');
    const [description, setDescription] = useState('');
    const [opensAt, setOpensAt] = useState('');
    const [closesAt, setClosesAt] = useState('');
    const [competitionAt, setCompetitionAt] = useState('');
    const [finalAt, setFinalAt] = useState('');
    const [errors, setErrors] = useState<Partial<Record<Key, string>>>({});
    const [error, setError] = useState<string | null>(null);
    const [saving, setSaving] = useState(false);

    const save = async () => {
        const errs: Partial<Record<Key, string>> = {};
        const trimmed = name.trim();
        if (trimmed.length < 3 || trimmed.length > 120) errs.name = 'Le nom compte 3 à 120 caractères.';
        if (!opensAt) errs.qualificationOpensAt = 'Indiquez l’ouverture de la qualification.';
        if (!closesAt) errs.qualificationClosesAt = 'Indiquez la fin de la qualification.';
        else if (opensAt && closesAt <= opensAt) errs.qualificationClosesAt = 'La qualification doit se terminer après son ouverture.';
        if (competitionAt && closesAt && competitionAt < closesAt) errs.competitionStartsAt = 'La compétition commence après la qualification.';
        if (finalAt && competitionAt && finalAt < competitionAt) errs.finalAt = 'La finale a lieu après le début de la compétition.';
        setErrors(errs);
        if (Object.keys(errs).length) return;

        setSaving(true);
        setError(null);
        try {
            const created = await createEdition({
                name: trimmed,
                description: description.trim(),
                schedule: {
                    qualificationOpensAt: fromLocalInput(opensAt),
                    qualificationClosesAt: fromLocalInput(closesAt),
                    ...(competitionAt ? { competitionStartsAt: fromLocalInput(competitionAt) } : {}),
                    ...(finalAt ? { finalAt: fromLocalInput(finalAt) } : {}),
                },
            });
            onCreated(created);
        } catch (err) {
            const e = readImpactError(err, 'L’édition n’a pas pu être créée.');
            // INVALID_SCHEDULE names the field `schedule.<key>`; INVALID_EDITION names `name`.
            const field = e.fields[0]?.replace(/^schedule\./, '') as Key | undefined;
            if (field && ['name', 'qualificationOpensAt', 'qualificationClosesAt', 'competitionStartsAt', 'finalAt'].includes(field)) {
                setErrors({ [field]: e.message });
            } else {
                setError(e.message);
            }
        } finally {
            setSaving(false);
        }
    };

    return (
        <FormSheet
            title="Nouvelle édition"
            description="Créée « En préparation » avec les paramètres par défaut. Vous rédigerez le règlement et ajusterez les paramètres ensuite."
            onClose={onClose}
            busy={saving}
            footer={(
                <>
                    <Button variant="outline" size="lg" onClick={onClose} disabled={saving}>Annuler</Button>
                    <Button variant="primary" size="lg" onClick={() => void save()} loading={saving}>Créer l’édition</Button>
                </>
            )}
        >
            <Field label="Nom de l’édition" required error={errors.name}>
                <Input className="h-11 sm:h-9" value={name} onChange={e => setName(e.target.value)} maxLength={120} placeholder="ex. SBC Impact Challenge 2027 — Édition 1" />
            </Field>
            <Field label="Description" help="Texte court affiché aux membres avec l’édition.">
                <Textarea rows={3} value={description} onChange={e => setDescription(e.target.value)} maxLength={4000} />
            </Field>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Field label="Ouverture de la qualification" required error={errors.qualificationOpensAt}>
                    <Input type="datetime-local" className="h-11 sm:h-9" value={opensAt} onChange={e => setOpensAt(e.target.value)} />
                </Field>
                <Field label="Fin de la qualification" required error={errors.qualificationClosesAt}>
                    <Input type="datetime-local" className="h-11 sm:h-9" value={closesAt} onChange={e => setClosesAt(e.target.value)} />
                </Field>
                <Field label="Début de la compétition" error={errors.competitionStartsAt} help="Facultatif.">
                    <Input type="datetime-local" className="h-11 sm:h-9" value={competitionAt} onChange={e => setCompetitionAt(e.target.value)} />
                </Field>
                <Field label="Finale" error={errors.finalAt} help="Facultatif.">
                    <Input type="datetime-local" className="h-11 sm:h-9" value={finalAt} onChange={e => setFinalAt(e.target.value)} />
                </Field>
            </div>
            <p className="text-xs text-fg-muted">Heures de votre appareil. Rien n’est visible des membres avant l’ouverture de la qualification.</p>
            {error && <Notice tone="danger">{error}</Notice>}
        </FormSheet>
    );
}
